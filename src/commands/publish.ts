import { join, resolve } from "node:path";
import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { RegistryClient } from "../core/registry-client.js";
import { AuthManager } from "../core/auth-manager.js";
import { Cache } from "../core/cache.js";
import { parseSpellFile, validateSpell } from "../core/spell-parser.js";
import { scanSpell, buildScanResult } from "../core/security-scanner.js";
import {
  parseLockfile,
  generateLockfile,
  createEmptyLockfile,
  updateLockEntry,
} from "../core/lockfile.js";
import { handleError, E_PUBLISH_FAILED, E_SPELL_INVALID } from "../core/error-handler.js";
import { withSpinner } from "../ui/spinner.js";
import { formatSuccess, formatWarning } from "../ui/format.js";
import { computeSha512 } from "../utils/hash.js";
import { readFile, fileExists, listFiles } from "../utils/fs.js";
import { bumpVersion, isValidVersion } from "../utils/semver.js";
import { readYamlFile, writeYamlFile } from "../utils/yaml.js";
import { confirm } from "@inquirer/prompts";
import type { PublishRequest, PublishCatalyst, PublishArtifact } from "../types/registry.js";
import chalk from "chalk";
import fg from "fast-glob";

export function registerPublishCommand(program: Command): void {
  program
    .command("publish [path]")
    .description("Publish a spell to the registry")
    .option("--tag <tag>", "Publish tag (e.g. latest, beta)")
    .option("--access <access>", "Access level: public or private", "public")
    .option("--dry-run", "Show what would be published without actually publishing")
    .option("--bump <level>", "Bump version before publishing (major, minor, patch)")
    .action(async (path: string | undefined, opts: {
      tag?: string;
      access?: string;
      dryRun?: boolean;
      bump?: string;
    }) => {
      try {
        // 1. Find spell file
        const spellPath = await resolveSpellPath(path);
        if (!spellPath) {
          throw E_PUBLISH_FAILED("unknown", "No spell file found. Provide a path or run from a directory with a *.spell.yaml file.");
        }

        // 2. Read and parse
        const rawYaml = await readFile(spellPath);
        const spell = await parseSpellFile(spellPath);

        // 3. Bump version if requested
        if (opts.bump) {
          const level = opts.bump as "major" | "minor" | "patch";
          if (!["major", "minor", "patch"].includes(level)) {
            throw E_PUBLISH_FAILED(spell.name, `Invalid bump level "${opts.bump}". Use major, minor, or patch.`);
          }
          const newVersion = bumpVersion(spell.version, level);
          console.log(chalk.dim(`  Bumping version: ${spell.version} -> ${newVersion}`));

          // Update the file
          const yamlData = await readYamlFile<{ spell: Record<string, unknown> }>(spellPath);
          yamlData.spell.version = newVersion;
          await writeYamlFile(spellPath, yamlData);
          spell.version = newVersion;
        }

        // 4. Validate
        const validation = validateSpell(spell);
        if (!validation.valid) {
          const issues = validation.errors.map((e) => `  ${e.code}: ${e.message}`).join("\n");
          throw E_SPELL_INVALID(`Spell has validation errors:\n${issues}`);
        }
        if (validation.warnings.length > 0) {
          for (const w of validation.warnings) {
            console.log(formatWarning(`${w.path}: ${w.message}`));
          }
        }

        // 5. Security scan
        const findings = scanSpell(spell);
        const scanResult = buildScanResult(findings);
        if (scanResult.summary.errors > 0) {
          throw E_PUBLISH_FAILED(spell.name, `Security scan found ${scanResult.summary.errors} error(s). Fix them before publishing.`);
        }
        if (scanResult.summary.warnings > 0) {
          console.log(formatWarning(`Security scan found ${scanResult.summary.warnings} warning(s).`));
        }

        // 6. Bundle catalysts
        const catalystBundle: PublishCatalyst[] = [];
        for (const catalyst of spell.catalysts) {
          const catalystContent = await resolveCatalystContent(catalyst.uri, spellPath);
          const integrity = computeSha512(catalystContent);
          catalystBundle.push({
            id: catalyst.id,
            description: catalyst.description,
            uri: catalyst.uri,
            type: catalyst.type,
            content: catalystContent,
            integrity,
          });
        }

        // 6b. Bundle artifacts
        const artifactBundle: PublishArtifact[] = [];
        for (const output of spell.outputs) {
          if (output.artifact) {
            const artifactContent = await resolveArtifactContent(output.artifact, spellPath);
            const artifactIntegrity = computeSha512(artifactContent);
            const artifactFilename = output.artifact.match(/^artifact:\/\/[^/]+\/(.+)$/)?.[1] ?? "template";
            artifactBundle.push({
              id: artifactFilename,
              outputId: output.id,
              content: artifactContent,
              integrity: artifactIntegrity,
            });
          }
        }

        // 7. Compute spell integrity
        const spellYaml = await readFile(spellPath);
        const integrity = computeSha512(spellYaml);

        // 8. Build publish request
        const publishRequest: PublishRequest = {
          name: spell.name,
          version: spell.version,
          description: spell.description,
          author: spell.author,
          license: spell.license,
          tags: spell.tags,
          card: spell.card,
          access: (opts.access as "public" | "private") || "public",
          integrity,
          requiredMcps: spell.requires.tools.map((t) => t.uri),
          spellYaml: spellYaml,
          catalysts: catalystBundle,
          artifacts: artifactBundle,
        };

        // 9. Dry run
        if (opts.dryRun) {
          console.log(chalk.bold("\n  Dry run — would publish:\n"));
          console.log(`  Name:        ${chalk.cyan(spell.name)}`);
          console.log(`  Version:     ${chalk.cyan(spell.version)}`);
          console.log(`  Author:      ${spell.author}`);
          console.log(`  Description: ${spell.description}`);
          console.log(`  Access:      ${opts.access || "public"}`);
          console.log(`  Tags:        ${spell.tags.join(", ") || "(none)"}`);
          console.log(`  Catalysts:   ${catalystBundle.length}`);
          console.log(`  Artifacts:   ${artifactBundle.length}`);
          console.log(`  Integrity:   ${integrity.slice(0, 30)}...`);
          console.log(chalk.dim("\n  --dry-run: No changes made.\n"));
          return;
        }

        // 10. Require auth
        const authManager = new AuthManager();
        const token = await authManager.getToken();
        if (!token) {
          throw E_PUBLISH_FAILED(spell.name, "Authentication required. Run `pointyhat auth login` first.");
        }

        // 11. Confirm
        const ok = await confirm({
          message: `Publish ${chalk.bold(spell.name)}@${spell.version} as ${opts.access || "public"}?`,
          default: true,
        });
        if (!ok) {
          console.log(chalk.dim("  Cancelled."));
          return;
        }

        // 12. Publish
        const configManager = new ConfigManager();
        const userConfig = await configManager.loadUserConfig();
        const cache = new Cache(userConfig.cache?.directory);
        const registryClient = new RegistryClient({
          baseUrl: userConfig.registry?.url,
          timeout: userConfig.registry?.timeout,
          cache,
          cacheTtl: userConfig.cache?.ttl,
        });

        const response = await withSpinner(
          `Publishing ${chalk.bold(spell.name)}@${spell.version}`,
          () => registryClient.publishSpell(publishRequest, token),
        );

        // 13. Update lockfile
        const projectDir = process.cwd();
        const lockPath = join(projectDir, "pointyhat.lock");
        const lockfile = (await parseLockfile(lockPath)) || createEmptyLockfile();

        updateLockEntry(lockfile, "spells", spell.name, {
          version: spell.version,
          resolved: response.url || `${userConfig.registry?.url || "https://api.pointyhat.org"}/v1/spells/${spell.name}`,
          integrity,
        });
        await generateLockfile(lockPath, lockfile);

        // 14. Success
        console.log(formatSuccess(`Published ${spell.name}@${spell.version}`));
        if (response.url) {
          console.log(chalk.dim(`  ${response.url}`));
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}

async function resolveSpellPath(path?: string): Promise<string | null> {
  if (path) {
    const resolved = resolve(path);
    if (await fileExists(resolved)) return resolved;
    return null;
  }

  // Search for *.spell.yaml in cwd
  const matches = await fg("*.spell.yaml", { cwd: process.cwd(), absolute: true });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw E_PUBLISH_FAILED("unknown", `Multiple spell files found: ${matches.join(", ")}. Specify one with \`pointyhat publish <path>\`.`);
  }

  // Also check for spell.yaml
  const spellYaml = join(process.cwd(), "spell.yaml");
  if (await fileExists(spellYaml)) return spellYaml;

  return null;
}

async function resolveCatalystContent(uri: string, spellPath: string): Promise<string> {
  // URI format: catalyst://spell-name/filename
  // Resolve relative to the spell file directory
  const match = uri.match(/^catalyst:\/\/[^/]+\/(.+)$/);
  if (!match) {
    throw E_PUBLISH_FAILED("unknown", `Invalid catalyst URI: "${uri}". Expected format: catalyst://spell-name/filename`);
  }

  const filename = match[1];
  const dir = resolve(spellPath, "..");
  const catalystPath = join(dir, filename);

  if (!(await fileExists(catalystPath))) {
    // Try in a catalysts/ subdirectory
    const altPath = join(dir, "catalysts", filename);
    if (await fileExists(altPath)) {
      return readFile(altPath);
    }
    throw E_PUBLISH_FAILED("unknown", `Catalyst file not found: "${catalystPath}" (also tried catalysts/${filename})`);
  }

  return readFile(catalystPath);
}


async function resolveArtifactContent(uri: string, spellPath: string): Promise<string> {
  // URI format: artifact://spell-name/filename
  const match = uri.match(/^artifact:\/\/[^/]+\/(.+)$/);
  if (!match) {
    throw E_PUBLISH_FAILED("unknown", `Invalid artifact URI: "${uri}". Expected format: artifact://spell-name/filename`);
  }

  const filename = match[1];
  const dir = resolve(spellPath, "..");
  const artifactPath = join(dir, filename);

  if (!(await fileExists(artifactPath))) {
    const altPath = join(dir, "artifacts", filename);
    if (await fileExists(altPath)) {
      return readFile(altPath);
    }
    throw E_PUBLISH_FAILED("unknown", `Artifact file not found: "${artifactPath}" (also tried artifacts/${filename})`);
  }

  return readFile(artifactPath);
}
