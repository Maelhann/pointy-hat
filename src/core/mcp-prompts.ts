import type { SpellDefinition } from "../types/spell.js";
import { topologicalSort } from "./spell-parser.js";

// ── Prompt 1: guide ──────────────────────────────────────────────────────────
// Master onboarding prompt. Teaches agents the entire Pointy Hat spell system.

export function generateGuidePrompt(): string {
  return `# Pointy Hat Agent Guide

You are connected to a **Pointy Hat** MCP server. Pointy Hat is a platform for declarative AI workflows called **spells**. This guide teaches you everything you need to discover, understand, and cast spells.

## What Are Spells?

A spell is a declarative workflow definition written in YAML. Unlike imperative scripts that specify HOW to do something step-by-step, a spell declares WHAT should be produced — the desired outcomes, acceptance criteria, and quality standards. Your job as an agent is to satisfy the spell's contract.

Spells declare:
- **Outputs** — artifacts the spell must produce (documents, data, code, images)
- **Effects** — postconditions or state changes the spell must achieve
- **Quality checks** — semantic quality gates that verify work meets standards
- **Inputs** — data the user provides (files, text, parameters)
- **Catalysts** — bundled reference material that ships with the spell (templates, style guides, datasets)
- **Steps** — optional ordered guidance for execution (not required)

## Key Vocabulary

| Term | Meaning |
|---|---|
| **Spell** | A declarative YAML workflow definition |
| **Casting** | Executing a spell to produce its declared outcomes |
| **Input** | User-provided data (required or optional), each with accepted formats |
| **Output** | A first-class outcome declaration — what the spell produces |
| **Effect** | A postcondition or state change the spell achieves |
| **Catalyst** | Bundled reference data that ships with the spell (reference, template, or data) |
| **Artifact** | A structured template file with dynamic sections for generation |
| **Quality check** | A semantic quality gate: criteria + minimum score + retry logic |
| **Spellbook** | The local collection of installed spells |
| **Grimoire** | The Pointy Hat registry where spells are published and discovered |
| **Coverage** | Pre-cast analysis that verifies you have the required tools and inputs |

## Available Tools

You have the following MCP tools from this server:

### \`search_spells\`
Find spells in the Grimoire.
- \`query\` (string, required): Search query
- \`tags\` (string[], optional): Filter by tags

### \`get_spell\`
Retrieve a full spell definition.
- \`name\` (string, required): Spell name
- \`version\` (string, optional): Specific version

### \`check_coverage\`
Pre-flight readiness check — verifies you have the tools and inputs a spell needs.
- \`spell_name\` (string, required): Name of the spell to check
- \`available_tools\` (string[], optional): Tool names you have available
- \`provided_inputs\` (object[], optional): Inputs you can provide (\`{ key, value }\`)

### \`quality_check\`
Evaluate a quality gate on content you produced.
- \`step_id\` (string, required): The step, output, or effect ID being evaluated
- \`output\` (string, required): The content to evaluate
- \`criteria\` (string, required): Quality criteria to evaluate against
- \`min_score\` (number, optional): Minimum passing score, 0.0–1.0 (default: 0.8)

### \`search_mcps\`
Find MCP server packages (tools the spell may depend on).
- \`query\` (string, required): Search query
- \`category\` (string, optional): Filter by category

### \`install_mcp\`
Get installation instructions for an MCP server package.
- \`name\` (string, required): Package name
- \`platform\` (string, optional): Target platform

## Available Prompts

Besides this guide, you can request:
- \`spell_format\` — Complete YAML schema reference for spell definitions
- \`interpret_spell\` — Structured analysis of a specific spell (pass \`name\` argument)
- \`cast_spell\` — Full casting instructions for a spell (pass \`name\` and optional \`inputs\`)

## The Casting Workflow

Follow these steps to discover and cast a spell:

### 1. Search
Use \`search_spells\` to find spells matching the user's goal.

### 2. Retrieve
Use \`get_spell\` to fetch the full spell definition. Read the description, inputs, outputs, and effects to understand what the spell does.

### 3. Coverage Check
Use \`check_coverage\` to verify you have the required tools and inputs. The result tells you:
- \`canCast\`: whether all required dependencies are met
- \`score\`: readiness percentage (required items weighted 3x)
- \`missingRequired\`: what's still needed
- \`warnings\`: optional items that would improve results

If \`canCast\` is false, either ask the user for missing inputs, or use \`install_mcp\` to resolve missing tools.

### 4. Cast
Request the \`cast_spell\` prompt to get structured execution instructions. Then follow them:

**Guided Mode** (spell has steps):
- Execute steps in the order given (they are topologically sorted by dependencies)
- Each step has an instruction, and may reference specific inputs, tools, and catalysts
- Steps marked \`optional: true\` can be skipped if their required inputs are unavailable

**Outcome-Driven Mode** (spell has no steps):
- Plan your own execution strategy
- Focus on producing the declared outputs and achieving the declared effects
- Use available tools and inputs as you see fit

### 5. Quality Verification
For every quality check in the spell (on steps, outputs, or effects):
1. After producing the relevant content, call \`quality_check\` with:
   - \`step_id\`: the step, output, or effect ID
   - \`output\`: the content you produced
   - \`criteria\`: the quality criteria string from the spell
   - \`min_score\`: the minimum score from the spell
2. If the check returns \`passed: false\`:
   - Read the \`feedback\` field carefully
   - Revise your output to address the feedback
   - Call \`quality_check\` again
   - Repeat up to \`max_retries\` times (from the spell's quality check definition)
3. If it still fails after all retries, report the failure with the score and feedback.

## Catalysts

Catalysts are reference data bundled with a spell — they travel with it through the registry and are resolved automatically during casting. Three types exist:

- **reference**: Documentation, guidelines, standards (e.g., GAAP rules, style guides)
- **template**: Skeleton content to fill in (e.g., report format, review structure)
- **data**: Raw datasets or lookup tables (e.g., tax rates, industry benchmarks)

When a step or output declares \`catalysts_needed\`, the catalyst content is injected into the casting context. You don't need to fetch catalysts manually.

## Artifact Templates

Some outputs reference an **artifact template** — a structured file with fixed structure and dynamic sections. The template contains:

- **Static content** (headings, formatting, boilerplate) — preserved exactly as-is
- **Dynamic sections** marked with \`@begin:section-id\` and \`@end:section-id\`
  - Between the markers is inline YAML with a \`prompt\` field (what to generate) and an optional \`quality_check\`
  - You generate content for each marked section, replacing the YAML with your output
  - Process sections in document order

## Execution Modes Summary

| | Guided Mode | Outcome-Driven Mode |
|---|---|---|
| Steps defined? | Yes | No |
| Execution order | Topological (by depends_on) | Agent's discretion |
| Agent autonomy | Follow step instructions | Full autonomy |
| Quality checks | Per-step + per-output/effect | Per-output/effect only |
| Best for | Complex multi-phase workflows | Simple or flexible tasks |
`;
}

// ── Prompt 2: spell_format ───────────────────────────────────────────────────
// Complete YAML schema reference for spell definitions.

export function generateSpellFormatPrompt(): string {
  return `# Spell YAML Format Reference

This is the complete schema reference for Pointy Hat spell definitions. Every spell is a YAML file with a top-level \`spell:\` key.

## Top-Level Structure

\`\`\`yaml
spell:
  name: string              # Required. Unique spell identifier (kebab-case).
  version: string           # Required. Semver version (e.g., "1.0.0").
  description: string       # Required. One-line summary of what the spell does.
  author: string            # Required. Author name or organization.
  license: string           # Optional. SPDX license identifier.
  tags: string[]            # Optional. Searchable tags. Default: [].
  card: string              # Optional. Rich markdown for registry display.

  inputs: { ... }           # Required and optional user-provided data.
  catalysts: [ ... ]        # Bundled reference data.
  requires: { ... }         # Tool and resource dependencies.
  steps: [ ... ]            # Optional guidance steps.
  outputs: [ ... ]          # Outcome declarations.
  effects: [ ... ]          # Postcondition declarations.
  metadata: { ... }         # Optional metadata.
\`\`\`

**Validation rule:** A spell must define at least one output, effect, or step.

## Inputs

User-provided data the spell needs. Divided into required and optional.

\`\`\`yaml
inputs:
  required:
    - id: string              # Unique identifier for this input.
      description: string     # What this input is and what it should contain.
      formats:                # Accepted file formats or data types.
        - csv
        - json
        - text
  optional:
    - id: string
      description: string
      formats: [pdf, docx]
\`\`\`

## Outputs

First-class outcome declarations — what the spell must produce.

\`\`\`yaml
outputs:
  - id: string                          # Unique across all steps, outputs, and effects.
    type: document | data | code | image  # Output category.
    format: [md, pdf, json]             # Accepted output format(s).
    description: string                  # Optional. What this output is.
    acceptance_criteria: string          # Optional. Conditions for the output to be acceptable.
    depends_on: [step-id, other-output]  # Optional. IDs that must complete first.
    inputs_needed: [input-id]            # Optional. Which inputs this output requires.
    catalysts_needed: [catalyst-id]      # Optional. Which catalysts to reference.
    quality_check:                       # Optional. Quality gate for this output.
      criteria: string                   # What to evaluate.
      min_score: 0.8                     # Minimum passing score (0.0–1.0).
      retry_on_failure: true             # Whether to retry on failure.
      max_retries: 2                     # Maximum retry attempts.
    artifact: string                     # Optional. "artifact://spell-name/filename"
\`\`\`

## Effects

Postconditions or state changes the spell must achieve.

\`\`\`yaml
effects:
  - id: string                # Unique across all steps, outputs, and effects.
    type: string              # Category (e.g., "file_creation", "notification", "archival").
    description: string       # What this effect achieves.
    verification: string      # Optional. How to verify the effect occurred.
    depends_on: [step-id]     # Optional. IDs that must complete first.
    inputs_needed: [input-id] # Optional. Which inputs this effect requires.
    catalysts_needed: [id]    # Optional. Which catalysts to reference.
    quality_check: { ... }    # Optional. Same schema as output quality checks.
\`\`\`

## Steps (Optional Guidance)

Ordered instructions for the agent. If omitted or empty, the spell runs in outcome-driven mode.

\`\`\`yaml
steps:
  - id: string                  # Unique identifier.
    instruction: |              # Natural-language directive for the agent.
      What to do in this step.
      Be specific and actionable.
    depends_on: [other-step-id] # Optional. Step IDs that must complete first.
    tools_needed: [tool-name]   # Optional. Tools to use (short names or mcp:// URIs).
    inputs_needed: [input-id]   # Optional. Which inputs this step requires.
    catalysts_needed: [id]      # Optional. Which catalysts to reference.
    optional: false             # Default false. If true, can be skipped when inputs are unavailable.
    timeout: 120                # Optional. Maximum seconds for this step.
    quality_check: { ... }      # Optional. Same schema as output quality checks.
\`\`\`

## Quality Check Schema

Attached to steps, outputs, or effects. Defines a semantic quality gate.

\`\`\`yaml
quality_check:
  criteria: string            # Natural-language description of what constitutes quality.
  min_score: 0.8              # Minimum passing score, 0.0 to 1.0.
  retry_on_failure: false     # Whether the agent should retry on failure. Default: false.
  max_retries: 2              # Maximum retry count. Default: 2.
\`\`\`

## Catalysts

Bundled reference data that ships with the spell. Resolved automatically from the registry.

\`\`\`yaml
catalysts:
  - id: string              # Unique identifier.
    description: string     # What this catalyst contains.
    uri: string             # "catalyst://spell-name/filename"
    type: reference | template | data
\`\`\`

- **reference**: Documentation, standards, guidelines to consult.
- **template**: Skeleton content or formatting to follow.
- **data**: Raw datasets, lookup tables, or structured records.

## Tool Requirements

External tools (MCP servers) the spell depends on.

\`\`\`yaml
requires:
  tools:
    - uri: string           # "mcp://server-name/tool-name"
      reason: string        # Optional. Why this tool is needed.
      optional: false       # Default false. If true, spell can proceed without it.
  resources:
    - uri: string           # MCP resource URI pattern.
\`\`\`

## Artifact Template Syntax

Artifact templates are files referenced by outputs via \`artifact://spell-name/filename\`. They combine static structure with dynamic sections.

\`\`\`markdown
# Report Title

## Executive Summary

@begin:executive-summary
prompt: |
  Write a 2-3 paragraph executive summary covering the key findings.
quality_check:
  criteria: Summary mentions key metrics and provides actionable insights.
  min_score: 0.8
  retry_on_failure: true
  max_retries: 2
@end:executive-summary

## Detailed Analysis

@begin:detailed-analysis
prompt: |
  Provide a detailed analysis broken down by category.
@end:detailed-analysis
\`\`\`

Rules:
- Content between \`@begin:ID\` and \`@end:ID\` markers is inline YAML defining a \`prompt\` and optional \`quality_check\`.
- Everything outside markers (headings, static text) is preserved exactly as-is.
- Section IDs must be unique within the template.
- Each \`@begin\` must have a matching \`@end\`. Nesting is not allowed.
- Sections are processed in document order.

## URI Conventions

| Prefix | Meaning | Example |
|---|---|---|
| \`mcp://\` | MCP tool reference | \`mcp://filesystem/read_file\` |
| \`catalyst://\` | Catalyst data file | \`catalyst://code-review/style-guide.md\` |
| \`artifact://\` | Artifact template file | \`artifact://report-gen/template.md\` |
| \`spell://\` | Spell resource URI | \`spell://code-review/1.0.0\` |

## Dependency Graph Rules

- Steps can depend on other steps via \`depends_on\`.
- Outputs and effects can depend on any step, output, or effect ID.
- All IDs must be unique across steps, outputs, and effects combined.
- Circular dependencies are not allowed (topological sort must succeed).
- Items with no dependencies execute first; items with dependencies execute after all dependencies complete.

## Metadata

\`\`\`yaml
metadata:
  min_pointyhat_version: string   # Optional. Minimum CLI version required.
  estimated_duration: string      # Optional. E.g., "3-5 minutes".
  category: string                # Optional. E.g., "finance", "devops".
\`\`\`

## Example: Guided Spell (with steps)

\`\`\`yaml
spell:
  name: code-review
  version: "1.0.0"
  description: Thorough code review with security analysis and actionable feedback
  author: pointyhat
  tags: [code, review, security]

  inputs:
    required:
      - id: source-code
        description: The code files to review
        formats: [py, ts, js, go, rs]
    optional: []

  catalysts:
    - id: review-checklist
      description: Security and quality review checklist
      uri: "catalyst://code-review/checklist.md"
      type: reference

  requires:
    tools:
      - uri: "mcp://filesystem/read_file"
        reason: Read source files for analysis

  steps:
    - id: analyze
      instruction: |
        Read the source code and identify bugs, security vulnerabilities,
        performance issues, and style inconsistencies. Be thorough.
      inputs_needed: [source-code]
      tools_needed: [filesystem/read_file]
      catalysts_needed: [review-checklist]

    - id: write-review
      instruction: |
        Write a structured review. Cite specific line numbers,
        explain why each issue matters, and suggest concrete fixes.
      depends_on: [analyze]
      quality_check:
        criteria: Review cites specific lines, explains impact, and provides fixes
        min_score: 0.8
        retry_on_failure: true
        max_retries: 2

  outputs:
    - id: review-document
      type: document
      format: [md]
      description: Structured code review with findings and recommendations
      acceptance_criteria: |
        Must cite specific line numbers, categorize issues by severity,
        and provide actionable fix suggestions for each finding.

  effects: []

  metadata:
    estimated_duration: 2-5 minutes
    category: development
\`\`\`

## Example: Outcome-Driven Spell (no steps)

\`\`\`yaml
spell:
  name: competitive-analysis
  version: "1.0.0"
  description: Generates a competitive landscape analysis from market data
  author: strategy-team
  tags: [strategy, analysis, market-research]

  inputs:
    required:
      - id: market-data
        description: Market data including competitor information
        formats: [csv, json]
      - id: company-profile
        description: Your company's key metrics and positioning
        formats: [text, md]
    optional:
      - id: previous-analysis
        description: Prior competitive analysis for trend comparison
        formats: [pdf, md]

  catalysts:
    - id: analysis-framework
      description: Porter's Five Forces and SWOT analysis templates
      uri: "catalyst://competitive-analysis/framework.md"
      type: reference

  requires:
    tools: []
    resources: []

  steps: []

  outputs:
    - id: analysis-report
      type: document
      format: [md, pdf]
      description: Comprehensive competitive landscape analysis
      acceptance_criteria: |
        Must analyze at least 3 competitors, include market positioning,
        identify key differentiators, and provide strategic recommendations.
      inputs_needed: [market-data, company-profile]
      catalysts_needed: [analysis-framework]
      quality_check:
        criteria: |
          Analysis covers at least 3 competitors with specific data points,
          includes strategic recommendations, and uses the analysis framework.
        min_score: 0.75
        retry_on_failure: true
        max_retries: 2
    - id: competitor-matrix
      type: data
      format: [json]
      description: Structured competitor comparison matrix
      depends_on: [analysis-report]

  effects:
    - id: insights-logged
      type: tracking
      description: Key competitive insights logged for trend tracking
      verification: Insights stored with timestamps and source references
      depends_on: [analysis-report]

  metadata:
    estimated_duration: 5-10 minutes
    category: strategy
\`\`\`
`;
}

// ── Prompt 3: interpret_spell ────────────────────────────────────────────────
// Dynamic analysis of a specific spell.

export function generateInterpretPrompt(spell: SpellDefinition): string {
  const lines: string[] = [];

  lines.push(`# Spell Analysis: "${spell.name}" v${spell.version}`);
  lines.push("");
  lines.push(spell.description);
  lines.push("");

  // ── Execution Mode ──
  const isGuided = spell.steps.length > 0;
  lines.push("## Execution Mode");
  lines.push("");
  if (isGuided) {
    lines.push(`**Guided Mode** — This spell provides ${spell.steps.length} step(s). Execute them in topological order, respecting \`depends_on\` declarations.`);
  } else {
    lines.push("**Outcome-Driven Mode** — This spell has no steps. Plan your own execution to produce the declared outputs and effects.");
  }
  lines.push("");

  // ── Dependency Graph ──
  lines.push("## Execution Order");
  lines.push("");

  type GraphItem = { id: string; kind: string; depends_on?: string[] };
  const allItems: GraphItem[] = [
    ...spell.steps.map((s) => ({ id: s.id, kind: "step", depends_on: s.depends_on })),
    ...spell.outputs.map((o) => ({ id: o.id, kind: "output", depends_on: o.depends_on })),
    ...spell.effects.map((e) => ({ id: e.id, kind: "effect", depends_on: e.depends_on })),
  ];

  if (allItems.length === 0) {
    lines.push("No steps, outputs, or effects defined.");
  } else {
    try {
      const sorted = topologicalSort(allItems);
      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const deps = item.depends_on?.length ? ` (after: ${item.depends_on.join(", ")})` : "";
        lines.push(`${i + 1}. [${item.kind}] **${item.id}**${deps}`);
      }
    } catch {
      // Graceful fallback on circular dependencies
      lines.push("Could not determine execution order (possible circular dependency). Items:");
      for (const item of allItems) {
        const deps = item.depends_on?.length ? ` → depends on: ${item.depends_on.join(", ")}` : "";
        lines.push(`- [${item.kind}] **${item.id}**${deps}`);
      }
    }
  }
  lines.push("");

  // ── Input Requirements ──
  lines.push("## Input Requirements");
  lines.push("");

  if (spell.inputs.required.length > 0) {
    lines.push("### Required");
    for (const input of spell.inputs.required) {
      lines.push(`- **${input.id}**: ${input.description} (formats: ${input.formats.join(", ")})`);
    }
    lines.push("");
  }
  if (spell.inputs.optional.length > 0) {
    lines.push("### Optional");
    for (const input of spell.inputs.optional) {
      lines.push(`- **${input.id}**: ${input.description} (formats: ${input.formats.join(", ")})`);
    }
    lines.push("");
  }
  if (spell.inputs.required.length === 0 && spell.inputs.optional.length === 0) {
    lines.push("No inputs required.");
    lines.push("");
  }

  // ── Tool Requirements ──
  lines.push("## Tool Requirements");
  lines.push("");

  const requiredTools = spell.requires.tools.filter((t) => !t.optional);
  const optionalTools = spell.requires.tools.filter((t) => t.optional);

  if (requiredTools.length > 0) {
    lines.push("### Required");
    for (const tool of requiredTools) {
      lines.push(`- \`${tool.uri}\`${tool.reason ? `: ${tool.reason}` : ""}`);
    }
    lines.push("");
  }
  if (optionalTools.length > 0) {
    lines.push("### Optional (improve results)");
    for (const tool of optionalTools) {
      lines.push(`- \`${tool.uri}\`${tool.reason ? `: ${tool.reason}` : ""}`);
    }
    lines.push("");
  }
  if (spell.requires.tools.length === 0) {
    lines.push("No external tools required. The spell can be cast with general-purpose capabilities.");
    lines.push("");
  }

  // ── Quality Gate Inventory ──
  lines.push("## Quality Gates");
  lines.push("");

  interface QualityGateEntry {
    id: string;
    kind: string;
    criteria: string;
    min_score: number;
    retry: boolean;
    max_retries: number;
  }

  const gates: QualityGateEntry[] = [];
  for (const step of spell.steps) {
    if (step.quality_check) {
      gates.push({
        id: step.id,
        kind: "step",
        criteria: step.quality_check.criteria.trim(),
        min_score: step.quality_check.min_score,
        retry: step.quality_check.retry_on_failure ?? false,
        max_retries: step.quality_check.max_retries ?? 2,
      });
    }
  }
  for (const output of spell.outputs) {
    if (output.quality_check) {
      gates.push({
        id: output.id,
        kind: "output",
        criteria: output.quality_check.criteria.trim(),
        min_score: output.quality_check.min_score,
        retry: output.quality_check.retry_on_failure ?? false,
        max_retries: output.quality_check.max_retries ?? 2,
      });
    }
  }
  for (const effect of spell.effects) {
    if (effect.quality_check) {
      gates.push({
        id: effect.id,
        kind: "effect",
        criteria: effect.quality_check.criteria.trim(),
        min_score: effect.quality_check.min_score,
        retry: effect.quality_check.retry_on_failure ?? false,
        max_retries: effect.quality_check.max_retries ?? 2,
      });
    }
  }

  if (gates.length === 0) {
    lines.push("No quality checks defined. Produce the best output you can.");
  } else {
    lines.push(`${gates.length} quality gate(s) to pass:`);
    lines.push("");
    for (const g of gates) {
      lines.push(`- [${g.kind}] **${g.id}**: ${g.criteria}`);
      lines.push(`  Score >= ${g.min_score}${g.retry ? `, retry up to ${g.max_retries}x on failure` : ", no retry"}`);
    }
  }
  lines.push("");

  // ── Catalysts ──
  lines.push("## Catalysts");
  lines.push("");

  if (spell.catalysts.length === 0) {
    lines.push("No catalysts. The spell does not bundle reference data.");
  } else {
    for (const cat of spell.catalysts) {
      lines.push(`- **${cat.id}** (${cat.type}): ${cat.description}`);
    }
    lines.push("");
    lines.push("Catalysts are resolved automatically and injected into the casting context for relevant steps.");
  }
  lines.push("");

  // ── Artifacts ──
  const artifactOutputs = spell.outputs.filter((o) => o.artifact);
  lines.push("## Artifact Templates");
  lines.push("");

  if (artifactOutputs.length === 0) {
    lines.push("No artifact templates. Outputs are free-form.");
  } else {
    for (const output of artifactOutputs) {
      lines.push(`- Output **${output.id}** uses template: \`${output.artifact}\``);
      lines.push(`  Fill each @begin:ID / @end:ID section according to its inline prompt.`);
    }
  }
  lines.push("");

  // ── Coverage Prerequisites ──
  lines.push("## Coverage Prerequisites");
  lines.push("");
  lines.push(`Before casting, call \`check_coverage("${spell.name}")\` to verify readiness.`);
  lines.push("");
  lines.push(`- Required tools: ${requiredTools.length}${requiredTools.length > 0 ? ` (${requiredTools.map((t) => t.uri).join(", ")})` : ""}`);
  lines.push(`- Required inputs: ${spell.inputs.required.length}${spell.inputs.required.length > 0 ? ` (${spell.inputs.required.map((i) => i.id).join(", ")})` : ""}`);
  lines.push(`- Catalysts: ${spell.catalysts.length} (auto-resolved from registry)`);
  lines.push("");

  // ── Recommended Approach ──
  lines.push("## Recommended Casting Approach");
  lines.push("");

  lines.push(`1. Call \`check_coverage("${spell.name}")\` to verify readiness.`);

  if (isGuided) {
    lines.push(`2. Request the \`cast_spell\` prompt with \`name: "${spell.name}"\` to get execution instructions.`);
    lines.push(`3. Follow the ${spell.steps.length} step(s) in the order shown above.`);

    const stepGates = gates.filter((g) => g.kind === "step");
    if (stepGates.length > 0) {
      lines.push(`4. After each quality-gated step (${stepGates.map((g) => g.id).join(", ")}), call \`quality_check\`.`);
    }
  } else {
    lines.push(`2. Request the \`cast_spell\` prompt with \`name: "${spell.name}"\` to get outcome declarations.`);
    lines.push("3. Plan your execution to produce all declared outputs and achieve all declared effects.");
    lines.push("4. Use available tools as needed.");
  }

  const outcomeGates = gates.filter((g) => g.kind !== "step");
  if (outcomeGates.length > 0) {
    lines.push(`${isGuided && gates.some((g) => g.kind === "step") ? "5" : "4"}. After producing results, call \`quality_check\` for: ${outcomeGates.map((g) => g.id).join(", ")}.`);
  }

  lines.push("");

  return lines.join("\n");
}

// ── Prompt 4: cast_spell (enhanced) ──────────────────────────────────────────
// Structured casting instructions for executing a spell.

export function generateCastPrompt(
  spell: SpellDefinition,
  inputs?: Record<string, string>,
): string {
  const lines: string[] = [];

  // ── Contract Framing ──
  lines.push(`# Casting: "${spell.name}" v${spell.version}`);
  lines.push("");
  lines.push("## Contract");
  lines.push("");
  lines.push("You are an autonomous agent casting this spell. A spell is a declarative contract — it specifies WHAT must be produced, not HOW. Your job is to satisfy the contract by producing the declared outputs and achieving the declared effects. Work autonomously until all outcomes are met.");
  lines.push("");
  lines.push(spell.description);
  lines.push("");

  // ── Desired Outcomes ──
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
        if (output.description) {
          lines.push(`  ${output.description}`);
        }
        if (output.acceptance_criteria) {
          lines.push(`  **Acceptance criteria:** ${output.acceptance_criteria.trim()}`);
        }
        if (output.depends_on?.length) {
          lines.push(`  **Depends on:** ${output.depends_on.join(", ")}`);
        }
        if (output.quality_check) {
          lines.push(`  **Quality gate:** ${output.quality_check.criteria.trim()} (min score: ${output.quality_check.min_score})`);
        }
        if (output.artifact) {
          lines.push(`  **Artifact template:** \`${output.artifact}\``);
        }
        lines.push("");
      }
    }

    if (hasEffects) {
      lines.push("### Effects");
      lines.push("");
      for (const effect of spell.effects) {
        lines.push(`- **${effect.id}** (${effect.type}): ${effect.description}`);
        if (effect.verification) {
          lines.push(`  **Verification:** ${effect.verification}`);
        }
        if (effect.depends_on?.length) {
          lines.push(`  **Depends on:** ${effect.depends_on.join(", ")}`);
        }
        if (effect.quality_check) {
          lines.push(`  **Quality gate:** ${effect.quality_check.criteria.trim()} (min score: ${effect.quality_check.min_score})`);
        }
        lines.push("");
      }
    }
  }

  // ── Quality Check Protocol ──
  const allGates: { id: string; kind: string; criteria: string; min_score: number; retry: boolean; max_retries: number }[] = [];
  for (const step of spell.steps) {
    if (step.quality_check) allGates.push({ id: step.id, kind: "step", criteria: step.quality_check.criteria.trim(), min_score: step.quality_check.min_score, retry: step.quality_check.retry_on_failure ?? false, max_retries: step.quality_check.max_retries ?? 2 });
  }
  for (const output of spell.outputs) {
    if (output.quality_check) allGates.push({ id: output.id, kind: "output", criteria: output.quality_check.criteria.trim(), min_score: output.quality_check.min_score, retry: output.quality_check.retry_on_failure ?? false, max_retries: output.quality_check.max_retries ?? 2 });
  }
  for (const effect of spell.effects) {
    if (effect.quality_check) allGates.push({ id: effect.id, kind: "effect", criteria: effect.quality_check.criteria.trim(), min_score: effect.quality_check.min_score, retry: effect.quality_check.retry_on_failure ?? false, max_retries: effect.quality_check.max_retries ?? 2 });
  }

  if (allGates.length > 0) {
    lines.push("## Quality Check Protocol");
    lines.push("");
    lines.push("This spell has quality gates you must pass. After producing content for a gated step, output, or effect:");
    lines.push("");
    lines.push("1. Call `quality_check` with the `step_id`, your `output` text, the `criteria`, and `min_score`.");
    lines.push("2. If the result is `passed: false` and the gate allows retries:");
    lines.push("   - Read the `feedback` field carefully.");
    lines.push("   - Revise your output to address the specific feedback.");
    lines.push("   - Call `quality_check` again.");
    lines.push("3. Repeat up to `max_retries` times. Report failure if it still doesn't pass.");
    lines.push("");
    lines.push("Gates to pass:");
    lines.push("");
    for (const g of allGates) {
      lines.push(`- [${g.kind}] **${g.id}**: ${g.criteria}`);
      lines.push(`  min_score: ${g.min_score}${g.retry ? `, retry up to ${g.max_retries}x` : ", no retry"}`);
    }
    lines.push("");
  }

  // ── Execution ──
  const sortedSteps = spell.steps.length > 0 ? topologicalSort(spell.steps) : [];

  if (sortedSteps.length > 0) {
    lines.push("## Guidance Steps");
    lines.push("");
    lines.push("The spell author suggests these steps. Treat them as guidance — you may adapt, reorder, or skip steps as long as the outcomes are achieved.");
    lines.push("");

    for (let i = 0; i < sortedSteps.length; i++) {
      const step = sortedSteps[i];
      const optional = step.optional ? " *(optional)*" : "";
      lines.push(`### Step ${i + 1}: ${step.id}${optional}`);
      lines.push("");
      lines.push(step.instruction.trim());
      lines.push("");

      const annotations: string[] = [];
      if (step.depends_on?.length) {
        annotations.push(`After: ${step.depends_on.join(", ")}`);
      }
      if (step.inputs_needed?.length) {
        annotations.push(`Inputs: ${step.inputs_needed.join(", ")}`);
      }
      if (step.tools_needed?.length) {
        annotations.push(`Tools: ${step.tools_needed.join(", ")}`);
      }
      if (step.catalysts_needed?.length) {
        annotations.push(`Catalysts: ${step.catalysts_needed.join(", ")} (reference data injected)`);
      }
      if (step.quality_check) {
        annotations.push(`Quality gate: ${step.quality_check.criteria.trim()} (min: ${step.quality_check.min_score})`);
      }

      if (annotations.length > 0) {
        for (const ann of annotations) {
          lines.push(`> ${ann}`);
        }
        lines.push("");
      }
    }
  } else {
    lines.push("## Execution");
    lines.push("");
    lines.push("No specific steps are prescribed. Plan your own approach to produce the required outputs and achieve the listed effects. Work autonomously using available tools and inputs.");
    lines.push("");
  }

  // ── Artifact Templates ──
  const artifactOutputs = spell.outputs.filter((o) => o.artifact);
  if (artifactOutputs.length > 0) {
    lines.push("## Artifact Templates");
    lines.push("");
    for (const output of artifactOutputs) {
      lines.push(`Output **${output.id}** uses a structured template (\`${output.artifact}\`):`);
      lines.push("");
      lines.push("- The template has static structure (headings, formatting) and dynamic sections.");
      lines.push("- Dynamic sections are marked with `@begin:section-id` and `@end:section-id`.");
      lines.push("- Between the markers is inline YAML with a `prompt` describing what to generate.");
      lines.push("- **Preserve all static content** outside the markers exactly as-is.");
      lines.push("- **Generate only** the content for each marked section, replacing the YAML.");
      lines.push("- Process sections in document order.");
      lines.push("");
    }
  }

  // ── Catalysts ──
  if (spell.catalysts.length > 0) {
    lines.push("## Catalysts");
    lines.push("");
    lines.push("The following reference data is bundled with this spell and available during casting:");
    lines.push("");
    for (const cat of spell.catalysts) {
      lines.push(`- **${cat.id}** (${cat.type}): ${cat.description}`);
    }
    lines.push("");
  }

  // ── Provided Inputs ──
  if (inputs && Object.keys(inputs).length > 0) {
    lines.push("## Provided Inputs");
    lines.push("");
    for (const [key, value] of Object.entries(inputs)) {
      if (key === "name") continue; // Skip the spell name argument
      lines.push(`- **${key}**: ${value}`);
    }
    lines.push("");
  }

  // ── Available Tools ──
  if (spell.requires.tools.length > 0) {
    lines.push("## Available Tools");
    lines.push("");
    for (const tool of spell.requires.tools) {
      const opt = tool.optional ? " *(optional)*" : "";
      lines.push(`- \`${tool.uri}\`${opt}${tool.reason ? `: ${tool.reason}` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
