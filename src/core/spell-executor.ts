/**
 * @deprecated Use `agent-executor.ts` instead. This module uses direct LLM API
 * calls in a bounded loop. The new agent-based executor delegates to autonomous
 * agents (Claude Code, etc.) and verifies outcomes via wards.
 *
 * Retained for backward compatibility — will be removed in a future version.
 */

import type { SpellDefinition, SpellStep, SpellOutput, QualityCheck } from "../types/spell.js";
import type { LLMResponse, ContentBlock, Message, ToolDefinition } from "../types/provider.js";
import type { QualityCheckResult } from "../types/quality.js";
import type { CoverageResult } from "../types/coverage.js";
import type { McpToolDefinition } from "../types/mcp-package.js";
import { LLMClient } from "./llm-client.js";
import { ConfigManager } from "./config-manager.js";
import { McpSubprocess } from "./mcp-subprocess.js";
import { parseLockfile } from "./lockfile.js";
import { analyzeCoverage, type ProvidedInput } from "./coverage-analyzer.js";
import { topologicalSort } from "./spell-parser.js";
import { resolveCatalysts, type ResolvedCatalyst } from "./catalyst-resolver.js";
import { resolveArtifact, assembleArtifact, type ResolvedArtifact } from "./artifact-resolver.js";
import { RegistryClient } from "./registry-client.js";
import { Cache } from "./cache.js";
import { E_QUALITY_CHECK_FAILED, E_COVERAGE_INSUFFICIENT } from "./error-handler.js";
import { createProgressBar } from "../ui/progress.js";
import { join } from "node:path";
import chalk from "chalk";

const MAX_ITERATIONS_PER_STEP = 25;

export interface CastOptions {
  dryRun?: boolean;
  verbose?: boolean;
  outputDir?: string;
  providerId?: string;
  model?: string;
  skipQualityChecks?: boolean;
  stepId?: string; // run only this step
}

export interface StepResult {
  stepId: string;
  output: string;
  qualityScore?: number;
  qualityPassed?: boolean;
  qualityFeedback?: string;
  retryCount: number;
  durationMs: number;
  skipped?: boolean;
}

export interface ArtifactSectionResult {
  sectionId: string;
  content: string;
  qualityScore?: number;
  qualityPassed?: boolean;
  qualityFeedback?: string;
  retryCount: number;
  durationMs: number;
}

export interface OutcomeResult {
  id: string;
  kind: 'output' | 'effect';
  output: string;
  qualityScore?: number;
  qualityPassed?: boolean;
  qualityFeedback?: string;
  retryCount: number;
  durationMs: number;
  artifactSections?: ArtifactSectionResult[];
}

export interface CastResult {
  spellName: string;
  coverage: CoverageResult;
  steps: StepResult[];
  outcomes: OutcomeResult[];
  totalDurationMs: number;
  success: boolean;
}

// Map from MCP server name to its subprocess and tools
interface McpServerState {
  subprocess: McpSubprocess;
  tools: McpToolDefinition[];
  toolNames: Set<string>;
}

export async function castSpell(
  spell: SpellDefinition,
  inputs: ProvidedInput[],
  configManager: ConfigManager,
  options: CastOptions = {},
): Promise<CastResult> {
  const startTime = Date.now();
  const llmClient = new LLMClient(configManager);

  // Start MCP subprocesses for required tools
  const mcpServers = new Map<string, McpServerState>();
  const allToolDefs: ToolDefinition[] = [];
  const toolToServer = new Map<string, string>(); // tool name -> server name

  try {
    // Resolve and start MCP servers from spell requirements
    if (spell.requires.tools.length > 0) {
      await startMcpServers(spell, configManager, mcpServers, allToolDefs, toolToServer, options);
    }

    // Resolve catalysts
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

    // Phase 1: Coverage Analysis
    const availableTools = new Set<string>(toolToServer.keys());
    const coverage = analyzeCoverage(spell, availableTools, inputs);

    if (options.verbose) {
      console.log(chalk.bold("\n Coverage Analysis:"));
      console.log(`  Score: ${coverage.score}%`);
      console.log(`  Can cast: ${coverage.canCast ? chalk.green("yes") : chalk.red("no")}`);
      if (coverage.missingRequired.length > 0) {
        console.log(chalk.red("  Missing required:"));
        for (const item of coverage.missingRequired) {
          console.log(`    - ${item.id}: ${item.requirement}`);
        }
      }
      if (coverage.warnings.length > 0) {
        for (const w of coverage.warnings) {
          console.log(chalk.yellow(`  ! ${w}`));
        }
      }
      if (allToolDefs.length > 0) {
        console.log(chalk.dim(`  MCP tools available: ${allToolDefs.length}`));
      }
      console.log();
    }

    if (options.dryRun) {
      return {
        spellName: spell.name,
        coverage,
        steps: [],
        outcomes: [],
        totalDurationMs: Date.now() - startTime,
        success: true,
      };
    }

    // Phase 2: Execution (guided or outcome-driven)
    const results: StepResult[] = [];
    const outcomeResults: OutcomeResult[] = [];

    if (spell.steps.length > 0) {
      // ── GUIDED MODE: execute steps, then evaluate outcome quality checks ──
      const sortedSteps = topologicalSort(spell.steps);
      const stepResults = new Map<string, string>();

      const progress = createProgressBar(sortedSteps.length, `Casting ${spell.name}`);

      for (let i = 0; i < sortedSteps.length; i++) {
        const step = sortedSteps[i];
        progress.update(i + 1, step.id);

        if (options.stepId && step.id !== options.stepId) {
          results.push({ stepId: step.id, output: "", retryCount: 0, durationMs: 0, skipped: true });
          continue;
        }

        if (step.optional && step.inputs_needed) {
          const hasAll = step.inputs_needed.every((id) => inputs.some((i) => i.key === id));
          if (!hasAll) {
            stepResults.set(step.id, "");
            results.push({ stepId: step.id, output: "", retryCount: 0, durationMs: 0, skipped: true });
            continue;
          }
        }

        const stepStart = Date.now();
        const context = buildStepContext(step, stepResults, catalysts);
        const stepTools = filterToolsForStep(step, allToolDefs);

        let output = await executeStep(step, context, inputs, stepTools, llmClient, mcpServers, toolToServer, options);
        let retryCount = 0;
        let qualityCheckResult: QualityCheckResult | undefined;

        if (step.quality_check && !options.skipQualityChecks) {
          qualityCheckResult = await evaluateQualityCheck(output, step.quality_check, llmClient, options);

          if (qualityCheckResult.score < step.quality_check.min_score) {
            if (step.quality_check.retry_on_failure) {
              const maxRetries = step.quality_check.max_retries || 2;
              for (let attempt = 0; attempt < maxRetries; attempt++) {
                retryCount++;
                if (options.verbose) {
                  console.log(chalk.yellow(`  Quality check failed (${qualityCheckResult.score.toFixed(2)}), retrying ${retryCount}/${maxRetries}...`));
                }
                const retryContext = buildStepContext(step, stepResults, catalysts) +
                  `\n--- Quality check feedback (score: ${qualityCheckResult.score.toFixed(2)}) ---\n${qualityCheckResult.feedback}\n\nPlease address the feedback and improve your output.\n`;
                output = await executeStep(step, retryContext, inputs, stepTools, llmClient, mcpServers, toolToServer, options);
                qualityCheckResult = await evaluateQualityCheck(output, step.quality_check, llmClient, options);
                if (qualityCheckResult.score >= step.quality_check.min_score) break;
              }
            }
            if (qualityCheckResult.score < step.quality_check.min_score) {
              progress.fail(`Quality check failed for step "${step.id}"`);
              throw E_QUALITY_CHECK_FAILED(step.id, qualityCheckResult.feedback);
            }
          }
        }

        stepResults.set(step.id, output);
        results.push({
          stepId: step.id, output,
          qualityScore: qualityCheckResult?.score,
          qualityPassed: qualityCheckResult?.passed,
          qualityFeedback: qualityCheckResult?.feedback,
          retryCount, durationMs: Date.now() - stepStart,
        });
      }

      progress.complete();

      // Evaluate quality checks on outputs and effects (using combined step output)
      if (!options.skipQualityChecks) {
        const combinedOutput = [...stepResults.values()].join("\n\n");
        const artifactContext = {
          inputs, catalysts, tools: allToolDefs,
          mcpServers, toolToServer, configManager,
        };
        await evaluateOutcomeQualityChecks(spell, combinedOutput, llmClient, outcomeResults, options, artifactContext);
      }
    } else {
      // ── OUTCOME-DRIVEN MODE: no steps, LLM plans own execution ──
      const progress = createProgressBar(1, `Casting ${spell.name}`);
      progress.update(1, "outcome-driven");

      const output = await executeOutcomeDriven(spell, inputs, allToolDefs, llmClient, mcpServers, toolToServer, catalysts, options);

      progress.complete();

      // Evaluate quality checks on each output and effect
      if (!options.skipQualityChecks) {
        const artifactContext = {
          inputs, catalysts, tools: allToolDefs,
          mcpServers, toolToServer, configManager,
        };
        await evaluateOutcomeQualityChecks(spell, output, llmClient, outcomeResults, options, artifactContext);
      }
    }

    return {
      spellName: spell.name,
      coverage,
      steps: results,
      outcomes: outcomeResults,
      totalDurationMs: Date.now() - startTime,
      success: true,
    };
  } finally {
    // Always kill MCP subprocesses
    for (const [name, server] of mcpServers) {
      try {
        server.subprocess.kill();
      } catch {
        // Best effort cleanup
      }
    }
  }
}

async function startMcpServers(
  spell: SpellDefinition,
  configManager: ConfigManager,
  mcpServers: Map<string, McpServerState>,
  allToolDefs: ToolDefinition[],
  toolToServer: Map<string, string>,
  options: CastOptions,
): Promise<void> {
  // Extract unique server names from tool URIs (e.g., "mcp://filesystem/read_file" -> "filesystem")
  const serverNames = new Set<string>();
  for (const tool of spell.requires.tools) {
    const match = tool.uri.match(/^mcp:\/\/([^/]+)/);
    if (match) serverNames.add(match[1]);
  }

  if (serverNames.size === 0) return;

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

    try {
      if (options.verbose) {
        console.log(chalk.dim(`  Starting MCP server: ${serverName}`));
      }

      const subprocess = new McpSubprocess(
        lockEntry.command,
        lockEntry.args || [],
        undefined,
        30000,
      );
      await subprocess.start();

      const tools = await subprocess.listTools();
      const toolNames = new Set(tools.map((t) => t.name));

      mcpServers.set(serverName, { subprocess, tools, toolNames });

      // Convert MCP tools to provider format and register
      for (const tool of tools) {
        const providerTool: ToolDefinition = {
          name: tool.name,
          description: tool.description || "",
          input_schema: tool.inputSchema,
        };
        allToolDefs.push(providerTool);
        toolToServer.set(tool.name, serverName);
      }

      if (options.verbose) {
        console.log(chalk.dim(`  ${serverName}: ${tools.length} tools available`));
      }
    } catch (err) {
      if (options.verbose) {
        console.log(chalk.yellow(`  Failed to start MCP server "${serverName}": ${err instanceof Error ? err.message : String(err)}`));
      }
    }
  }
}

function filterToolsForStep(step: SpellStep, allTools: ToolDefinition[]): ToolDefinition[] {
  if (!step.tools_needed || step.tools_needed.length === 0) return allTools;

  // step.tools_needed contains short names like "filesystem/read_file" or just "read_file"
  return allTools.filter((t) =>
    step.tools_needed!.some((needed) =>
      t.name === needed || needed.endsWith(`/${t.name}`),
    ),
  );
}

function buildStepContext(
  step: SpellStep,
  stepResults: Map<string, string>,
  catalysts?: Map<string, ResolvedCatalyst>,
): string {
  let context = "";
  if (step.depends_on) {
    for (const depId of step.depends_on) {
      const depOutput = stepResults.get(depId);
      if (depOutput) {
        context += `\n--- Output from step "${depId}" ---\n${depOutput}\n`;
      }
    }
  }

  // Inject catalyst content for this step
  if (catalysts && step.catalysts_needed) {
    for (const catId of step.catalysts_needed) {
      const catalyst = catalysts.get(catId);
      if (catalyst) {
        context += `\n--- Catalyst "${catalyst.id}": ${catalyst.description} ---\n${catalyst.content}\n`;
      }
    }
  }

  return context;
}

async function executeStep(
  step: SpellStep,
  context: string,
  inputs: ProvidedInput[],
  tools: ToolDefinition[],
  llmClient: LLMClient,
  mcpServers: Map<string, McpServerState>,
  toolToServer: Map<string, string>,
  options: CastOptions,
): Promise<string> {
  const systemPrompt = [
    `You are executing step "${step.id}" of a spell.`,
    "",
    "INSTRUCTION:",
    step.instruction,
    context ? "\nCONTEXT FROM PREVIOUS STEPS:" + context : "",
  ].join("\n");

  const inputText = inputs
    .map((i) => `[${i.key}]: ${i.value}`)
    .join("\n");

  const messages: Message[] = [
    {
      role: "user",
      content: inputText || "Execute this step based on the instruction above.",
    },
  ];

  let output = "";
  let iterations = 0;

  while (iterations < MAX_ITERATIONS_PER_STEP) {
    const response = await llmClient.sendMessage({
      systemPrompt,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      maxTokens: 4096,
      ...(options.model ? { model: options.model } : {}),
    });

    // Collect assistant response as a single message
    const assistantBlocks: ContentBlock[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        output += block.text;
      }
      assistantBlocks.push(block);
    }

    // If no tool use, we're done
    if (response.stopReason !== "tool_use") break;

    // Append assistant message to conversation
    messages.push({ role: "assistant", content: assistantBlocks });

    // Execute tool calls and build tool results
    const toolResultBlocks: ContentBlock[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const serverName = toolToServer.get(block.name);
      const server = serverName ? mcpServers.get(serverName) : undefined;

      if (server) {
        try {
          if (options.verbose) {
            console.log(chalk.dim(`  [tool_use] ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`));
          }

          const result = await server.subprocess.callTool(block.name, block.input);
          const resultText = result.content
            .map((c) => c.text)
            .join("\n");

          if (options.verbose) {
            console.log(chalk.dim(`  [tool_result] ${resultText.slice(0, 100)}${resultText.length > 100 ? "..." : ""}`));
          }

          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultText,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (options.verbose) {
            console.log(chalk.red(`  [tool_error] ${block.name}: ${errMsg}`));
          }
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${errMsg}`,
          });
        }
      } else {
        // No MCP server for this tool — return an error
        if (options.verbose) {
          console.log(chalk.dim(`  [tool_use] ${block.name}(...) — no MCP server available`));
        }
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: Tool "${block.name}" is not available. No MCP server is running for this tool.`,
        });
      }
    }

    // Append tool results as user message
    messages.push({ role: "user", content: toolResultBlocks });
    iterations++;
  }

  return output;
}

async function executeOutcomeDriven(
  spell: SpellDefinition,
  inputs: ProvidedInput[],
  tools: ToolDefinition[],
  llmClient: LLMClient,
  mcpServers: Map<string, McpServerState>,
  toolToServer: Map<string, string>,
  catalysts: Map<string, ResolvedCatalyst>,
  options: CastOptions,
): Promise<string> {
  const lines: string[] = [];
  lines.push(`You are casting the spell "${spell.name}" v${spell.version}.`);
  lines.push(spell.description);
  lines.push("");
  lines.push("No specific steps are prescribed. Use your judgment and available tools to produce the required outputs and achieve the listed effects.");
  lines.push("");

  if (spell.outputs.length > 0) {
    lines.push("## Required Outputs");
    for (const output of spell.outputs) {
      lines.push(`- **${output.id}** (${output.type}): ${output.format.join(", ")}`);
      if (output.description) lines.push(`  ${output.description}`);
      if (output.acceptance_criteria) lines.push(`  Acceptance: ${output.acceptance_criteria}`);
      if (output.quality_check) lines.push(`  Quality gate: min ${output.quality_check.min_score} score — ${output.quality_check.criteria}`);
    }
    lines.push("");
  }

  if (spell.effects.length > 0) {
    lines.push("## Required Effects");
    for (const effect of spell.effects) {
      lines.push(`- **${effect.id}** (${effect.type}): ${effect.description}`);
      if (effect.verification) lines.push(`  Verification: ${effect.verification}`);
      if (effect.quality_check) lines.push(`  Quality gate: min ${effect.quality_check.min_score} score — ${effect.quality_check.criteria}`);
    }
    lines.push("");
  }

  // Inject catalyst content
  if (catalysts.size > 0) {
    lines.push("## Catalysts (reference data)");
    for (const [id, cat] of catalysts) {
      lines.push(`### ${id}: ${cat.description}`);
      lines.push(cat.content);
      lines.push("");
    }
  }

  const systemPrompt = lines.join("\n");
  const inputText = inputs.map((i) => `[${i.key}]: ${i.value}`).join("\n");

  const messages: Message[] = [
    { role: "user", content: inputText || "Produce the required outputs and achieve the listed effects." },
  ];

  let output = "";
  let iterations = 0;

  while (iterations < MAX_ITERATIONS_PER_STEP) {
    const response = await llmClient.sendMessage({
      systemPrompt,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      maxTokens: 4096,
      ...(options.model ? { model: options.model } : {}),
    });

    const assistantBlocks: ContentBlock[] = [];
    for (const block of response.content) {
      if (block.type === "text") output += block.text;
      assistantBlocks.push(block);
    }

    if (response.stopReason !== "tool_use") break;

    messages.push({ role: "assistant", content: assistantBlocks });

    const toolResultBlocks: ContentBlock[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const serverName = toolToServer.get(block.name);
      const server = serverName ? mcpServers.get(serverName) : undefined;

      if (server) {
        try {
          if (options.verbose) {
            console.log(chalk.dim(`  [tool_use] ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`));
          }
          const result = await server.subprocess.callTool(block.name, block.input);
          const resultText = result.content.map((c) => c.text).join("\n");
          toolResultBlocks.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          toolResultBlocks.push({ type: "tool_result", tool_use_id: block.id, content: `Error: ${errMsg}` });
        }
      } else {
        toolResultBlocks.push({
          type: "tool_result", tool_use_id: block.id,
          content: `Error: Tool "${block.name}" is not available.`,
        });
      }
    }

    messages.push({ role: "user", content: toolResultBlocks });
    iterations++;
  }

  return output;
}

async function evaluateOutcomeQualityChecks(
  spell: SpellDefinition,
  combinedOutput: string,
  llmClient: LLMClient,
  outcomeResults: OutcomeResult[],
  options: CastOptions,
  extraContext?: {
    inputs: ProvidedInput[];
    catalysts: Map<string, ResolvedCatalyst>;
    tools: ToolDefinition[];
    mcpServers: Map<string, McpServerState>;
    toolToServer: Map<string, string>;
    configManager: ConfigManager;
  },
): Promise<void> {
  // Handle outputs with artifact templates first
  const hasArtifacts = spell.outputs.some((o) => o.artifact);
  if (hasArtifacts && extraContext) {
    const userConfig = await extraContext.configManager.loadUserConfig();
    const cache = new Cache(userConfig.cache?.directory);
    const registryClient = new RegistryClient({
      baseUrl: userConfig.registry?.url,
      timeout: userConfig.registry?.timeout,
      cache,
      cacheTtl: userConfig.cache?.ttl,
    });

    for (const output of spell.outputs) {
      if (!output.artifact) continue;

      const start = Date.now();
      try {
        const artifact = await resolveArtifact(spell, output, registryClient, cache);

        if (options.verbose) {
          console.log(chalk.dim(`  Resolved artifact template for "${output.id}" (${artifact.sectionOrder.length} sections)`));
        }

        const { assembled, sectionResults } = await executeArtifactOutput(
          output, artifact, extraContext.inputs, extraContext.catalysts,
          llmClient, extraContext.tools, extraContext.mcpServers, extraContext.toolToServer, options,
        );

        outcomeResults.push({
          id: output.id,
          kind: 'output',
          output: assembled.slice(0, 500),
          retryCount: sectionResults.reduce((sum, s) => sum + s.retryCount, 0),
          durationMs: Date.now() - start,
          artifactSections: sectionResults,
        });
      } catch (err) {
        if (options.verbose) {
          console.log(chalk.yellow(`  Failed to execute artifact for "${output.id}": ${err instanceof Error ? err.message : String(err)}`));
        }
        throw err;
      }
    }
  }

  // Evaluate quality checks on non-artifact outputs and effects
  const items: { id: string; kind: 'output' | 'effect'; qc: QualityCheck }[] = [];

  for (const output of spell.outputs) {
    if (output.artifact) continue; // Already handled above
    if (output.quality_check) items.push({ id: output.id, kind: 'output', qc: output.quality_check });
  }
  for (const effect of spell.effects) {
    if (effect.quality_check) items.push({ id: effect.id, kind: 'effect', qc: effect.quality_check });
  }

  for (const item of items) {
    const start = Date.now();
    let result = await evaluateQualityCheck(combinedOutput, item.qc, llmClient, options);
    let retryCount = 0;

    if (result.score < item.qc.min_score && item.qc.retry_on_failure) {
      const maxRetries = item.qc.max_retries || 2;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        retryCount++;
        if (options.verbose) {
          console.log(chalk.yellow(`  Outcome "${item.id}" quality check failed (${result.score.toFixed(2)}), retry ${retryCount}/${maxRetries}`));
        }
        result = await evaluateQualityCheck(combinedOutput, item.qc, llmClient, options);
        if (result.score >= item.qc.min_score) break;
      }
    }

    if (result.score < item.qc.min_score) {
      throw E_QUALITY_CHECK_FAILED(item.id, result.feedback);
    }

    outcomeResults.push({
      id: item.id,
      kind: item.kind,
      output: combinedOutput.slice(0, 500),
      qualityScore: result.score,
      qualityPassed: result.passed,
      qualityFeedback: result.feedback,
      retryCount,
      durationMs: Date.now() - start,
    });
  }
}

async function executeArtifactOutput(
  output: SpellOutput,
  artifact: ResolvedArtifact,
  inputs: ProvidedInput[],
  catalysts: Map<string, ResolvedCatalyst>,
  llmClient: LLMClient,
  tools: ToolDefinition[],
  mcpServers: Map<string, McpServerState>,
  toolToServer: Map<string, string>,
  options: CastOptions,
): Promise<{ assembled: string; sectionResults: ArtifactSectionResult[] }> {
  const sectionResults: ArtifactSectionResult[] = [];
  const filledSections = new Map<string, string>();

  for (const sectionId of artifact.sectionOrder) {
    const sectionDef = artifact.sections.get(sectionId);
    if (!sectionDef) continue;

    const sectionStart = Date.now();

    // Build context: template structure + previous sections + section prompt
    const contextParts: string[] = [];
    contextParts.push(`You are filling section "${sectionId}" of an artifact template for output "${output.id}".`);
    contextParts.push("");
    contextParts.push("TEMPLATE STRUCTURE:");
    contextParts.push(artifact.templateContent);
    contextParts.push("");

    if (filledSections.size > 0) {
      contextParts.push("PREVIOUSLY FILLED SECTIONS:");
      for (const [prevId, prevContent] of filledSections) {
        contextParts.push(`--- ${prevId} ---`);
        contextParts.push(prevContent);
        contextParts.push("");
      }
    }

    // Inject catalyst content for this output
    if (catalysts.size > 0 && output.catalysts_needed) {
      for (const catId of output.catalysts_needed) {
        const catalyst = catalysts.get(catId);
        if (catalyst) {
          contextParts.push(`--- Catalyst "${catalyst.id}": ${catalyst.description} ---`);
          contextParts.push(catalyst.content);
          contextParts.push("");
        }
      }
    }

    contextParts.push("SECTION PROMPT:");
    contextParts.push(sectionDef.prompt);
    contextParts.push("");
    contextParts.push("Write ONLY the content for this section. Do not include markers or section headers.");

    const systemPrompt = contextParts.join("\n");
    const inputText = inputs.map((i) => `[${i.key}]: ${i.value}`).join("\n");

    const messages: Message[] = [
      { role: "user", content: inputText || "Generate the content for this section." },
    ];

    let sectionContent = "";
    let iterations = 0;

    while (iterations < MAX_ITERATIONS_PER_STEP) {
      const response = await llmClient.sendMessage({
        systemPrompt,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: 4096,
        ...(options.model ? { model: options.model } : {}),
      });

      const assistantBlocks: ContentBlock[] = [];
      for (const block of response.content) {
        if (block.type === "text") sectionContent += block.text;
        assistantBlocks.push(block);
      }

      if (response.stopReason !== "tool_use") break;

      messages.push({ role: "assistant", content: assistantBlocks });

      const toolResultBlocks: ContentBlock[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const serverName = toolToServer.get(block.name);
        const server = serverName ? mcpServers.get(serverName) : undefined;

        if (server) {
          try {
            const result = await server.subprocess.callTool(block.name, block.input);
            const resultText = result.content.map((c) => c.text).join("\n");
            toolResultBlocks.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            toolResultBlocks.push({ type: "tool_result", tool_use_id: block.id, content: `Error: ${errMsg}` });
          }
        } else {
          toolResultBlocks.push({
            type: "tool_result", tool_use_id: block.id,
            content: `Error: Tool "${block.name}" is not available.`,
          });
        }
      }

      messages.push({ role: "user", content: toolResultBlocks });
      iterations++;
    }

    // Quality check for this section
    let retryCount = 0;
    let qualityResult: QualityCheckResult | undefined;

    if (sectionDef.quality_check && !options.skipQualityChecks) {
      qualityResult = await evaluateQualityCheck(sectionContent, sectionDef.quality_check, llmClient, options);

      if (qualityResult.score < sectionDef.quality_check.min_score && sectionDef.quality_check.retry_on_failure) {
        const maxRetries = sectionDef.quality_check.max_retries || 2;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          retryCount++;
          if (options.verbose) {
            console.log(chalk.yellow(`  Section "${sectionId}" quality check failed (${qualityResult.score.toFixed(2)}), retry ${retryCount}/${maxRetries}`));
          }

          // Retry with feedback
          sectionContent = "";
          const retryMessages: Message[] = [
            { role: "user", content: `${inputText}\n\n--- Quality check feedback (score: ${qualityResult.score.toFixed(2)}) ---\n${qualityResult.feedback}\n\nPlease address the feedback and improve your output.` },
          ];

          const retryResponse = await llmClient.sendMessage({
            systemPrompt,
            messages: retryMessages,
            maxTokens: 4096,
            ...(options.model ? { model: options.model } : {}),
          });

          for (const block of retryResponse.content) {
            if (block.type === "text") sectionContent += block.text;
          }

          qualityResult = await evaluateQualityCheck(sectionContent, sectionDef.quality_check, llmClient, options);
          if (qualityResult.score >= sectionDef.quality_check.min_score) break;
        }
      }

      if (qualityResult.score < sectionDef.quality_check.min_score) {
        throw E_QUALITY_CHECK_FAILED(`artifact section "${sectionId}"`, qualityResult.feedback);
      }
    }

    filledSections.set(sectionId, sectionContent);
    sectionResults.push({
      sectionId,
      content: sectionContent,
      qualityScore: qualityResult?.score,
      qualityPassed: qualityResult?.passed,
      qualityFeedback: qualityResult?.feedback,
      retryCount,
      durationMs: Date.now() - sectionStart,
    });

    if (options.verbose) {
      console.log(chalk.dim(`  Filled section "${sectionId}" (${sectionContent.length} chars${qualityResult ? `, quality: ${qualityResult.score.toFixed(2)}` : ""})`));
    }
  }

  const assembled = assembleArtifact(artifact.templateContent, filledSections);
  return { assembled, sectionResults };
}

async function evaluateQualityCheck(
  output: string,
  qualityCheck: QualityCheck,
  llmClient: LLMClient,
  options: CastOptions,
): Promise<QualityCheckResult> {
  const prompt = `Evaluate the following output against these quality criteria.
Score from 0.0 to 1.0. Explain any deficiencies.

CRITERIA:
${qualityCheck.criteria}

OUTPUT TO EVALUATE:
${output}

Respond with JSON only: { "score": 0.0-1.0, "passed": boolean, "feedback": "..." }`;

  try {
    const response = await llmClient.sendMessage({
      systemPrompt: "You are a quality evaluator. Respond only with valid JSON.",
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1024,
      ...(options.model ? { model: options.model } : {}),
    });

    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as QualityCheckResult;
      return {
        score: parsed.score,
        passed: parsed.score >= qualityCheck.min_score,
        feedback: parsed.feedback || "",
      };
    }
  } catch (err) {
    if (options.verbose) {
      console.log(chalk.dim(`  Quality check evaluation error: ${err}`));
    }
  }

  return { score: 1.0, passed: true, feedback: "Quality check evaluation could not parse LLM response." };
}
