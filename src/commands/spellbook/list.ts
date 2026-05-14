import type { Command } from "commander";
import { ConfigManager } from "../../core/config-manager.js";
import { RegistryClient } from "../../core/registry-client.js";
import { Cache } from "../../core/cache.js";
import { SpellbookManager } from "../../core/spellbook-manager.js";
import { handleError } from "../../core/error-handler.js";
import { printTable } from "../../ui/table.js";
import { formatWarning, printResult } from "../../ui/format.js";
import chalk from "chalk";

export function registerSpellbookListCommand(spellbookCmd: Command): void {
  spellbookCmd
    .command("list")
    .description("List installed spells in your spellbook")
    .option("--json", "Output as JSON")
    .option("--verbose", "Show detailed information")
    .action(async (opts: { json?: boolean; verbose?: boolean }) => {
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
        const spellbook = new SpellbookManager(configManager, registryClient);

        const installed = await spellbook.list();

        if (installed.length === 0) {
          console.log(formatWarning("No spells installed. Add spells with `pointyhat spellbook add <spell>`."));
          return;
        }

        if (opts.json) {
          printResult(installed, "json");
          return;
        }

        console.log(chalk.bold("\nSpellbook:\n"));

        if (opts.verbose) {
          printTable(
            ["Name", "Version", "Description", "MCP Deps", "Installed"],
            installed.map((s) => [
              chalk.bold(s.name),
              s.version,
              chalk.dim(s.description.length > 40 ? s.description.slice(0, 37) + "..." : s.description),
              s.mcpDependencies.length > 0
                ? s.mcpDependencies.map((d) =>
                    d.installed ? chalk.green(d.name) : chalk.red(d.name),
                  ).join(", ")
                : chalk.dim("none"),
              s.installedAt ? new Date(s.installedAt).toLocaleDateString() : "-",
            ]),
          );
        } else {
          printTable(
            ["Name", "Version", "Description"],
            installed.map((s) => [
              chalk.bold(s.name),
              s.version,
              chalk.dim(s.description.length > 50 ? s.description.slice(0, 47) + "..." : s.description),
            ]),
          );
        }

        console.log(chalk.dim(`\n${installed.length} spell(s) installed.\n`));
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
