import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { detectAllPlatforms } from "../core/platform-detector.js";
import { handleError } from "../core/error-handler.js";
import { isOnline } from "../utils/network.js";
import { statusIcon } from "../ui/colors.js";
import { printTable } from "../ui/table.js";
import { withSpinner } from "../ui/spinner.js";
import { brand } from "../ui/colors.js";
import chalk from "chalk";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  fix?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Diagnose your Pointy Hat environment")
    .option("--fix", "Attempt to auto-fix issues")
    .option("--json", "Output as JSON")
    .action(async (opts: { fix?: boolean; json?: boolean }) => {
      try {
        console.log(`\n${brand()} Doctor\n`);

        const checks: CheckResult[] = [];

        // 1. Provider check
        const providerCheck = await checkProvider();
        checks.push(providerCheck);

        // 2. Platform detection
        const platformChecks = await checkPlatforms();
        checks.push(...platformChecks);

        // 3. Project config check
        const configCheck = await checkProjectConfig();
        checks.push(configCheck);

        // 4. Registry connectivity
        const registryCheck = await checkRegistry();
        checks.push(registryCheck);

        // 5. CLI version
        checks.push({
          name: "CLI Version",
          status: "ok",
          message: "v0.1.0 (latest check not yet implemented)",
        });

        if (opts.json) {
          console.log(JSON.stringify(checks, null, 2));
          return;
        }

        // Print results
        const rows = checks.map((c) => [
          statusIcon(c.status),
          c.name,
          c.message,
        ]);
        printTable(["", "Check", "Status"], rows);

        const failures = checks.filter((c) => c.status === "fail");
        const warnings = checks.filter((c) => c.status === "warn");

        if (failures.length > 0) {
          console.log(chalk.red(`\n${failures.length} issue(s) found.`));
          if (opts.fix) {
            for (const f of failures) {
              if (f.fix) console.log(chalk.dim(`  Fix: ${f.fix}`));
            }
          } else {
            console.log(chalk.dim("Run with --fix to attempt auto-repair.\n"));
          }
        } else if (warnings.length > 0) {
          console.log(chalk.yellow(`\n${warnings.length} warning(s), but everything should work.\n`));
        } else {
          console.log(chalk.green("\nAll checks passed!\n"));
        }
      } catch (err) {
        handleError(err);
      }
    });
}

async function checkProvider(): Promise<CheckResult> {
  try {
    const mgr = new ConfigManager();
    const config = await mgr.loadUserConfig();
    const defaultId = await mgr.getDefaultProviderId();

    if (!defaultId) {
      return {
        name: "LLM Provider",
        status: "fail",
        message: "No provider configured",
        fix: "Run `pointyhat provider setup`",
      };
    }

    const providerConfig = await mgr.getProvider(defaultId);
    if (!providerConfig) {
      return {
        name: "LLM Provider",
        status: "fail",
        message: `Provider "${defaultId}" configured but has no settings`,
        fix: `Run \`pointyhat provider set ${defaultId} --api-key <key>\``,
      };
    }

    const hasKey = !!providerConfig.api_key || defaultId === "ollama";
    if (!hasKey) {
      return {
        name: "LLM Provider",
        status: "warn",
        message: `Provider "${defaultId}" configured but no API key set`,
        fix: `Run \`pointyhat provider set ${defaultId} --api-key <key>\``,
      };
    }

    return {
      name: "LLM Provider",
      status: "ok",
      message: `${defaultId} (model: ${providerConfig.model})`,
    };
  } catch {
    return {
      name: "LLM Provider",
      status: "fail",
      message: "Could not load config",
      fix: "Run `pointyhat provider setup`",
    };
  }
}

async function checkPlatforms(): Promise<CheckResult[]> {
  const result = await detectAllPlatforms();
  const checks: CheckResult[] = [];

  const detected = result.platforms.filter(
    (p) => p.status === "ok" || p.status === "missing-config",
  );

  if (detected.length === 0) {
    checks.push({
      name: "Agent Platforms",
      status: "warn",
      message: "No agent platforms detected (optional for standalone casting)",
    });
  } else {
    for (const p of detected) {
      checks.push({
        name: `Platform: ${p.name}`,
        status: p.status === "ok" ? "ok" : "warn",
        message:
          p.status === "ok"
            ? `Config: ${p.configPath}`
            : "Installed but no config file",
        fix:
          p.status === "missing-config"
            ? `Run \`pointyhat init --platform ${p.id}\``
            : undefined,
      });
    }
  }

  return checks;
}

async function checkProjectConfig(): Promise<CheckResult> {
  try {
    const mgr = new ConfigManager();
    await mgr.discoverProjectConfig();
    const config = await mgr.loadProjectConfig();

    if (!config) {
      return {
        name: "Project Config",
        status: "warn",
        message: "No pointyhat.yaml found in current directory tree",
        fix: "Run `pointyhat init` to create one",
      };
    }

    return {
      name: "Project Config",
      status: "ok",
      message: `Found pointyhat.yaml (${Object.keys(config.mcps).length} MCPs, ${Object.keys(config.spells).length} spells)`,
    };
  } catch (err) {
    return {
      name: "Project Config",
      status: "fail",
      message: `Config error: ${err}`,
      fix: "Check pointyhat.yaml for syntax errors",
    };
  }
}

async function checkRegistry(): Promise<CheckResult> {
  try {
    const online = await isOnline();
    return {
      name: "Registry",
      status: online ? "ok" : "warn",
      message: online
        ? "api.pointyhat.org is reachable"
        : "Cannot reach api.pointyhat.org (offline mode available)",
    };
  } catch {
    return {
      name: "Registry",
      status: "warn",
      message: "Could not check registry connectivity",
    };
  }
}
