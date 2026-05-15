/**
 * Agent-based spell executor.
 *
 * Replaces the old spell-executor.ts prompt orchestrator. Instead of calling
 * LLM APIs directly in a bounded loop, this module:
 * 1. Resolves spell requirements (coverage, catalysts, MCP servers)
 * 2. Builds an agent mission from the spell
 * 3. Spawns an autonomous agent to execute the mission
 * 4. Independently verifies outcomes via wards
 * 5. Retries with feedback if wards fail
 */

import { join } from "node:path";
import type { SpellDefinition } from "../types/spell.js";
import type { CoverageResult } from "../types/coverage.js";
import type { McpServerConfig } from "../agents/runtime.js";
import type { ProvidedInput } from "./coverage-analyzer.js";
import { analyzeCoverage } from "./coverage-analyzer.js";
import { ConfigManager } from "./config-manager.js";
import { RegistryClient } from "./registry-client.js";
import { Cache } from "./cache.js";
import { resolveCatalysts, type ResolvedCatalyst } from "./catalyst-resolver.js";
import { parseLockfile } from "./lockfile.js";
import { getRuntimeById, autoSelectRuntime } from "../agents/registry.js";
import { buildMission } from "../agents/mission-builder.js";
import {
  parseWardsFromSpell,
  evaluateAllWards,
  formatWardFeedback,
  type WardResult,
  type WardDefinition,
} from "./wards.js";
import {
  E_AGENT_NOT_AVAILABLE,
  E_AGENT_EXECUTION_FAILED,
  E_COVERAGE_INSUFFICIENT,
} from "./error-handler.js";
import chalk from "chalk";

// ── Public types ────────────────────────────────────────────────────────────

export interface AgentCastOptions {
  dryRun?: boolean;
  verbose?: boolean;
  outputDir?: string;
  agentId?: string;
  skipWards?: boolean;
  streamOutput?: boolean;
  timeout?: number;
}

export interface AgentCastResult {
  spellName: string;
  coverage: CoverageResult;
  wards: WardResult[];
  totalDurationMs: number;
  agentOutput: string;
  success: boolean;
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function castSpellWithAgent(
  spell: SpellDefinition,
  inputs: ProvidedInput[],
  configManager: ConfigManager,
  options: AgentCastOptions = {},
): Promise<AgentCastResult> {
  const startTime = Date.now();
  const outputDir = options.outputDir || "./output";

  // 1. Select agent runtime
  const runtime = options.agentId
    ? getRuntimeById(options.agentId)
    : await autoSelectRuntime();

  if (!runtime) {
    throw options.agentId
      ? E_AGENT_NOT_AVAILABLE(options.agentId)
      : E_AGENT_NOT_AVAILABLE("(none found)");
  }

  if (!(await runtime.isAvailable())) {
    throw E_AGENT_NOT_AVAILABLE(runtime.id);
  }

  if (options.verbose) {
    console.log(chalk.dim(`  Agent runtime: ${runtime.name} (${runtime.id})`));
  }

  // 2. Resolve MCP server configs from lockfile (don't spawn — agent does that)
  const mcpServers = await resolveMcpConfigs(spell, configManager, options);

  // 3. Resolve catalysts
  let catalysts = new Map<string, ResolvedCatalyst>();
  if (spell.catalysts.length > 0) {
    try {
      const userConfig = await configManager.loadUserConfig();
      const cache = new Cache(userConfig.cache?.directory);
      const registryClient = new RegistryClient({
        baseUrl: userConfig.registry?.url,
        timeout: userConfig.registry?.timeout,
        cache,
        cacheTtl: userConfig.cache?.ttl,
      });
      catalysts = await resolveCatalysts(spell, registryClient, cache);
      if (options.verbose) {
        console.log(chalk.dim(`  Resolved ${catalysts.size} catalyst(s)`));
      }
    } catch (err) {
      if (options.verbose) {
        console.log(chalk.yellow(`  Failed to resolve catalysts: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
  }

  // 4. Coverage analysis
  const availableTools = new Set<string>();
  for (const tool of spell.requires.tools) {
    const match = tool.uri.match(/^mcp:\/\/([^/]+)\/(.+)/);
    if (match && mcpServers[match[1]]) {
      availableTools.add(`${match[1]}/${match[2]}`);
    }
  }
  const coverage = analyzeCoverage(spell, availableTools, inputs);

  if (options.verbose) {
    console.log(chalk.bold("\n  Coverage Analysis:"));
    console.log(`  Score: ${coverage.score}%`);
    console.log(`  Can cast: ${coverage.canCast ? chalk.green("yes") : chalk.red("no")}`);
    if (coverage.missingRequired.length > 0) {
      console.log(chalk.red("  Missing required:"));
      for (const item of coverage.missingRequired) {
        console.log(`    - ${item.id}: ${item.requirement}`);
      }
    }
    console.log();
  }

  if (options.dryRun) {
    return {
      spellName: spell.name,
      coverage,
      wards: [],
      totalDurationMs: Date.now() - startTime,
      agentOutput: "",
      success: true,
    };
  }

  // 5. Parse wards from spell
  const wards = parseWardsFromSpell(spell, outputDir);

  if (options.verbose && wards.length > 0) {
    console.log(chalk.dim(`  ${wards.length} ward(s) will be evaluated after execution`));
  }

  // 6. Build and execute agent mission (with retry loop for ward failures)
  const maxWardRetries = Math.max(...wards.map((w) => w.maxRetries), 1);
  let wardFeedback: string | undefined;
  let agentOutput = "";
  let wardResults: WardResult[] = [];

  for (let attempt = 0; attempt <= maxWardRetries; attempt++) {
    if (attempt > 0) {
      console.log(chalk.yellow(`\n  Ward verification failed — retrying (attempt ${attempt + 1}/${maxWardRetries + 1})...\n`));
    }

    const mission = buildMission(spell, inputs, {
      outputDir,
      workingDirectory: configManager.getProjectDir() || process.cwd(),
      mcpServers,
      timeout: options.timeout ?? 0,
      streamOutput: options.streamOutput ?? true,
      catalysts,
      wards,
      wardFeedback,
    });

    if (options.verbose) {
      console.log(chalk.dim(`  Launching agent...`));
      console.log();
    }

    const result = await runtime.execute(mission);
    agentOutput = result.output;

    if (!result.completed) {
      throw E_AGENT_EXECUTION_FAILED(
        result.exitCode === 1 && result.output
          ? result.output.slice(-500)
          : `Agent exited with code ${result.exitCode}`,
      );
    }

    if (options.verbose) {
      console.log(chalk.dim(`\n  Agent completed in ${(result.durationMs / 1000).toFixed(1)}s`));
    }

    // 7. Evaluate wards
    if (options.skipWards || wards.length === 0) {
      wardResults = [];
      break;
    }

    wardResults = await evaluateAllWards(wards, agentOutput);

    const allPassed = wardResults.every((r) => r.passed);

    if (options.verbose || !allPassed) {
      console.log(chalk.bold("\n  Ward Results:"));
      for (const wr of wardResults) {
        const icon = wr.passed ? chalk.green("✓") : chalk.red("✗");
        console.log(`  ${icon} ${wr.wardId}: ${wr.message}`);
      }
    }

    if (allPassed) {
      break;
    }

    // Check if any failed wards allow retry
    const retryableFailures = wardResults.filter(
      (r) => !r.passed && wards.find((w) => w.id === r.wardId)?.retryOnFailure,
    );

    if (retryableFailures.length === 0 || attempt >= maxWardRetries) {
      // No retryable failures or exhausted retries
      break;
    }

    // Build feedback for next attempt
    wardFeedback = formatWardFeedback(wardResults);
  }

  const success = wardResults.length === 0 || wardResults.every((r) => r.passed);

  return {
    spellName: spell.name,
    coverage,
    wards: wardResults,
    totalDurationMs: Date.now() - startTime,
    agentOutput,
    success,
  };
}

// ── MCP server config resolution ────────────────────────────────────────────

/**
 * Resolve MCP server configurations from the lockfile.
 * Unlike the old executor, we don't spawn the servers — we just extract
 * the command/args so the agent runtime can manage them.
 */
async function resolveMcpConfigs(
  spell: SpellDefinition,
  configManager: ConfigManager,
  options: AgentCastOptions,
): Promise<Record<string, McpServerConfig>> {
  const configs: Record<string, McpServerConfig> = {};

  // Extract unique server names from tool URIs
  const serverNames = new Set<string>();
  for (const tool of spell.requires.tools) {
    const match = tool.uri.match(/^mcp:\/\/([^/]+)/);
    if (match) serverNames.add(match[1]);
  }

  if (serverNames.size === 0) return configs;

  // Look up server commands from lockfile
  const projectDir = configManager.getProjectDir() || process.cwd();
  const lockPath = join(projectDir, "pointyhat.lock");
  const lockfile = await parseLockfile(lockPath);

  for (const serverName of serverNames) {
    const lockEntry = lockfile?.mcps[serverName];
    if (!lockEntry?.command) {
      if (options.verbose) {
        console.log(chalk.yellow(`  MCP server "${serverName}" not found in lockfile, skipping`));
      }
      continue;
    }

    configs[serverName] = {
      command: lockEntry.command,
      args: lockEntry.args || [],
    };

    if (options.verbose) {
      console.log(chalk.dim(`  MCP config: ${serverName} → ${lockEntry.command}`));
    }
  }

  return configs;
}
