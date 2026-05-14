import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { RegistryClient } from "../core/registry-client.js";
import { Cache } from "../core/cache.js";
import { handleError } from "../core/error-handler.js";
import { printTable } from "../ui/table.js";
import { printResult, formatWarning } from "../ui/format.js";
import type { SearchOptions } from "../types/registry.js";
import chalk from "chalk";

export function registerSearchCommand(program: Command): void {
  program
    .command("search <query>")
    .description("Search the Pointy Hat registry")
    .option("--type <type>", "Filter by type (mcp, spell, all)", "spell")
    .option("--category <category>", "Filter by category")
    .option("--sort <sort>", "Sort by (relevance, downloads, rating, newest)", "relevance")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (query: string, opts: {
      type: string;
      category?: string;
      sort: string;
      limit: string;
      json?: boolean;
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

        const searchOpts: SearchOptions = {
          category: opts.category,
          sort: opts.sort as SearchOptions["sort"],
          limit: parseInt(opts.limit, 10),
        };

        // Search based on type
        const results = opts.type === "spell"
          ? await registryClient.searchSpells(query, searchOpts)
          : await registryClient.search(query, searchOpts);

        if (results.results.length === 0) {
          console.log(formatWarning(`No results found for "${query}".`));
          return;
        }

        if (opts.json) {
          printResult(results, "json");
          return;
        }

        // Display as table
        const rows = results.results.map((r) => [
          r.name,
          r.version,
          chalk.dim(r.type),
          truncate(r.description || "", 40),
          r.downloads > 0 ? String(r.downloads) : "-",
          r.rating ? r.rating.toFixed(1) : "-",
        ]);

        printTable(
          ["Name", "Version", "Type", "Description", "Downloads", "Rating"],
          rows,
        );

        console.log(chalk.dim(
          `\nShowing ${results.results.length} of ${results.total} results (page ${results.page}).`,
        ));
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
