import type { Command } from "commander";
import { ConfigManager } from "../../core/config-manager.js";
import { AuthManager } from "../../core/auth-manager.js";
import { handleError } from "../../core/error-handler.js";
import { formatSuccess, formatWarning } from "../../ui/format.js";
import { fetchWithTimeout } from "../../utils/network.js";
import chalk from "chalk";

export function registerQualityRateCommand(qualityCmd: Command): void {
  qualityCmd
    .command("rate <package> <score>")
    .description("Rate an MCP package (1-5)")
    .option("--review <text>", "Write a review")
    .action(async (packageName: string, scoreStr: string, opts: {
      review?: string;
    }) => {
      try {
        const score = parseInt(scoreStr, 10);
        if (isNaN(score) || score < 1 || score > 5) {
          console.log(formatWarning("Score must be between 1 and 5."));
          process.exit(1);
        }

        // Require auth
        const authManager = new AuthManager();
        const headers = await authManager.getAuthHeaders();

        const configManager = new ConfigManager();
        const userConfig = await configManager.loadUserConfig();
        const registryUrl = userConfig.registry?.url || "https://api.pointyhat.org";

        // Submit rating
        const resp = await fetchWithTimeout(
          `${registryUrl}/v1/mcps/${encodeURIComponent(packageName)}/ratings`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            body: JSON.stringify({
              score,
              review: opts.review || undefined,
            }),
          },
          10000,
        );

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          console.log(formatWarning(`Failed to submit rating: ${resp.status} ${errBody}`));
          process.exit(1);
        }

        console.log(formatSuccess(
          `Rated ${chalk.bold(packageName)} ${chalk.yellow("★".repeat(score))}${chalk.dim("★".repeat(5 - score))}`,
        ));

        if (opts.review) {
          console.log(chalk.dim(`  Review: "${opts.review}"`));
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
