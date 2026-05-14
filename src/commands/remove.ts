import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { RegistryClient } from "../core/registry-client.js";
import { Cache } from "../core/cache.js";
import { SpellbookManager } from "../core/spellbook-manager.js";
import { handleError } from "../core/error-handler.js";
import { formatSuccess } from "../ui/format.js";
import chalk from "chalk";

export function registerRemoveCommand(program: Command): void {
  program
    .command("remove <spell...>")
    .description("Remove spells from your spellbook")
    .action(async (spellNames: string[]) => {
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
          await spellbook.remove(name);
          console.log(formatSuccess(`Removed ${chalk.bold(name)} from spellbook`));
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
