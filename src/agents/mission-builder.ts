/**
 * Mission builder — compiles a SpellDefinition into an AgentMission.
 *
 * Translates spell outcomes, inputs, catalysts, steps, and wards into a
 * comprehensive prompt for an autonomous agent. Unlike the old
 * `generateCastPrompt`, steps are framed as advisory guidance rather than
 * rigid instructions, and the agent is told what wards will verify.
 */

import type { SpellDefinition } from "../types/spell.js";
import type { McpServerEntry } from "../types/platform.js";
import type { ResolvedCatalyst } from "../core/catalyst-resolver.js";
import type { ProvidedInput } from "../core/coverage-analyzer.js";
import type { AgentMission, McpServerConfig } from "./runtime.js";
import type { WardDefinition } from "../core/wards.js";
import { topologicalSort } from "../core/spell-parser.js";

// ── Public API ──────────────────────────────────────────────────────────────

export interface MissionBuildOptions {
  outputDir: string;
  workingDirectory: string;
  mcpServers: Record<string, McpServerConfig>;
  timeout: number;
  streamOutput: boolean;
  /** Resolved catalysts (id → content) */
  catalysts?: Map<string, ResolvedCatalyst>;
  /** Wards that will be checked after execution — agent should be aware of them */
  wards?: WardDefinition[];
  /** Ward failure feedback from a previous attempt (for retries) */
  wardFeedback?: string;
}

export function buildMission(
  spell: SpellDefinition,
  inputs: ProvidedInput[],
  options: MissionBuildOptions,
): AgentMission {
  const prompt = buildPrompt(spell, inputs, options);

  return {
    prompt,
    workingDirectory: options.workingDirectory,
    mcpServers: options.mcpServers,
    timeout: options.timeout,
    streamOutput: options.streamOutput,
  };
}

// ── Prompt construction ─────────────────────────────────────────────────────

function buildPrompt(
  spell: SpellDefinition,
  inputs: ProvidedInput[],
  options: MissionBuildOptions,
): string {
  const lines: string[] = [];

  // ── Mission framing ──
  lines.push(`# Mission: Cast "${spell.name}" v${spell.version}`);
  lines.push("");
  lines.push("You are an autonomous agent casting a Pointy Hat spell. A spell is a declarative contract — it specifies WHAT must be produced, not HOW. Your job is to satisfy this contract fully: produce every declared output and achieve every declared effect.");
  lines.push("");
  lines.push("Work autonomously. Use the tools available to you. Do not stop until all outcomes are satisfied or you are certain they cannot be achieved.");
  lines.push("");
  lines.push(`**Description:** ${spell.description}`);
  lines.push("");
  lines.push(`**Output directory:** \`${options.outputDir}\``);
  lines.push("");

  // ── Ward feedback (retry) ──
  if (options.wardFeedback) {
    lines.push("## IMPORTANT: Previous Attempt Failed Verification");
    lines.push("");
    lines.push("Your previous attempt did not pass all wards. Here is the feedback:");
    lines.push("");
    lines.push(options.wardFeedback);
    lines.push("");
    lines.push("Address every failure listed above before completing this attempt.");
    lines.push("");
  }

  // ── Desired outcomes ──
  const hasOutputs = spell.outputs.length > 0;
  const hasEffects = spell.effects.length > 0;

  if (hasOutputs || hasEffects) {
    lines.push("## Desired Outcomes");
    lines.push("");

    if (hasOutputs) {
      lines.push("### Outputs");
      lines.push("");
      for (const output of spell.outputs) {
        lines.push(`- **${output.id}** (${output.type}): ${output.format.join(", ")}`);
        if (output.description) lines.push(`  ${output.description}`);
        if (output.acceptance_criteria) {
          lines.push(`  **Acceptance criteria:** ${output.acceptance_criteria.trim()}`);
        }
        if (output.depends_on?.length) {
          lines.push(`  **Depends on:** ${output.depends_on.join(", ")}`);
        }
        if (output.artifact) {
          lines.push(`  **Artifact template:** \`${output.artifact}\``);
        }
        lines.push("");
      }
    }

    if (hasEffects) {
      lines.push("### Effects (postconditions)");
      lines.push("");
      for (const effect of spell.effects) {
        lines.push(`- **${effect.id}** (${effect.type}): ${effect.description}`);
        if (effect.verification) {
          lines.push(`  **Verification:** ${effect.verification}`);
        }
        if (effect.depends_on?.length) {
          lines.push(`  **Depends on:** ${effect.depends_on.join(", ")}`);
        }
        lines.push("");
      }
    }
  }

  // ── Wards (so the agent knows what will be verified) ──
  if (options.wards && options.wards.length > 0) {
    lines.push("## Wards (Verification Checks)");
    lines.push("");
    lines.push("After you finish, the following checks will be run independently to verify your work. Make sure your outputs satisfy all of them:");
    lines.push("");
    for (const ward of options.wards) {
      lines.push(`- **${ward.id}**: ${ward.description}`);
      for (const check of ward.checks) {
        if (check.type !== "semantic") {
          lines.push(`    [${check.type}] ${check.description}`);
        }
      }
    }
    lines.push("");
  }

  // ── Advisory steps ──
  const sortedSteps = spell.steps.length > 0 ? topologicalSort(spell.steps) : [];

  if (sortedSteps.length > 0) {
    lines.push("## Suggested Approach");
    lines.push("");
    lines.push("The spell author suggests the following steps. Treat these as guidance — you may adapt, reorder, or skip steps as long as the outcomes are achieved.");
    lines.push("");

    for (let i = 0; i < sortedSteps.length; i++) {
      const step = sortedSteps[i];
      const optional = step.optional ? " *(optional)*" : "";
      lines.push(`### Step ${i + 1}: ${step.id}${optional}`);
      lines.push("");
      lines.push(step.instruction.trim());
      lines.push("");

      const annotations: string[] = [];
      if (step.depends_on?.length) annotations.push(`After: ${step.depends_on.join(", ")}`);
      if (step.inputs_needed?.length) annotations.push(`Inputs: ${step.inputs_needed.join(", ")}`);
      if (step.tools_needed?.length) annotations.push(`Tools: ${step.tools_needed.join(", ")}`);
      if (step.catalysts_needed?.length) annotations.push(`Catalysts: ${step.catalysts_needed.join(", ")}`);

      if (annotations.length > 0) {
        for (const ann of annotations) lines.push(`> ${ann}`);
        lines.push("");
      }
    }
  } else {
    lines.push("## Execution");
    lines.push("");
    lines.push("No specific steps are prescribed. Plan your own approach to produce the required outputs and achieve the declared effects.");
    lines.push("");
  }

  // ── Catalysts (inline reference data) ──
  if (options.catalysts && options.catalysts.size > 0) {
    lines.push("## Reference Data (Catalysts)");
    lines.push("");
    for (const [id, catalyst] of options.catalysts) {
      lines.push(`### ${id} (${catalyst.type})`);
      lines.push("");
      lines.push(`> ${catalyst.description}`);
      lines.push("");
      lines.push("```");
      lines.push(catalyst.content);
      lines.push("```");
      lines.push("");
    }
  }

  // ── Provided inputs ──
  if (inputs.length > 0) {
    lines.push("## Provided Inputs");
    lines.push("");
    for (const input of inputs) {
      lines.push(`- **${input.key}**: ${input.value}`);
    }
    lines.push("");
  }

  // ── Available tools ──
  if (spell.requires.tools.length > 0) {
    lines.push("## Available Tools");
    lines.push("");
    for (const tool of spell.requires.tools) {
      const opt = tool.optional ? " *(optional)*" : "";
      lines.push(`- \`${tool.uri}\`${opt}${tool.reason ? `: ${tool.reason}` : ""}`);
    }
    lines.push("");
  }

  // ── Completion protocol ──
  lines.push("## Completion");
  lines.push("");
  lines.push("When you have produced all outputs and achieved all effects, emit a summary block in this exact format so the CLI can parse your results:");
  lines.push("");
  lines.push("```");
  lines.push("---POINTYHAT_RESULT---");
  lines.push('{');
  lines.push('  "outcomes_completed": ["<output-id>", ...],');
  lines.push('  "effects_achieved": ["<effect-id>", ...],');
  lines.push('  "files_created": ["<path>", ...],');
  lines.push('  "notes": "<any additional context>"');
  lines.push('}');
  lines.push("---END_POINTYHAT_RESULT---");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}
