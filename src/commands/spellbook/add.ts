import type { Command } from "commander";
import { ConfigManager } from "../../core/config-manager.js";
import { RegistryClient } from "../../core/registry-client.js";
import { Cache } from "../../core/cache.js";
import { SpellbookManager } from "../../core/spellbook-manager.js";
import { handleError } from "../../core/error-handler.js";
import { formatSuccess, formatWarning } from "../../ui/format.js";
import { withSpinner } from "../../ui/spinner.js";
import chalk from "chalk";

export function registerSpellbookAddCommand(spellbookCmd: Command): void {
  spellbookCmd
    .command("add <spell...>")
    .description("Add spells to your spellbook")
    .option("--version <v>", "Specific version to install")
    .action(async (spellNames: string[], opts: { version?: string }) => {
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

        for (const name of spellNames) {
          const spell = await withSpinner(
            `Adding ${name}...`,
            () => spellbook.add(name, opts.version),
          );

          console.log(formatSuccess(`Added ${chalk.bold(spell.name)}@${spell.version} to spellbook`));

          // Check MCP dependencies
          const depCheck = await spellbook.checkDependencies(spell);
          if (depCheck.missing.length > 0) {
            console.log(formatWarning(
              `Missing MCP dependencies: ${depCheck.missing.join(", ")}`,
            ));
            console.log(chalk.dim(`  Install with: pointyhat install ${depCheck.missing.join(" ")}`));
          }
          if (depCheck.optional.length > 0) {
            console.log(chalk.dim(`  Optional MCPs not installed: ${depCheck.optional.join(", ")}`));
          }
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
