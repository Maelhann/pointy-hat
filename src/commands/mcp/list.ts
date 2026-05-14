import { join } from "node:path";
import type { Command } from "commander";
import { ConfigManager } from "../../core/config-manager.js";
import { RegistryClient } from "../../core/registry-client.js";
import { Cache } from "../../core/cache.js";
import { parseLockfile } from "../../core/lockfile.js";
import { getAdapter } from "../../core/platform-writer.js";
import { handleError } from "../../core/error-handler.js";
import { printTable } from "../../ui/table.js";
import { formatWarning, printResult } from "../../ui/format.js";
import type { PlatformId } from "../../types/platform.js";
import chalk from "chalk";

export function registerMcpListCommand(mcpCmd: Command): void {
  mcpCmd
    .command("list")
    .description("List installed MCP packages")
    .option("--platform <platform>", "Show packages for a specific platform")
    .option("--json", "Output as JSON")
    .option("--outdated", "Show only packages with newer versions available")
    .action(async (opts: {
      platform?: string;
      json?: boolean;
      outdated?: boolean;
    }) => {
      try {
        const configManager = new ConfigManager();
        await configManager.discoverProjectConfig();

        const projectDir = configManager.getProjectDir() || process.cwd();
        const lockPath = join(projectDir, "pointyhat.lock");
        const lockfile = await parseLockfile(lockPath);

        if (!lockfile || Object.keys(lockfile.mcps).length === 0) {
          console.log(formatWarning("No packages installed. Run `pointyhat mcp install <package>` first."));
          return;
        }

        // Build list of installed packages
        const packages: {
          name: string;
          version: string;
          platforms: string[];
          latestVersion?: string;
          outdated?: boolean;
        }[] = [];

        for (const [name, entry] of Object.entries(lockfile.mcps)) {
          const platforms = entry.platforms ? Object.keys(entry.platforms) : [];

          // Filter by platform if specified
          if (opts.platform && !platforms.includes(opts.platform)) continue;

          packages.push({
            name,
            version: entry.version,
            platforms,
          });
        }

        // Check for outdated if requested
        if (opts.outdated) {
          const userConfig = await configManager.loadUserConfig();
          const cache = new Cache(userConfig.cache?.directory);
          const registryClient = new RegistryClient({
            baseUrl: userConfig.registry?.url,
            timeout: userConfig.registry?.timeout,
            cache,
            cacheTtl: userConfig.cache?.ttl,
          });

          for (const pkg of packages) {
            try {
              const versionsInfo = await registryClient.getPackageVersions(pkg.name);
              pkg.latestVersion = versionsInfo.latest;
              pkg.outdated = pkg.latestVersion !== pkg.version;
            } catch {
              pkg.latestVersion = "?";
            }
          }

          // Filter to only outdated if --outdated
          const outdated = packages.filter((p) => p.outdated);
          if (outdated.length === 0) {
            console.log(chalk.green("All packages are up to date."));
            return;
          }
        }

        // Output
        if (opts.json) {
          printResult(packages, "json");
          return;
        }

        const headers = opts.outdated
          ? ["Package", "Current", "Latest", "Platforms"]
          : ["Package", "Version", "Platforms"];

        const rows = packages.map((p) =>
          opts.outdated
            ? [
                p.name,
                p.version,
                p.outdated ? chalk.yellow(p.latestVersion || "?") : chalk.green(p.latestVersion || p.version),
                p.platforms.join(", ") || "-",
              ]
            : [p.name, p.version, p.platforms.join(", ") || "-"],
        );

        printTable(headers, rows);
        console.log(chalk.dim(`\n${packages.length} package(s) installed.`));
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
