import { resolve } from "node:path";
import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { RegistryClient } from "../core/registry-client.js";
import { Cache } from "../core/cache.js";
import { SpellbookManager } from "../core/spellbook-manager.js";
import { parseSpellFile } from "../core/spell-parser.js";
import { handleError } from "../core/error-handler.js";
import { printTable } from "../ui/table.js";
import { formatWarning, printResult } from "../ui/format.js";
import { listFiles } from "../utils/fs.js";
import chalk from "chalk";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List installed spells")
    .option("--local", "List local .spell.yaml files in current directory")
    .option("--json", "Output as JSON")
    .option("--verbose", "Show detailed information")
    .action(async (opts: { local?: boolean; json?: boolean; verbose?: boolean }) => {
      try {
        if (opts.local) {
          await listLocalSpells(opts);
        } else {
          await listSpellbook(opts);
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}

async function listSpellbook(opts: { json?: boolean; verbose?: boolean }): Promise<void> {
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
    console.log(formatWarning("No spells installed. Add spells with `pointyhat add <spell>`."));
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
}

async function listLocalSpells(opts: { json?: boolean }): Promise<void> {
  const files = await listFiles(process.cwd(), ".spell.yaml");

  if (files.length === 0) {
    console.log(chalk.dim("No local spell files found (.spell.yaml)."));
    return;
  }

  const spells: { name: string; version: string; description: string; file: string; steps: number }[] = [];

  for (const file of files) {
    try {
      const spell = await parseSpellFile(resolve(process.cwd(), file));
      spells.push({
        name: spell.name,
        version: spell.version,
        description: spell.description,
        file,
        steps: spell.steps.length,
      });
    } catch {
      spells.push({
        name: file,
        version: "?",
        description: chalk.red("(parse error)"),
        file,
        steps: 0,
      });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(spells, null, 2));
    return;
  }

  printTable(
    ["Name", "Version", "Steps", "File"],
    spells.map((s) => [s.name, s.version, String(s.steps), s.file]),
  );
}
