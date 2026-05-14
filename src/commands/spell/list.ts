import { resolve } from "node:path";
import type { Command } from "commander";
import { handleError } from "../../core/error-handler.js";
import { listFiles } from "../../utils/fs.js";
import { parseSpellFile } from "../../core/spell-parser.js";
import { printTable } from "../../ui/table.js";
import chalk from "chalk";

export function registerSpellListCommand(spellCmd: Command): void {
  spellCmd
    .command("list")
    .description("List spells")
    .option("--local", "List local spell files only")
    .option("--json", "Output as JSON")
    .action(async (opts: { local?: boolean; json?: boolean }) => {
      try {
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
      } catch (err) {
        handleError(err);
      }
    });
}
