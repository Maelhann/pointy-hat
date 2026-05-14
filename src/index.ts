#!/usr/bin/env node

import { Command } from "commander";
import { handleError } from "./core/error-handler.js";

// Spell commands — the hero
import { registerCastCommand } from "./commands/cast.js";
import { registerCreateCommand } from "./commands/create.js";
import { registerAddCommand } from "./commands/add.js";
import { registerRemoveCommand } from "./commands/remove.js";
import { registerListCommand } from "./commands/list.js";
import { registerValidateCommand } from "./commands/validate.js";
import { registerExportCommand } from "./commands/export.js";
import { registerScanCommand } from "./commands/scan.js";
import { registerSyncCommand } from "./commands/sync.js";

// Discovery
import { registerSearchCommand } from "./commands/search.js";
import { registerInfoCommand } from "./commands/info.js";
import { registerTrendingCommand } from "./commands/trending.js";
import { registerCategoriesCommand } from "./commands/categories.js";

// Publishing
import { registerPublishCommand } from "./commands/publish.js";
import { registerUnpublishCommand } from "./commands/unpublish.js";
import { registerVersionCommand } from "./commands/version.js";

// Infrastructure
import { registerServeCommand } from "./commands/serve.js";
import { registerInitCommand } from "./commands/init.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerProviderCommand } from "./commands/provider.js";
import { registerAuthCommand } from "./commands/auth.js";
import { registerCompletionsCommand } from "./commands/completions.js";

// MCP tools (power user)
import { registerMcpInstallCommand } from "./commands/mcp/install.js";
import { registerMcpUninstallCommand } from "./commands/mcp/uninstall.js";
import { registerMcpUpdateCommand } from "./commands/mcp/update.js";
import { registerMcpListCommand } from "./commands/mcp/list.js";
import { registerMcpTestCommand } from "./commands/mcp/test.js";
import { registerMcpRateCommand } from "./commands/mcp/rate.js";
import { registerMcpVerifyCommand } from "./commands/mcp/verify.js";

const program = new Command();

program
  .name("pointyhat")
  .description("Shareable AI workflows that agents can cast")
  .version("0.1.0");

// Spell commands — the hero
registerCastCommand(program);
registerCreateCommand(program);
registerAddCommand(program);
registerRemoveCommand(program);
registerListCommand(program);
registerValidateCommand(program);
registerExportCommand(program);
registerScanCommand(program);
registerSyncCommand(program);

// Discovery
registerSearchCommand(program);
registerInfoCommand(program);
registerTrendingCommand(program);
registerCategoriesCommand(program);

// Publishing
registerPublishCommand(program);
registerUnpublishCommand(program);
registerVersionCommand(program);

// Infrastructure
registerServeCommand(program);
registerInitCommand(program);
registerConfigCommand(program);
registerDoctorCommand(program);
registerProviderCommand(program);
registerAuthCommand(program);
registerCompletionsCommand(program);

// MCP tools (power user)
const mcpCmd = program
  .command("mcp")
  .description("Manage MCP tool servers");

registerMcpInstallCommand(mcpCmd);
registerMcpUninstallCommand(mcpCmd);
registerMcpUpdateCommand(mcpCmd);
registerMcpListCommand(mcpCmd);
registerMcpTestCommand(mcpCmd);
registerMcpRateCommand(mcpCmd);
registerMcpVerifyCommand(mcpCmd);

// Parse and run
try {
  await program.parseAsync(process.argv);
} catch (err) {
  handleError(err);
  process.exit(1);
}
