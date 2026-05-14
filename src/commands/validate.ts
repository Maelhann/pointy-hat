import { resolve } from "node:path";
import type { Command } from "commander";
import { parseSpellFile, validateSpell } from "../core/spell-parser.js";
import { handleError } from "../core/error-handler.js";
import { listFiles } from "../utils/fs.js";
import { formatSuccess, formatWarning } from "../ui/format.js";
import { statusIcon } from "../ui/colors.js";
import chalk from "chalk";

export function registerValidateCommand(program: Command): void {
  program
    .command("validate [path]")
    .description("Validate a spell YAML file")
    .option("--strict", "Treat warnings as errors")
    .option("--json", "Output as JSON")
    .action(async (path: string | undefined, opts: { strict?: boolean; json?: boolean }) => {
      try {
        // Resolve spell file path
        let spellPath = path;
        if (!spellPath) {
          const files = await listFiles(process.cwd(), ".spell.yaml");
          if (files.length === 0) {
            console.log(
              formatWarning("No .spell.yaml files found in current directory. Specify a path."),
            );
            process.exit(1);
          }
          if (files.length === 1) {
            spellPath = resolve(process.cwd(), files[0]);
          } else {
            console.log(
              formatWarning(
                `Multiple spell files found: ${files.join(", ")}. Specify which one.`,
              ),
            );
            process.exit(1);
          }
        } else {
          spellPath = resolve(spellPath);
        }

        // Parse (Zod validation)
        const spell = await parseSpellFile(spellPath);

        // Semantic validation
        const result = validateSpell(spell);

        if (opts.json) {
          console.log(JSON.stringify({
            file: spellPath,
            spell: spell.name,
            version: spell.version,
            ...result,
          }, null, 2));
          return;
        }

        // Print results
        console.log(`\nValidating ${chalk.bold(spell.name)} v${spell.version}\n`);

        if (result.errors.length > 0) {
          console.log(chalk.red("Errors:"));
          for (const err of result.errors) {
            console.log(`  ${statusIcon("fail")} ${err.path}: ${err.message}`);
          }
        }

        if (result.warnings.length > 0) {
          console.log(chalk.yellow("\nWarnings:"));
          for (const warn of result.warnings) {
            console.log(`  ${statusIcon("warn")} ${warn.path}: ${warn.message}`);
          }
        }

        const isValid = opts.strict
          ? result.errors.length === 0 && result.warnings.length === 0
          : result.errors.length === 0;

        if (isValid) {
          const catalystCount = spell.catalysts?.length || 0;
          const catalystInfo = catalystCount > 0 ? `, ${catalystCount} catalyst(s)` : "";
          console.log(
            formatSuccess(
              `\n${spell.name} is valid. ${spell.steps.length} steps, ${spell.requires.tools.length} tool requirements${catalystInfo}.`,
            ),
          );
        } else {
          console.log(
            chalk.red(
              `\nValidation failed: ${result.errors.length} error(s), ${result.warnings.length} warning(s).`,
            ),
          );
          process.exit(1);
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
