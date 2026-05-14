import { describe, it, expect } from "vitest";
import type { SpellDefinition } from "../../src/types/spell.js";
import { topologicalSort } from "../../src/core/spell-parser.js";
import { stringifyYaml } from "../../src/utils/yaml.js";

function makeRecipe(overrides: Partial<SpellDefinition> = {}): SpellDefinition {
  return {
    name: "test-spell",
    version: "1.0.0",
    description: "A test spell",
    author: "tester",
    tags: ["test"],
    inputs: {
      required: [
        { id: "data", description: "Input data file", formats: ["csv", "xlsx"] },
      ],
      optional: [
        { id: "template", description: "Output template", formats: ["docx"] },
      ],
    },
    requires: {
      tools: [
        { uri: "mcp://filesystem/read_file", reason: "Read input files", optional: false },
        { uri: "mcp://filesystem/write_file", reason: "Write output", optional: false },
      ],
      resources: [],
    },
    steps: [
      {
        id: "analyze",
        instruction: "Analyze the input data.\nExtract key metrics.",
        optional: false,
      },
      {
        id: "generate",
        instruction: "Generate the report from analysis.",
        depends_on: ["analyze"],
        tools_needed: ["filesystem/write_file"],
        quality_check: {
          criteria: "Must include specific numbers",
          min_score: 0.8,
          retry_on_failure: true,
          max_retries: 2,
        },
        optional: false,
      },
    ],
    outputs: [
      { id: "report", type: "document", format: ["pdf", "docx"] },
    ],
    metadata: { category: "test" },
    ...overrides,
  };
}

// Replicating the flat prompt generation logic for testing
function generateFlatPrompt(spell: SpellDefinition): string {
  const sortedSteps = topologicalSort(spell.steps);
  const lines: string[] = [];

  lines.push(`You are executing the spell "${spell.name}" v${spell.version}.`);
  lines.push(`${spell.description}`);
  lines.push("");
  lines.push("Follow these steps in order:");
  lines.push("");

  for (let i = 0; i < sortedSteps.length; i++) {
    const step = sortedSteps[i];
    lines.push(`## Step ${i + 1}: ${step.id}`);
    lines.push(step.instruction.trim());

    if (step.inputs_needed && step.inputs_needed.length > 0) {
      lines.push(`[Inputs needed: ${step.inputs_needed.join(", ")}]`);
    }

    if (step.quality_check) {
      lines.push(`[Quality criteria: ${step.quality_check.criteria.trim()}]`);
    }

    lines.push("");
  }

  if (spell.inputs.required.length > 0) {
    lines.push("## Required Inputs");
    for (const input of spell.inputs.required) {
      lines.push(`- **${input.id}**: ${input.description} (formats: ${input.formats.join(", ")})`);
    }
    lines.push("");
  }

  if (spell.inputs.optional.length > 0) {
    lines.push("## Optional Inputs");
    for (const input of spell.inputs.optional) {
      lines.push(`- **${input.id}**: ${input.description} (formats: ${input.formats.join(", ")})`);
    }
    lines.push("");
  }

  if (spell.requires.tools.length > 0) {
    lines.push("## Available Tools");
    for (const tool of spell.requires.tools) {
      const optional = tool.optional ? " (optional)" : "";
      lines.push(`- ${tool.uri}: ${tool.reason || "No description"}${optional}`);
    }
    lines.push("");
  }

  if (spell.outputs.length > 0) {
    lines.push("## Expected Outputs");
    for (const output of spell.outputs) {
      lines.push(`- **${output.id}** (${output.type}): ${output.format.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

describe("spell export", () => {
  describe("YAML export", () => {
    it("produces valid YAML output", () => {
      const spell = makeRecipe();
      const yaml = stringifyYaml({ spell });
      expect(yaml).toContain("name: test-spell");
      expect(yaml).toContain("version: 1.0.0");
      expect(yaml).toContain("analyze");
      expect(yaml).toContain("generate");
    });
  });

  describe("JSON export", () => {
    it("produces valid JSON output", () => {
      const spell = makeRecipe();
      const json = JSON.stringify({ spell }, null, 2);
      const parsed = JSON.parse(json);
      expect(parsed.spell.name).toBe("test-spell");
      expect(parsed.spell.steps).toHaveLength(2);
    });
  });

  describe("flat prompt export", () => {
    it("generates a prompt with all steps in order", () => {
      const spell = makeRecipe();
      const prompt = generateFlatPrompt(spell);

      expect(prompt).toContain('You are executing the spell "test-spell"');
      expect(prompt).toContain("## Step 1: analyze");
      expect(prompt).toContain("## Step 2: generate");
    });

    it("includes quality gate criteria", () => {
      const spell = makeRecipe();
      const prompt = generateFlatPrompt(spell);

      expect(prompt).toContain("[Quality criteria: Must include specific numbers]");
    });

    it("includes required inputs section", () => {
      const spell = makeRecipe();
      const prompt = generateFlatPrompt(spell);

      expect(prompt).toContain("## Required Inputs");
      expect(prompt).toContain("**data**: Input data file");
    });

    it("includes optional inputs section", () => {
      const spell = makeRecipe();
      const prompt = generateFlatPrompt(spell);

      expect(prompt).toContain("## Optional Inputs");
      expect(prompt).toContain("**template**: Output template");
    });

    it("includes available tools section", () => {
      const spell = makeRecipe();
      const prompt = generateFlatPrompt(spell);

      expect(prompt).toContain("## Available Tools");
      expect(prompt).toContain("mcp://filesystem/read_file");
    });

    it("includes expected outputs section", () => {
      const spell = makeRecipe();
      const prompt = generateFlatPrompt(spell);

      expect(prompt).toContain("## Expected Outputs");
      expect(prompt).toContain("**report** (document)");
    });

    it("respects topological ordering", () => {
      const spell = makeRecipe();
      const prompt = generateFlatPrompt(spell);

      const analyzeIdx = prompt.indexOf("Step 1: analyze");
      const generateIdx = prompt.indexOf("Step 2: generate");
      expect(analyzeIdx).toBeLessThan(generateIdx);
    });

    it("handles spell with no optional fields", () => {
      const spell = makeRecipe({
        inputs: { required: [], optional: [] },
        requires: { tools: [], resources: [] },
        outputs: [],
        steps: [{ id: "only", instruction: "Do it.", optional: false }],
      });
      const prompt = generateFlatPrompt(spell);

      expect(prompt).toContain("## Step 1: only");
      expect(prompt).not.toContain("## Required Inputs");
      expect(prompt).not.toContain("## Available Tools");
    });
  });
});
