import { resolve } from "node:path";
import type { Command } from "commander";
import { parseSpellFile } from "../../core/spell-parser.js";
import { scanSpell, scanMcpPackage, buildScanResult } from "../../core/security-scanner.js";
import { handleError } from "../../core/error-handler.js";
import { printTable } from "../../ui/table.js";
import { formatSuccess, formatWarning, printResult } from "../../ui/format.js";
import { fileExists } from "../../utils/fs.js";
import type { ScanFinding } from "../../types/quality.js";
import chalk from "chalk";

export function registerQualityScanCommand(qualityCmd: Command): void {
  qualityCmd
    .command("scan [path]")
    .description("Security scan a spell YAML or MCP package")
    .option("--json", "Output as JSON")
    .option("--severity <level>", "Minimum severity to show (error, warn, info)", "info")
    .action(async (path: string | undefined, opts: {
      json?: boolean;
      severity: string;
    }) => {
      try {
        // Default to scanning *.spell.yaml in current directory
        const targetPath = path ? resolve(path) : await findSpellFile();

        if (!targetPath) {
          console.log(formatWarning("No spell file found. Specify a path: pointyhat quality scan <path>"));
          process.exit(1);
        }

        if (!(await fileExists(targetPath))) {
          console.log(formatWarning(`File not found: ${targetPath}`));
          process.exit(1);
        }

        // Parse and scan
        const spell = await parseSpellFile(targetPath);
        const findings = scanSpell(spell);

        // Filter by severity
        const severityOrder: Record<string, number> = { error: 0, warn: 1, info: 2 };
        const minSeverity = severityOrder[opts.severity] ?? 2;
        const filtered = findings.filter(
          (f) => severityOrder[f.severity] <= minSeverity,
        );

        const result = buildScanResult(filtered);

        if (opts.json) {
          printResult(result, "json");
          // Exit with error code if errors found
          if (result.summary.errors > 0) process.exit(1);
          return;
        }

        console.log(`\n${chalk.bold("Security Scan:")} ${chalk.magenta(spell.name)} v${spell.version}\n`);

        if (filtered.length === 0) {
          console.log(formatSuccess("No security issues found."));
          console.log("");
          return;
        }

        // Display findings
        printTable(
          ["Severity", "Rule", "Location", "Message"],
          filtered.map((f) => [
            severityBadge(f.severity),
            f.rule,
            chalk.dim(f.location),
            f.message,
          ]),
        );

        // Summary
        console.log(`\n${chalk.bold("Summary:")} ${chalk.red(`${result.summary.errors} error(s)`)}, ${chalk.yellow(`${result.summary.warnings} warning(s)`)}, ${chalk.dim(`${result.summary.info} info`)}\n`);

        // Exit code 1 if errors found
        if (result.summary.errors > 0) {
          process.exit(1);
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}

function severityBadge(severity: string): string {
  switch (severity) {
    case "error": return chalk.red.bold("ERROR");
    case "warn": return chalk.yellow.bold("WARN");
    case "info": return chalk.dim("INFO");
    default: return severity;
  }
}

async function findSpellFile(): Promise<string | null> {
  const { listFiles } = await import("../../utils/fs.js");
  const files = await listFiles(process.cwd(), ".spell.yaml");
  if (files.length > 0) {
    return resolve(process.cwd(), files[0]);
  }
  // Also try .yaml files
  const yamlFiles = await listFiles(process.cwd(), ".yaml");
  const spellFile = yamlFiles.find((f) => f.includes("spell"));
  return spellFile ? resolve(process.cwd(), spellFile) : null;
}
