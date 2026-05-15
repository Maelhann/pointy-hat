import { resolve, basename } from "node:path";
import type { Command } from "commander";
import { parseSpellFile } from "../core/spell-parser.js";
import { castSpellWithAgent, type AgentCastOptions } from "../core/agent-executor.js";
import { ConfigManager } from "../core/config-manager.js";
import { handleError } from "../core/error-handler.js";
import { readFile, fileExists } from "../utils/fs.js";
import { formatSuccess, formatWarning } from "../ui/format.js";
import { statusIcon } from "../ui/colors.js";
import { printTable } from "../ui/table.js";
import type { ProvidedInput } from "../core/coverage-analyzer.js";
import chalk from "chalk";

export function registerCastCommand(program: Command): void {
  program
    .command("cast <spell>")
    .description("Cast (execute) a spell via an autonomous agent")
    .option("--dry-run", "Run coverage analysis only, don't execute")
    .option("-v, --verbose", "Verbose output")
    .option("--input <key=val...>", "Provide inputs (key=value pairs)", collectInputs, [])
    .option("--input-file <path>", "Provide an input file")
    .option("--output-dir <dir>", "Output directory", "./output")
    .option("--agent <runtime>", "Agent runtime to use (e.g. claude-code)")
    .option("--skip-wards", "Skip ward verification after execution")
    .option("--timeout <seconds>", "Maximum agent execution time in seconds", parseInt)
    .option("--no-stream", "Don't stream agent output to terminal")
    .action(async (spellPath: string, opts: {
      dryRun?: boolean;
      verbose?: boolean;
      input: string[];
      inputFile?: string;
      outputDir: string;
      agent?: string;
      skipWards?: boolean;
      timeout?: number;
      stream?: boolean;
    }) => {
      try {
        // Resolve spell path
        const resolved = resolve(spellPath);
        if (!(await fileExists(resolved))) {
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

        for (const kv of opts.input) {
          const eqIdx = kv.indexOf("=");
          if (eqIdx > 0) {
            inputs.push({ key: kv.slice(0, eqIdx), value: kv.slice(eqIdx + 1) });
          }
        }

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

        // Cast via agent
        const configManager = new ConfigManager();
        const castOptions: AgentCastOptions = {
          dryRun: opts.dryRun,
          verbose: opts.verbose,
          outputDir: opts.outputDir,
          agentId: opts.agent,
          skipWards: opts.skipWards,
          timeout: opts.timeout,
          streamOutput: opts.stream !== false,
        };

        const result = await castSpellWithAgent(spell, inputs, configManager, castOptions);

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
          console.log(chalk.dim("\n--dry-run: No execution performed.\n"));
          return;
        }

        // Print ward results
        if (result.wards.length > 0) {
          console.log(chalk.bold("\nWard Results:"));
          for (const ward of result.wards) {
            const icon = ward.passed ? chalk.green("✓") : chalk.red("✗");
            console.log(`  ${icon} ${ward.wardId} (${ward.durationMs}ms)`);
            if (!ward.passed) {
              console.log(chalk.red(`    ${ward.message}`));
            }
          }
        }

        const wardsPassed = result.wards.filter((w) => w.passed).length;
        const wardsTotal = result.wards.length;

        if (result.success) {
          console.log(formatSuccess(
            wardsTotal > 0
              ? `\nSpell cast successfully — ${wardsPassed}/${wardsTotal} wards passed.`
              : `\nSpell cast successfully.`,
          ));
        } else {
          console.log(chalk.red(
            `\nSpell cast completed with ward failures — ${wardsPassed}/${wardsTotal} wards passed.`,
          ));
        }

        console.log(
          `\nTotal time: ${(result.totalDurationMs / 1000).toFixed(1)}s\n`,
        );

        if (!result.success) process.exit(1);
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}

function collectInputs(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
