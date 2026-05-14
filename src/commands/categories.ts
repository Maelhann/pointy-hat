import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { RegistryClient } from "../core/registry-client.js";
import { Cache } from "../core/cache.js";
import { handleError } from "../core/error-handler.js";
import { printTable } from "../ui/table.js";
import { formatWarning, printResult } from "../ui/format.js";
import chalk from "chalk";

export function registerCategoriesCommand(program: Command): void {
  program
    .command("categories")
    .description("List all package categories")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
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

        const response = await registryClient.getCategories();

        if (response.categories.length === 0) {
          console.log(formatWarning("No categories found."));
          return;
        }

        if (opts.json) {
          printResult(response, "json");
          return;
        }

        console.log(chalk.bold("\nCategories:\n"));

        printTable(
          ["Name", "Packages", "Description"],
          response.categories.map((cat) => [
            chalk.bold(cat.name),
            String(cat.count),
            chalk.dim(cat.description || "-"),
          ]),
        );

        console.log(chalk.dim(`\n${response.categories.length} categories.\n`));
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
