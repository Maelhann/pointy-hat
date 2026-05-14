import { join } from "node:path";
import type { Command } from "commander";
import { ConfigManager } from "../../core/config-manager.js";
import { removeMcpFromPlatform } from "../../core/platform-writer.js";
import { detectAllPlatforms } from "../../core/platform-detector.js";
import {
  parseLockfile,
  generateLockfile,
  createEmptyLockfile,
  removeLockEntry,
} from "../../core/lockfile.js";
import { handleError, E_PLATFORM_NOT_DETECTED } from "../../core/error-handler.js";
import { printTable } from "../../ui/table.js";
import { formatSuccess, formatWarning } from "../../ui/format.js";
import type { PlatformId } from "../../types/platform.js";
import chalk from "chalk";

export function registerMcpUninstallCommand(mcpCmd: Command): void {
  mcpCmd
    .command("uninstall <packages...>")
    .description("Uninstall MCP packages")
    .option("--platform <platform>", "Target platform")
    .option("--all", "Remove from all detected platforms")
    .action(async (packages: string[], opts: {
      platform?: string;
      all?: boolean;
    }) => {
      try {
        const configManager = new ConfigManager();
        await configManager.discoverProjectConfig();

        // Determine platforms to remove from
        const targetPlatforms = await resolveRemovePlatforms(packages, opts, configManager);

        const results: { name: string; platforms: string[]; status: string }[] = [];

        for (const pkgName of packages) {
          const removedPlatforms: string[] = [];

          for (const platformId of targetPlatforms) {
            try {
              await removeMcpFromPlatform(pkgName, platformId);
              removedPlatforms.push(platformId);
            } catch (err) {
              console.log(formatWarning(
                `Failed to remove from ${platformId}: ${err instanceof Error ? err.message : String(err)}`,
              ));
            }
          }

          // Update project config
          const projectConfig = await configManager.loadProjectConfig();
          if (projectConfig) {
            delete projectConfig.mcps[pkgName];
            await configManager.saveProjectConfig(projectConfig);
          }

          // Update lockfile
          const projectDir = configManager.getProjectDir() || process.cwd();
          const lockPath = join(projectDir, "pointyhat.lock");
          const lockfile = (await parseLockfile(lockPath)) || createEmptyLockfile();
          removeLockEntry(lockfile, "mcps", pkgName);
          await generateLockfile(lockPath, lockfile);

          results.push({
            name: pkgName,
            platforms: removedPlatforms,
            status: removedPlatforms.length > 0 ? "removed" : "not found",
          });
        }

        // Print summary
        console.log("");
        printTable(
          ["Package", "Platforms", "Status"],
          results.map((r) => [
            r.name,
            r.platforms.join(", ") || "-",
            r.status === "removed" ? chalk.green(r.status) : chalk.yellow(r.status),
          ]),
        );

        const removedCount = results.filter((r) => r.status === "removed").length;
        if (removedCount > 0) {
          console.log(formatSuccess(`\n${removedCount} package(s) uninstalled.`));
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}

async function resolveRemovePlatforms(
  _packages: string[],
  opts: { platform?: string; all?: boolean },
  configManager: ConfigManager,
): Promise<PlatformId[]> {
  if (opts.platform) {
    return [opts.platform as PlatformId];
  }

  // Try to get platforms from lockfile
  const projectDir = configManager.getProjectDir() || process.cwd();
  const lockPath = join(projectDir, "pointyhat.lock");
  const lockfile = await parseLockfile(lockPath);

  if (opts.all || !lockfile) {
    const detection = await detectAllPlatforms();
    const detected = detection.platforms
      .filter((p) => p.status === "ok" || p.status === "missing-config")
      .map((p) => p.id);
    if (detected.length > 0) return detected;
    throw E_PLATFORM_NOT_DETECTED();
  }

  // Use primary platform
  const detection = await detectAllPlatforms();
  if (detection.primaryPlatform) {
    return [detection.primaryPlatform];
  }

  throw E_PLATFORM_NOT_DETECTED();
}
