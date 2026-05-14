import { resolve, basename } from "node:path";
import type { Command } from "commander";
import { parseSpellFile } from "../core/spell-parser.js";
import { castSpell, type CastOptions } from "../core/spell-executor.js";
import { ConfigManager } from "../core/config-manager.js";
import { handleError } from "../core/error-handler.js";
import { readFile, fileExists, writeFile, ensureDir } from "../utils/fs.js";
import { formatSuccess, formatWarning } from "../ui/format.js";
import { statusIcon } from "../ui/colors.js";
import { printTable } from "../ui/table.js";
import type { ProvidedInput } from "../core/coverage-analyzer.js";
import chalk from "chalk";

export function registerCastCommand(program: Command): void {
  program
    .command("cast <spell>")
    .description("Cast (execute) a spell")
    .option("--dry-run", "Run coverage analysis only, don't execute")
    .option("-v, --verbose", "Verbose output")
    .option("--input <key=val...>", "Provide inputs (key=value pairs)", collectInputs, [])
    .option("--input-file <path>", "Provide an input file")
    .option("--output-dir <dir>", "Output directory", "./output")
    .option("--provider <provider>", "Override LLM provider")
    .option("--model <model>", "Override LLM model")
    .option("--step <id>", "Run only a specific step")
    .option("--skip-quality-checks", "Skip quality gate evaluation")
    .action(async (spellPath: string, opts: {
      dryRun?: boolean;
      verbose?: boolean;
      input: string[];
      inputFile?: string;
      outputDir: string;
      provider?: string;
      model?: string;
      step?: string;
      skipQualityChecks?: boolean;
    }) => {
      try {
        // Resolve spell path
        const resolved = resolve(spellPath);
        if (!(await fileExists(resolved))) {
          // Try appending .spell.yaml
          const withExt = resolve(`${spellPath}.spell.yaml`);
          if (await fileExists(withExt)) {
            spellPath = withExt;
          } else {
            console.log(formatWarning(`Spell file not found: ${resolved}`));
            process.exit(1);
          }
        } else {
          spellPath = resolved;
        }

        // Parse spell
        const spell = await parseSpellFile(spellPath);
        console.log(`\nCasting ${chalk.bold.magenta(spell.name)} v${spell.version}\n`);

        // Gather inputs
        const inputs: ProvidedInput[] = [];

        // From --input key=val pairs
        for (const kv of opts.input) {
          const eqIdx = kv.indexOf("=");
          if (eqIdx > 0) {
            inputs.push({ key: kv.slice(0, eqIdx), value: kv.slice(eqIdx + 1) });
          }
        }

        // From --input-file
        if (opts.inputFile) {
          const filePath = resolve(opts.inputFile);
          if (await fileExists(filePath)) {
            const content = await readFile(filePath);
            const key = basename(filePath).replace(/\.[^.]+$/, "");
            inputs.push({ key, value: content });
          } else {
            console.log(formatWarning(`Input file not found: ${filePath}`));
            process.exit(1);
          }
        }

        // Cast
        const configManager = new ConfigManager();
        const castOptions: CastOptions = {
          dryRun: opts.dryRun,
          verbose: opts.verbose,
          outputDir: opts.outputDir,
          model: opts.model,
          stepId: opts.step,
          skipQualityChecks: opts.skipQualityChecks,
        };

        const result = await castSpell(spell, inputs, configManager, castOptions);

        // Print coverage summary
        if (opts.dryRun || opts.verbose) {
          console.log(chalk.bold("\nCoverage Report:"));
          const coverageRows = result.coverage.items.map((item) => [
            statusIcon(item.status === "matched" ? "ok" : item.required ? "fail" : "warn"),
            item.type,
            item.id,
            item.requirement,
            item.status === "matched" ? chalk.green(item.matchedTo || "matched") : chalk.red("missing"),
          ]);
          printTable(["", "Type", "ID", "Requirement", "Status"], coverageRows);
          console.log(`\nScore: ${chalk.bold(String(result.coverage.score))}%`);
          console.log(`Can cast: ${result.coverage.canCast ? chalk.green("yes") : chalk.red("no")}`);
        }

        if (opts.dryRun) {
          console.log(chalk.dim("\n--dry-run: No steps were executed.\n"));
          return;
        }

        // Print step results
        if (result.steps.length > 0) {
          console.log(chalk.bold("\nStep Results:"));
          for (const step of result.steps) {
            if (step.skipped) {
              console.log(`  ${statusIcon("info")} ${step.stepId} ${chalk.dim("(skipped)")}`);
              continue;
            }
            const qualityInfo = step.qualityPassed !== undefined
              ? ` quality: ${step.qualityPassed ? chalk.green(String(step.qualityScore?.toFixed(2))) : chalk.red(String(step.qualityScore?.toFixed(2)))}`
              : "";
            console.log(
              `  ${statusIcon("ok")} ${step.stepId} (${step.durationMs}ms${step.retryCount > 0 ? `, ${step.retryCount} retries` : ""}${qualityInfo})`,
            );
          }
        }

        // Write outputs
        if (result.success && result.steps.some((s) => s.output)) {
          await ensureDir(opts.outputDir);
          for (const step of result.steps) {
            if (step.output && !step.skipped) {
              const outPath = resolve(opts.outputDir, `${step.stepId}.md`);
              await writeFile(outPath, step.output);
            }
          }
          console.log(formatSuccess(`\nOutputs written to ${chalk.bold(opts.outputDir)}/`));
        }

        console.log(
          `\nTotal time: ${(result.totalDurationMs / 1000).toFixed(1)}s\n`,
        );
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}

function collectInputs(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
