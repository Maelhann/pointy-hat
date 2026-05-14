import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { RegistryClient } from "../core/registry-client.js";
import { AuthManager } from "../core/auth-manager.js";
import { Cache } from "../core/cache.js";
import { handleError, E_UNPUBLISH_FAILED } from "../core/error-handler.js";
import { withSpinner } from "../ui/spinner.js";
import { formatSuccess, formatWarning } from "../ui/format.js";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";

export function registerUnpublishCommand(program: Command): void {
  program
    .command("unpublish <name>")
    .description("Remove a published spell from the registry")
    .option("--version <version>", "Specific version to unpublish (default: all versions)")
    .option("--force", "Skip confirmation prompt")
    .action(async (name: string, opts: {
      version?: string;
      force?: boolean;
    }) => {
      try {
        // Require auth
        const authManager = new AuthManager();
        const token = await authManager.getToken();
        if (!token) {
          throw E_UNPUBLISH_FAILED(name, "Authentication required. Run `pointyhat auth login` first.");
        }

        const versionLabel = opts.version || "all versions";

        // Confirm
        if (!opts.force) {
          console.log(formatWarning(
            `This will remove ${chalk.bold(name)}@${versionLabel} from the registry.`,
          ));
          console.log(formatWarning("Other spells that depend on it may break."));

          const ok = await confirm({
            message: `Unpublish ${chalk.bold(name)}@${versionLabel}?`,
            default: false,
          });
          if (!ok) {
            console.log(chalk.dim("  Cancelled."));
            return;
          }
        }

        const configManager = new ConfigManager();
        const userConfig = await configManager.loadUserConfig();
        const cache = new Cache(userConfig.cache?.directory);
        const registryClient = new RegistryClient({
          baseUrl: userConfig.registry?.url,
          timeout: userConfig.registry?.timeout,
          cache,
          cacheTtl: userConfig.cache?.ttl,
        });

        await withSpinner(
          `Unpublishing ${chalk.bold(name)}@${versionLabel}`,
          () => registryClient.unpublishSpell(name, opts.version || "*", token),
        );

        console.log(formatSuccess(`Unpublished ${name}@${versionLabel}`));
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
