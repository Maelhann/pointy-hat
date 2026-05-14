import { join } from "node:path";
import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { RegistryClient } from "../core/registry-client.js";
import { Cache } from "../core/cache.js";
import { resolvePackage, resolveVersion } from "../core/mcp-resolver.js";
import { writeMcpToPlatform } from "../core/platform-writer.js";
import {
  parseLockfile,
  generateLockfile,
  createEmptyLockfile,
  updateLockEntry,
} from "../core/lockfile.js";
import { handleError } from "../core/error-handler.js";
import { withSpinner } from "../ui/spinner.js";
import { printTable } from "../ui/table.js";
import { formatSuccess, formatWarning } from "../ui/format.js";
import { satisfiesRange, compareVersions } from "../utils/semver.js";
import { fetchWithTimeout } from "../utils/network.js";
import type { PlatformId } from "../types/platform.js";
import chalk from "chalk";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update [packages...]")
    .description("Update MCP packages to latest compatible versions")
    .option("--all", "Update all installed packages")
    .option("--dry-run", "Show what would be updated without making changes")
    .option("--latest", "Update to latest version regardless of semver range")
    .option("--self", "Update the Pointy Hat CLI itself")
    .action(async (packages: string[], opts: {
      all?: boolean;
      dryRun?: boolean;
      latest?: boolean;
      self?: boolean;
    }) => {
      try {
        // Self-update
        if (opts.self) {
          await selfUpdate(opts.dryRun);
          return;
        }

        const configManager = new ConfigManager();
        await configManager.discoverProjectConfig();
        const userConfig = await configManager.loadUserConfig();
        const projectConfig = await configManager.loadProjectConfig();

        if (!projectConfig || Object.keys(projectConfig.mcps).length === 0) {
          console.log(formatWarning("No packages installed. Run `pointyhat install <package>` first."));
          return;
        }

        const cache = new Cache(userConfig.cache?.directory);
        const registryClient = new RegistryClient({
          baseUrl: userConfig.registry?.url,
          timeout: userConfig.registry?.timeout,
          cache,
          cacheTtl: userConfig.cache?.ttl,
        });

        // Determine which packages to update
        const packagesToUpdate = opts.all || packages.length === 0
          ? Object.keys(projectConfig.mcps)
          : packages;

        const projectDir = configManager.getProjectDir() || process.cwd();
        const lockPath = join(projectDir, "pointyhat.lock");
        const lockfile = (await parseLockfile(lockPath)) || createEmptyLockfile();

        const results: { name: string; current: string; latest: string; status: string }[] = [];

        for (const pkgName of packagesToUpdate) {
          const mcpEntry = projectConfig.mcps[pkgName];
          if (!mcpEntry) {
            results.push({ name: pkgName, current: "-", latest: "-", status: "not installed" });
            continue;
          }

          const currentVersion = lockfile.mcps[pkgName]?.version || mcpEntry.version;
          const versionRange = mcpEntry.version;

          try {
            // Find latest version
            let newVersion: string;
            if (opts.latest) {
              const versionsInfo = await registryClient.getPackageVersions(pkgName);
              newVersion = versionsInfo.latest;
            } else {
              newVersion = await resolveVersion(pkgName, versionRange, registryClient);
            }

            if (compareVersions(newVersion, currentVersion.replace(/^\^|~/, "")) <= 0) {
              results.push({
                name: pkgName,
                current: currentVersion,
                latest: newVersion,
                status: "up to date",
              });
              continue;
            }

            if (opts.dryRun) {
              results.push({
                name: pkgName,
                current: currentVersion,
                latest: newVersion,
                status: "would update",
              });
              continue;
            }

            // Perform update
            const resolved = await withSpinner(
              `Updating ${chalk.bold(pkgName)} ${currentVersion} -> ${newVersion}`,
              () => resolvePackage(pkgName, registryClient),
            );

            // Re-install to platforms
            const platforms = mcpEntry.platforms || [];
            for (const platformId of platforms) {
              try {
                await writeMcpToPlatform(resolved.name, {
                  command: resolved.command,
                  args: resolved.args,
                  env: resolved.env,
                }, platformId as PlatformId);
              } catch {
                // Best effort — platform may have changed
              }
            }

            // Update lockfile
            updateLockEntry(lockfile, "mcps", resolved.name, {
              version: resolved.version,
              resolved: `${userConfig.registry?.url || "https://api.pointyhat.org"}/v1/mcps/${resolved.name}`,
              integrity: resolved.integrity,
              transport: resolved.transport,
              command: resolved.command,
              args: resolved.args,
            });

            // Update project config version range if --latest
            if (opts.latest) {
              projectConfig.mcps[pkgName].version = `^${resolved.version}`;
            }

            results.push({
              name: pkgName,
              current: currentVersion,
              latest: resolved.version,
              status: "updated",
            });
          } catch (err) {
            results.push({
              name: pkgName,
              current: currentVersion,
              latest: "-",
              status: err instanceof Error ? err.message : "failed",
            });
          }
        }

        if (!opts.dryRun) {
          await generateLockfile(lockPath, lockfile);
          await configManager.saveProjectConfig(projectConfig);
        }

        // Print summary
        console.log("");
        printTable(
          ["Package", "Current", "Latest", "Status"],
          results.map((r) => [
            r.name,
            r.current,
            r.latest,
            r.status === "updated" ? chalk.green(r.status)
              : r.status === "up to date" ? chalk.dim(r.status)
              : r.status === "would update" ? chalk.cyan(r.status)
              : chalk.red(r.status),
          ]),
        );

        const updatedCount = results.filter((r) => r.status === "updated").length;
        if (updatedCount > 0) {
          console.log(formatSuccess(`\n${updatedCount} package(s) updated.`));
        } else if (opts.dryRun) {
          const wouldUpdate = results.filter((r) => r.status === "would update").length;
          console.log(chalk.dim(`\n--dry-run: ${wouldUpdate} package(s) would be updated.\n`));
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}

const CLI_VERSION = "0.1.0";
const GITHUB_RELEASES_URL = "https://api.github.com/repos/pointyhat/cli/releases/latest";

async function selfUpdate(dryRun?: boolean): Promise<void> {
  console.log(chalk.dim(`  Current version: ${CLI_VERSION}`));

  let latestVersion: string;
  let downloadUrl: string | undefined;

  try {
    const resp = await fetchWithTimeout(
      GITHUB_RELEASES_URL,
      {
        headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "pointyhat-cli" },
      },
      15000,
    );

    if (!resp.ok) {
      console.log(formatWarning("Could not check for updates. GitHub API returned an error."));
      return;
    }

    const release = (await resp.json()) as { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };
    latestVersion = release.tag_name.replace(/^v/, "");

    // Find the right binary for this platform
    const platform = process.platform;
    const arch = process.arch;
    const binaryName = getBinaryName(platform, arch);

    const asset = release.assets.find((a) => a.name === binaryName);
    downloadUrl = asset?.browser_download_url;
  } catch {
    console.log(formatWarning("Could not check for updates. Are you online?"));
    return;
  }

  if (compareVersions(latestVersion, CLI_VERSION) <= 0) {
    console.log(formatSuccess(`Already up to date (${CLI_VERSION}).`));
    return;
  }

  console.log(`  Latest version: ${chalk.green(latestVersion)}`);

  if (dryRun) {
    console.log(chalk.dim(`\n  --dry-run: Would update ${CLI_VERSION} -> ${latestVersion}`));
    return;
  }

  if (!downloadUrl) {
    console.log(formatWarning(
      `No prebuilt binary found for ${process.platform}-${process.arch}. Update manually.`,
    ));
    return;
  }

  await withSpinner(
    `Downloading pointyhat ${latestVersion}`,
    async () => {
      const resp = await fetchWithTimeout(downloadUrl!, undefined, 120000);
      if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);

      const buffer = Buffer.from(await resp.arrayBuffer());
      const execPath = process.execPath;

      // Write to temp, then swap
      const { writeFile: fsWriteFile, rename, chmod } = await import("node:fs/promises");
      const tmpPath = execPath + ".update";
      await fsWriteFile(tmpPath, buffer);
      try {
        await chmod(tmpPath, 0o755);
      } catch {
        // chmod may fail on Windows
      }

      // Backup current binary
      const backupPath = execPath + ".backup";
      try {
        await rename(execPath, backupPath);
      } catch {
        // May fail on Windows if binary is locked — try direct overwrite
      }

      await rename(tmpPath, execPath);
    },
  );

  console.log(formatSuccess(`Updated to ${latestVersion}.`));
}

function getBinaryName(platform: string, arch: string): string {
  const archMap: Record<string, string> = { x64: "x64", arm64: "arm64" };
  const a = archMap[arch] || arch;

  switch (platform) {
    case "darwin":
      return `pointyhat-darwin-${a}`;
    case "linux":
      return `pointyhat-linux-${a}`;
    case "win32":
      return `pointyhat-win-${a}.exe`;
    default:
      return `pointyhat-${platform}-${a}`;
  }
}
