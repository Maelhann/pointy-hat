import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { handleError } from "../core/error-handler.js";
import { formatSuccess } from "../ui/format.js";
import { keyValueTable } from "../ui/table.js";
import { confirm } from "../ui/prompt.js";
import chalk from "chalk";

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Manage Pointy Hat configuration");

  config
    .command("set <key> <value>")
    .description("Set a config value")
    .action(async (key: string, value: string) => {
      try {
        const mgr = new ConfigManager();
        // Auto-convert "true"/"false" strings to booleans, numbers to numbers
        let parsed: unknown = value;
        if (value === "true") parsed = true;
        else if (value === "false") parsed = false;
        else if (!isNaN(Number(value)) && value !== "") parsed = Number(value);

        await mgr.set(key, parsed);
        console.log(formatSuccess(`Set ${chalk.bold(key)} = ${value}`));
      } catch (err) {
        handleError(err);
      }
    });

  config
    .command("get <key>")
    .description("Get a config value")
    .action(async (key: string) => {
      try {
        const mgr = new ConfigManager();
        const value = await mgr.get(key);
        if (value === undefined) {
          console.log(chalk.dim("(not set)"));
        } else {
          console.log(typeof value === "object" ? JSON.stringify(value, null, 2) : String(value));
        }
      } catch (err) {
        handleError(err);
      }
    });

  config
    .command("list")
    .description("List all config values")
    .action(async () => {
      try {
        const mgr = new ConfigManager();
        const all = await mgr.list();
        const entries: Record<string, string> = {};
        for (const [k, v] of Object.entries(all)) {
          entries[k] = typeof v === "object" ? JSON.stringify(v) : String(v ?? "(not set)");
        }
        console.log(keyValueTable(entries));
      } catch (err) {
        handleError(err);
      }
    });

  config
    .command("delete <key>")
    .description("Delete a config key")
    .action(async (key: string) => {
      try {
        const mgr = new ConfigManager();
        await mgr.delete(key);
        console.log(formatSuccess(`Deleted ${chalk.bold(key)}`));
      } catch (err) {
        handleError(err);
      }
    });

  config
    .command("reset")
    .description("Reset config to defaults")
    .action(async () => {
      try {
        const ok = await confirm("Reset all config to defaults? This cannot be undone.");
        if (!ok) {
          console.log("Cancelled.");
          return;
        }
        const mgr = new ConfigManager();
        await mgr.reset();
        console.log(formatSuccess("Config reset to defaults."));
      } catch (err) {
        handleError(err);
      }
    });
}
