import { join } from "node:path";
import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { detectAllPlatforms } from "../core/platform-detector.js";
import { getDefaultProjectConfig } from "../types/config.js";
import { handleError } from "../core/error-handler.js";
import { fileExists } from "../utils/fs.js";
import { writeYamlFile } from "../utils/yaml.js";
import { writeJsonFile } from "../utils/fs.js";
import { formatSuccess, formatWarning } from "../ui/format.js";
import { confirm, multiSelect } from "../ui/prompt.js";
import { withSpinner } from "../ui/spinner.js";
import { brand } from "../ui/colors.js";
import chalk from "chalk";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize Pointy Hat in the current directory")
    .option("-y, --yes", "Skip prompts, use defaults")
    .option("--platform <platform>", "Pre-select platform")
    .action(async (opts: { yes?: boolean; platform?: string }) => {
      try {
        console.log(`\n${brand()} Init\n`);

        const cwd = process.cwd();
        const yamlPath = join(cwd, "pointyhat.yaml");
        const lockPath = join(cwd, "pointyhat.lock");

        // Check existing
        if (await fileExists(yamlPath)) {
          if (!opts.yes) {
            const overwrite = await confirm(
              "pointyhat.yaml already exists. Overwrite?",
              false,
            );
            if (!overwrite) {
              console.log("Cancelled.");
              return;
            }
          }
        }

        // Check provider config
        const mgr = new ConfigManager();
        const defaultProvider = await mgr.getDefaultProviderId();
        if (!defaultProvider) {
          console.log(
            formatWarning(
              "No LLM provider configured yet. Run `pointyhat provider setup` to set one up.\n",
            ),
          );
        }

        // Detect platforms
        const detection = await withSpinner("Detecting platforms...", async () => {
          return detectAllPlatforms();
        });

        let selectedPlatforms: string[] = [];

        if (opts.platform) {
          selectedPlatforms = [opts.platform];
        } else if (detection.detectedCount > 0) {
          const detected = detection.platforms
            .filter((p) => p.status === "ok" || p.status === "missing-config")
            .map((p) => ({
              name: `${p.name} ${p.status === "ok" ? chalk.green("(configured)") : chalk.yellow("(detected)")}`,
              value: p.id,
            }));

          if (opts.yes) {
            selectedPlatforms = detected.map((d) => d.value);
          } else if (detected.length > 0) {
            selectedPlatforms = await multiSelect(
              "Which platforms should Pointy Hat manage?",
              detected,
            );
          }
        }

        if (detection.detectedCount === 0 && !opts.platform) {
          console.log(
            chalk.dim(
              "  No agent platforms detected. You can still use standalone casting.\n",
            ),
          );
        }

        // Generate project config
        const config = getDefaultProjectConfig();
        config.platforms = selectedPlatforms;

        await writeYamlFile(yamlPath, config);
        console.log(formatSuccess(`Created ${chalk.bold("pointyhat.yaml")}`));

        // Generate lockfile
        const lockfile = {
          lockfileVersion: 1,
          generatedAt: new Date().toISOString(),
          mcps: {},
          spells: {},
        };
        await writeYamlFile(lockPath, lockfile);
        console.log(formatSuccess(`Created ${chalk.bold("pointyhat.lock")}`));

        // Summary
        console.log(`\n${chalk.bold("Next steps:")}`);
        if (!defaultProvider) {
          console.log(`  1. ${chalk.cyan("pointyhat provider setup")} - Configure your LLM provider`);
          console.log(`  2. ${chalk.cyan("pointyhat create my-spell")} - Create your first spell`);
        } else {
          console.log(`  1. ${chalk.cyan("pointyhat create my-spell")} - Create your first spell`);
          console.log(`  2. ${chalk.cyan("pointyhat cast my-spell")} - Cast it`);
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });
}
