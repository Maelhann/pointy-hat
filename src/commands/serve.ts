import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { RegistryClient } from "../core/registry-client.js";
import { Cache } from "../core/cache.js";
import { SpellbookManager } from "../core/spellbook-manager.js";
import { PointyHatMcpServer } from "../core/mcp-server.js";
import { handleError } from "../core/error-handler.js";
import chalk from "chalk";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start Pointy Hat as an MCP server")
    .option("--transport <transport>", "Transport mode: stdio", "stdio")
    .action(async (opts: { transport: string }) => {
      try {
        if (opts.transport !== "stdio") {
          console.error(chalk.red(`Unsupported transport: ${opts.transport}. Only "stdio" is supported.`));
          process.exit(1);
        }

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

        const server = new PointyHatMcpServer(spellbook, configManager, registryClient);

        // Log to stderr so it doesn't interfere with stdio transport
        console.error(chalk.dim("Pointy Hat MCP server started (stdio transport)"));

        await server.start("stdio");
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
