import type { Command } from "commander";
import { ConfigManager } from "../../core/config-manager.js";
import { handleError } from "../../core/error-handler.js";
import { printResult, formatWarning } from "../../ui/format.js";
import { keyValueTable } from "../../ui/table.js";
import { fetchWithTimeout } from "../../utils/network.js";
import type { VerificationStatus } from "../../types/quality.js";
import chalk from "chalk";

export function registerMcpVerifyCommand(mcpCmd: Command): void {
  mcpCmd
    .command("verify <package>")
    .description("Show verification and quality status of a package")
    .option("--json", "Output as JSON")
    .action(async (packageName: string, opts: { json?: boolean }) => {
      try {
        const configManager = new ConfigManager();
        const userConfig = await configManager.loadUserConfig();
        const registryUrl = userConfig.registry?.url || "https://api.pointyhat.org";

        const resp = await fetchWithTimeout(
          `${registryUrl}/v1/mcps/${encodeURIComponent(packageName)}/quality`,
          {},
          10000,
        );

        if (!resp.ok) {
          console.log(formatWarning(`Could not fetch quality data for "${packageName}": ${resp.status}`));
          process.exit(1);
        }

        const status = (await resp.json()) as VerificationStatus;

        if (opts.json) {
          printResult(status, "json");
          return;
        }

        console.log(`\n${chalk.bold("Quality Report:")} ${chalk.magenta(packageName)}\n`);

        const details: Record<string, string> = {
          "Verified": status.verified
            ? chalk.green("Yes") + (status.verifiedAt ? ` (${status.verifiedAt})` : "")
            : chalk.red("No"),
          "Rating": `${status.ratings.average.toFixed(1)}/5 (${status.ratings.count} reviews)`,
        };

        if (status.qualityReport) {
          details["Overall Score"] = `${status.qualityReport.overallScore}/100`;
          details["Tool Coverage"] = `${Math.round(status.qualityReport.toolCoverage * 100)}%`;
          if (status.qualityReport.securityIssues.length > 0) {
            details["Security Issues"] = chalk.red(String(status.qualityReport.securityIssues.length));
          } else {
            details["Security Issues"] = chalk.green("None");
          }
        }

        if (status.scanResult) {
          details["Scan Results"] = [
            status.scanResult.summary.errors > 0 ? chalk.red(`${status.scanResult.summary.errors} errors`) : "",
            status.scanResult.summary.warnings > 0 ? chalk.yellow(`${status.scanResult.summary.warnings} warnings`) : "",
            status.scanResult.summary.info > 0 ? chalk.dim(`${status.scanResult.summary.info} info`) : "",
          ].filter(Boolean).join(", ") || chalk.green("Clean");
        }

        console.log(keyValueTable(details));

        // Platform compatibility
        if (status.compatibilityMatrix && Object.keys(status.compatibilityMatrix).length > 0) {
          console.log(chalk.bold("\nPlatform Compatibility:"));
          for (const [platform, compatible] of Object.entries(status.compatibilityMatrix)) {
            const icon = compatible ? chalk.green("✓") : chalk.red("✗");
            console.log(`  ${icon} ${platform}`);
          }
        }

        console.log("");
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
