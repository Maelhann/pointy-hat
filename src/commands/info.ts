import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { RegistryClient } from "../core/registry-client.js";
import { Cache } from "../core/cache.js";
import { handleError } from "../core/error-handler.js";
import { printResult } from "../ui/format.js";
import { keyValueTable } from "../ui/table.js";
import chalk from "chalk";

export function registerInfoCommand(program: Command): void {
  program
    .command("info <package>")
    .description("Show detailed information about a package")
    .option("--json", "Output as JSON")
    .option("--versions", "List all available versions")
    .action(async (packageName: string, opts: {
      json?: boolean;
      versions?: boolean;
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

        const pkg = await registryClient.getPackage(packageName);

        if (opts.json) {
          printResult(pkg, "json");
          return;
        }

        // Display package info
        console.log(`\n${chalk.bold.magenta(pkg.name)} ${chalk.dim(`v${pkg.version}`)}`);
        if (pkg.description) {
          console.log(chalk.dim(pkg.description));
        }
        console.log("");

        const details: Record<string, string> = {};
        if (pkg.author) details["Author"] = pkg.author;
        if (pkg.license) details["License"] = pkg.license;
        details["Transport"] = pkg.transport;
        if (pkg.command) details["Command"] = `${pkg.command} ${pkg.args.join(" ")}`;
        if (pkg.platforms.length > 0) details["Platforms"] = pkg.platforms.join(", ");
        if (pkg.tools.length > 0) details["Tools"] = pkg.tools.join(", ");
        if (pkg.resources.length > 0) details["Resources"] = pkg.resources.join(", ");
        if (pkg.downloads !== undefined) details["Downloads"] = String(pkg.downloads);
        if (pkg.rating !== undefined) details["Rating"] = `${pkg.rating.toFixed(1)}/5`;
        if (pkg.homepage) details["Homepage"] = pkg.homepage;
        if (pkg.repository) details["Repository"] = pkg.repository;

        console.log(keyValueTable(details));

        // Show env vars if any
        if (Object.keys(pkg.env).length > 0) {
          console.log(chalk.bold("\nEnvironment Variables:"));
          for (const [key, value] of Object.entries(pkg.env)) {
            console.log(`  ${chalk.cyan(key)} = ${chalk.dim(value)}`);
          }
        }

        // Show versions if requested
        if (opts.versions && pkg.versions.length > 0) {
          console.log(chalk.bold("\nVersions:"));
          for (const v of pkg.versions) {
            const isCurrent = v.version === pkg.version;
            const marker = isCurrent ? chalk.green(" (latest)") : "";
            console.log(`  ${v.version}${marker}  ${chalk.dim(v.publishedAt)}`);
          }
        }

        console.log("");
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
