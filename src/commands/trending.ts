import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { RegistryClient } from "../core/registry-client.js";
import { Cache } from "../core/cache.js";
import { handleError } from "../core/error-handler.js";
import { printTable } from "../ui/table.js";
import { formatWarning, printResult } from "../ui/format.js";
import chalk from "chalk";

export function registerTrendingCommand(program: Command): void {
  program
    .command("trending")
    .description("Show trending packages and spells")
    .option("--type <type>", "Filter by type (mcp, spell, all)", "spell")
    .option("--period <period>", "Time period (day, week, month)", "week")
    .option("--limit <n>", "Max results", "10")
    .option("--json", "Output as JSON")
    .action(async (opts: {
      type: string;
      period: string;
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

        const trending = await registryClient.getTrending({
          type: opts.type !== "all" ? opts.type : undefined,
          period: opts.period,
          limit: parseInt(opts.limit, 10),
        });

        if (trending.items.length === 0) {
          console.log(formatWarning("No trending packages found."));
          return;
        }

        if (opts.json) {
          printResult(trending, "json");
          return;
        }

        console.log(chalk.bold(`\nTrending (${trending.period}):\n`));

        printTable(
          ["#", "Name", "Type", "Version", "Downloads", "Rating"],
          trending.items.map((item, idx) => [
            chalk.dim(String(idx + 1)),
            chalk.bold(item.name),
            chalk.dim(item.type),
            item.version,
            item.downloads > 0 ? String(item.downloads) : "-",
            item.rating ? item.rating.toFixed(1) : "-",
          ]),
        );

        console.log("");
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
