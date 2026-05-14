import { join } from "node:path";
import type { Command } from "commander";
import { ConfigManager } from "../../core/config-manager.js";
import { RegistryClient } from "../../core/registry-client.js";
import { Cache } from "../../core/cache.js";
import { resolvePackage } from "../../core/mcp-resolver.js";
import { writeMcpToPlatform } from "../../core/platform-writer.js";
import { detectAllPlatforms } from "../../core/platform-detector.js";
import {
  parseLockfile,
  generateLockfile,
  createEmptyLockfile,
  updateLockEntry,
} from "../../core/lockfile.js";
import { handleError, E_INSTALL_FAILED, E_PLATFORM_NOT_DETECTED } from "../../core/error-handler.js";
import { withSpinner } from "../../ui/spinner.js";
import { printTable } from "../../ui/table.js";
import { formatSuccess, formatWarning } from "../../ui/format.js";
import type { PlatformId } from "../../types/platform.js";
import chalk from "chalk";

export function registerMcpInstallCommand(mcpCmd: Command): void {
  mcpCmd
    .command("install <packages...>")
    .description("Install MCP packages")
    .option("--platform <platform>", "Target platform (e.g. cursor, claude-desktop)")
    .option("--all", "Install to all detected platforms")
    .option("--global", "Install globally (user-level)")
    .option("--env <pairs...>", "Environment variables (KEY=VAL)")
    .action(async (packages: string[], opts: {
      platform?: string;
      all?: boolean;
      global?: boolean;
      env?: string[];
    }) => {
      try {
        const configManager = new ConfigManager();
        const userConfig = await configManager.loadUserConfig();
        const cache = new Cache(userConfig.cache?.directory);
        const registryClient = new RegistryClient({
          baseUrl: userConfig.registry?.url,
          timeout: userConfig.registry?.timeout,
          cache,
          cacheTtl: userConfig.cache?.ttl,
        });

        // Determine target platforms
        const targetPlatforms = await resolveTargetPlatforms(opts);

        // Parse extra env vars from --env
        const extraEnv: Record<string, string> = {};
        for (const pair of opts.env || []) {
          const eqIdx = pair.indexOf("=");
          if (eqIdx > 0) {
            extraEnv[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
          }
        }

        const results: { name: string; version: string; platforms: string[]; status: string }[] = [];

        for (const pkgName of packages) {
          try {
            // Resolve package from registry
            const resolved = await withSpinner(
              `Resolving ${chalk.bold(pkgName)}`,
              () => resolvePackage(pkgName, registryClient),
            );

            const installedPlatforms: string[] = [];

            // Install to each target platform
            for (const platformId of targetPlatforms) {
              try {
                const entry = {
                  command: resolved.command,
                  args: resolved.args,
                  env: { ...resolved.env, ...extraEnv },
                };

                await writeMcpToPlatform(resolved.name, entry, platformId);
                installedPlatforms.push(platformId);
              } catch (err) {
                console.log(formatWarning(
                  `Failed to write to ${platformId}: ${err instanceof Error ? err.message : String(err)}`,
                ));
              }
            }

            // Update project config (pointyhat.yaml)
            await configManager.discoverProjectConfig();
            const projectConfig = (await configManager.loadProjectConfig()) || {
              registry: userConfig.registry?.url || "https://api.pointyhat.org",
              platforms: [],
              mcps: {},
              spells: {},
            };

            projectConfig.mcps[resolved.name] = {
              version: `^${resolved.version}`,
              platforms: installedPlatforms,
            };
            await configManager.saveProjectConfig(projectConfig, opts.global ? undefined : "pointyhat.yaml");

            // Update lockfile
            const projectDir = configManager.getProjectDir() || process.cwd();
            const lockPath = join(projectDir, "pointyhat.lock");
            const lockfile = (await parseLockfile(lockPath)) || createEmptyLockfile();

            updateLockEntry(lockfile, "mcps", resolved.name, {
              version: resolved.version,
              resolved: `${userConfig.registry?.url || "https://api.pointyhat.org"}/v1/mcps/${resolved.name}`,
              integrity: resolved.integrity,
              transport: resolved.transport,
              command: resolved.command,
              args: resolved.args,
              platforms: Object.fromEntries(
                installedPlatforms.map((p) => [p, { configPath: "" }]),
              ),
            });
            await generateLockfile(lockPath, lockfile);

            results.push({
              name: resolved.name,
              version: resolved.version,
              platforms: installedPlatforms,
              status: installedPlatforms.length > 0 ? "installed" : "failed",
            });
          } catch (err) {
            results.push({
              name: pkgName,
              version: "-",
              platforms: [],
              status: err instanceof Error ? err.message : "failed",
            });
          }
        }

        // Print summary
        console.log("");
        printTable(
          ["Package", "Version", "Platforms", "Status"],
          results.map((r) => [
            r.name,
            r.version,
            r.platforms.join(", ") || "-",
            r.status === "installed" ? chalk.green(r.status) : chalk.red(r.status),
          ]),
        );

        const successCount = results.filter((r) => r.status === "installed").length;
        if (successCount > 0) {
          console.log(formatSuccess(`\n${successCount} package(s) installed.`));
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}

async function resolveTargetPlatforms(opts: {
  platform?: string;
  all?: boolean;
}): Promise<PlatformId[]> {
  if (opts.platform) {
    return [opts.platform as PlatformId];
  }

  const detection = await detectAllPlatforms();

  if (opts.all) {
    return detection.platforms
      .filter((p) => p.status === "ok" || p.status === "missing-config")
      .map((p) => p.id);
  }

  // Auto-detect: use primary platform
  if (detection.primaryPlatform) {
    return [detection.primaryPlatform];
  }

  throw E_PLATFORM_NOT_DETECTED();
}
