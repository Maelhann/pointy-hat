import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { RegistryClient } from "../core/registry-client.js";
import { Cache } from "../core/cache.js";
import { SpellbookManager } from "../core/spellbook-manager.js";
import { handleError } from "../core/error-handler.js";
import { formatSuccess, formatWarning } from "../ui/format.js";
import { withSpinner } from "../ui/spinner.js";
import chalk from "chalk";

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Sync spellbook with lockfile (after git pull)")
    .option("--dry-run", "Show what would change without making changes")
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const configManager = new ConfigManager();
        await configManager.discoverProjectConfig();
        const userConfig = await configManager.loadUserConfig();
        const cache = new Cache(userConfig.cache?.directory);
        const registryClient = new RegistryClient({
          baseUrl: userConfig.registry?.url,
          timeout: userConfig.registry?.timeout,
          cache,
          cacheTtl: userConfig.cache?.ttl,
        });
        const spellbook = new SpellbookManager(configManager, registryClient);

        const result = await withSpinner(
          "Syncing spellbook...",
          () => spellbook.sync(opts.dryRun),
        );

        const prefix = opts.dryRun ? chalk.dim("[dry-run] ") : "";

        if (result.added.length > 0) {
          for (const name of result.added) {
            console.log(`${prefix}${chalk.green("+")} ${name}`);
          }
        }

        if (result.removed.length > 0) {
          for (const name of result.removed) {
            console.log(`${prefix}${chalk.red("-")} ${name}`);
          }
        }

        if (result.updated.length > 0) {
          for (const name of result.updated) {
            console.log(`${prefix}${chalk.yellow("~")} ${name}`);
          }
        }

        const totalChanges = result.added.length + result.removed.length + result.updated.length;

        if (totalChanges === 0) {
          console.log(formatSuccess("Spellbook is up to date."));
        } else {
          console.log(
            formatSuccess(
              `${totalChanges} change(s): ${result.added.length} added, ${result.removed.length} removed, ${result.updated.length} updated.`,
            ),
          );
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
