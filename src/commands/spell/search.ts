import type { Command } from "commander";
import { ConfigManager } from "../../core/config-manager.js";
import { RegistryClient } from "../../core/registry-client.js";
import { Cache } from "../../core/cache.js";
import { handleError } from "../../core/error-handler.js";
import { printTable } from "../../ui/table.js";
import { formatWarning, printResult } from "../../ui/format.js";
import chalk from "chalk";

export function registerSpellSearchCommand(spellCmd: Command): void {
  spellCmd
    .command("search <query>")
    .description("Search for spells in the registry")
    .option("--category <c>", "Filter by category")
    .option("--requires-tools <tools...>", "Filter by required tools")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Max results", "20")
    .action(async (query: string, opts: {
      category?: string;
      requiresTools?: string[];
      json?: boolean;
      limit: string;
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

        const response = await registryClient.searchSpells(query, {
          category: opts.category,
          limit: parseInt(opts.limit, 10),
          requiresTools: opts.requiresTools,
        });

        if (response.results.length === 0) {
          console.log(formatWarning(`No spells found for "${query}".`));
          return;
        }

        if (opts.json) {
          printResult(response, "json");
          return;
        }

        console.log(chalk.bold(`\nSpell search: "${query}"\n`));

        printTable(
          ["Name", "Version", "Type", "Downloads", "Description"],
          response.results.map((r) => [
            chalk.bold(r.name),
            r.version,
            chalk.dim(r.type),
            r.downloads > 0 ? String(r.downloads) : "-",
            chalk.dim(
              (r.description || "-").length > 50
                ? (r.description || "-").slice(0, 47) + "..."
                : (r.description || "-"),
            ),
          ]),
        );

        console.log(chalk.dim(`\n${response.total} result(s).\n`));
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
