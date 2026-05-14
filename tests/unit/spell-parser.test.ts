import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  parseSpellFile,
  parseSpellContent,
  validateSpell,
  topologicalSort,
} from "../../src/core/spell-parser.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

describe("parseSpellFile", () => {
  it("parses a valid spell YAML file", async () => {
    const spell = await parseSpellFile(resolve(FIXTURES, "sample-spell.yaml"));
    expect(spell.name).toBe("quarterly-financial-report");
    expect(spell.version).toBe("2.1.0");
    expect(spell.author).toBe("acme-corp");
    expect(spell.steps).toHaveLength(3);
    expect(spell.outputs).toHaveLength(2);
    expect(spell.effects).toHaveLength(2);
    expect(spell.inputs.required).toHaveLength(2);
    expect(spell.inputs.optional).toHaveLength(1);
    expect(spell.requires.tools).toHaveLength(3);

    // Check enriched output fields
    const reportOutput = spell.outputs.find((o) => o.id === "report-document");
    expect(reportOutput?.description).toBeDefined();
    expect(reportOutput?.acceptance_criteria).toBeDefined();
    expect(reportOutput?.quality_check).toBeDefined();
    expect(reportOutput?.quality_check?.min_score).toBe(0.8);
  });

  it("parses an outcome-only spell (no steps)", async () => {
    const spell = await parseSpellFile(resolve(FIXTURES, "outcome-only-spell.yaml"));
    expect(spell.name).toBe("competitive-analysis");
    expect(spell.steps).toHaveLength(0);
    expect(spell.outputs).toHaveLength(2);
    expect(spell.effects).toHaveLength(1);
    expect(spell.outputs[0].quality_check).toBeDefined();
  });

  it("throws on non-existent file", async () => {
    await expect(parseSpellFile("/nonexistent.yaml")).rejects.toThrow();
  });
});

describe("parseSpellContent", () => {
  it("parses valid YAML string", () => {
    const yaml = `
spell:
  name: test-spell
  version: "1.0.0"
  description: A test spell
  author: tester
  inputs:
    required: []
    optional: []
  requires:
    tools: []
  steps:
    - id: step-1
      instruction: Do something
  outputs: []
  metadata: {}
`;
    const spell = parseSpellContent(yaml);
    expect(spell.name).toBe("test-spell");
    expect(spell.steps).toHaveLength(1);
  });

  it("throws on invalid YAML syntax", () => {
    expect(() => parseSpellContent("not: valid: yaml: [")).toThrow();
  });

  it("throws on missing required fields", () => {
    const yaml = `
spell:
  name: incomplete
`;
    expect(() => parseSpellContent(yaml)).toThrow();
  });

  it("throws when spell key is missing", () => {
    const yaml = `
name: no-spell-wrapper
version: "1.0.0"
`;
    expect(() => parseSpellContent(yaml)).toThrow();
  });
});

describe("validateSpell", () => {
  it("validates a correct spell with no errors", () => {
    const spell = parseSpellContent(`
spell:
  name: good-spell
  version: "1.0.0"
  description: A good spell
  author: tester
  inputs:
    required:
      - id: data
        description: Some data
        formats: [csv]
    optional: []
  requires:
    tools:
      - uri: "mcp://filesystem/read_file"
        reason: Read files
  steps:
    - id: step-1
      instruction: Do step 1
      inputs_needed: [data]
    - id: step-2
      instruction: Do step 2
      depends_on: [step-1]
  outputs: []
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects unknown depends_on references", () => {
    const spell = parseSpellContent(`
spell:
  name: bad-deps
  version: "1.0.0"
  description: Bad deps
  author: tester
  inputs: { required: [], optional: [] }
  requires: { tools: [] }
  steps:
    - id: step-1
      instruction: Do something
      depends_on: [nonexistent-step]
  outputs: []
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "UNKNOWN_DEPENDENCY")).toBe(true);
  });

  it("detects invalid tool URIs in requires", () => {
    const spell = parseSpellContent(`
spell:
  name: bad-uri
  version: "1.0.0"
  description: Bad URI
  author: tester
  inputs: { required: [], optional: [] }
  requires:
    tools:
      - uri: "not-mcp://wrong"
  steps:
    - id: step-1
      instruction: Do something
  outputs: []
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_TOOL_URI")).toBe(true);
  });

  it("detects circular dependencies", () => {
    const spell = parseSpellContent(`
spell:
  name: circular
  version: "1.0.0"
  description: Circular
  author: tester
  inputs: { required: [], optional: [] }
  requires: { tools: [] }
  steps:
    - id: a
      instruction: A
      depends_on: [b]
    - id: b
      instruction: B
      depends_on: [a]
  outputs: []
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "CIRCULAR_DEPENDENCY")).toBe(true);
  });

  it("detects duplicate step IDs", () => {
    const spell = parseSpellContent(`
spell:
  name: dupes
  version: "1.0.0"
  description: Dupes
  author: tester
  inputs: { required: [], optional: [] }
  requires: { tools: [] }
  steps:
    - id: step-1
      instruction: First
    - id: step-1
      instruction: Duplicate
  outputs: []
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "DUPLICATE_ID")).toBe(true);
  });

  it("warns on unknown inputs_needed references", () => {
    const spell = parseSpellContent(`
spell:
  name: bad-inputs
  version: "1.0.0"
  description: Bad inputs ref
  author: tester
  inputs: { required: [], optional: [] }
  requires: { tools: [] }
  steps:
    - id: step-1
      instruction: Do something
      inputs_needed: [nonexistent-input]
  outputs: []
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("validateSpell — catalysts", () => {
  it("validates a spell with valid catalysts", () => {
    const spell = parseSpellContent(`
spell:
  name: catalyst-spell
  version: "1.0.0"
  description: Spell with catalysts
  author: tester
  inputs: { required: [], optional: [] }
  catalysts:
    - id: methods
      description: Calculation methods
      uri: "catalyst://catalyst-spell/methods.md"
      type: reference
  requires: { tools: [] }
  steps:
    - id: step-1
      instruction: Do something
      catalysts_needed: [methods]
  outputs: []
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects unknown catalysts_needed references", () => {
    const spell = parseSpellContent(`
spell:
  name: bad-catalyst-ref
  version: "1.0.0"
  description: Bad catalyst ref
  author: tester
  inputs: { required: [], optional: [] }
  catalysts: []
  requires: { tools: [] }
  steps:
    - id: step-1
      instruction: Do something
      catalysts_needed: [nonexistent-catalyst]
  outputs: []
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "UNKNOWN_CATALYST")).toBe(true);
  });

  it("detects invalid catalyst URIs", () => {
    const spell = parseSpellContent(`
spell:
  name: bad-catalyst-uri
  version: "1.0.0"
  description: Bad catalyst URI
  author: tester
  inputs: { required: [], optional: [] }
  catalysts:
    - id: methods
      description: Calculation methods
      uri: "http://wrong-scheme/methods.md"
      type: reference
  requires: { tools: [] }
  steps:
    - id: step-1
      instruction: Do something
  outputs: []
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_CATALYST_URI")).toBe(true);
  });

  it("parses sample spell with catalysts correctly", async () => {
    const spell = await parseSpellFile(resolve(FIXTURES, "sample-spell.yaml"));
    expect(spell.catalysts).toHaveLength(2);
    expect(spell.catalysts[0].id).toBe("gaap-methods");
    expect(spell.catalysts[0].type).toBe("reference");
    expect(spell.catalysts[1].id).toBe("report-template");
    expect(spell.catalysts[1].type).toBe("template");

    // Check step references catalysts_needed
    const analyzeStep = spell.steps.find((s) => s.id === "analyze-data");
    expect(analyzeStep?.catalysts_needed).toContain("gaap-methods");
  });
});

describe("validateSpell — effects and enriched outputs", () => {
  it("validates a spell with effects and enriched outputs", () => {
    const spell = parseSpellContent(`
spell:
  name: outcomes-spell
  version: "1.0.0"
  description: Outcome-centric spell
  author: tester
  inputs:
    required:
      - id: data
        description: Some data
        formats: [csv]
    optional: []
  requires: { tools: [] }
  steps: []
  outputs:
    - id: report
      type: document
      format: [md]
      description: Analysis report
      acceptance_criteria: Must include findings
      inputs_needed: [data]
      quality_check:
        criteria: Report has findings
        min_score: 0.7
        retry_on_failure: true
  effects:
    - id: data-archived
      type: archival
      description: Data archived after processing
      verification: Archive record exists
      depends_on: [report]
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects unknown depends_on in effects", () => {
    const spell = parseSpellContent(`
spell:
  name: bad-effect-deps
  version: "1.0.0"
  description: Bad effect deps
  author: tester
  inputs: { required: [], optional: [] }
  requires: { tools: [] }
  outputs:
    - id: report
      type: document
      format: [md]
  effects:
    - id: notify
      type: notification
      description: Notify stakeholders
      depends_on: [nonexistent]
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "UNKNOWN_DEPENDENCY")).toBe(true);
  });

  it("detects duplicate IDs across steps and effects", () => {
    const spell = parseSpellContent(`
spell:
  name: cross-dupes
  version: "1.0.0"
  description: Cross-type duplicate IDs
  author: tester
  inputs: { required: [], optional: [] }
  requires: { tools: [] }
  steps:
    - id: shared-id
      instruction: A step
  effects:
    - id: shared-id
      type: notification
      description: Same ID as the step
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "DUPLICATE_ID")).toBe(true);
  });

  it("rejects output with invalid quality check score at parse time", () => {
    expect(() => parseSpellContent(`
spell:
  name: bad-qc
  version: "1.0.0"
  description: Bad quality check
  author: tester
  inputs: { required: [], optional: [] }
  requires: { tools: [] }
  outputs:
    - id: report
      type: document
      format: [md]
      quality_check:
        criteria: Test
        min_score: 1.5
        retry_on_failure: false
  metadata: {}
`)).toThrow();
  });

  it("rejects spell with no steps, outputs, or effects", () => {
    expect(() => parseSpellContent(`
spell:
  name: empty-spell
  version: "1.0.0"
  description: Empty
  author: tester
  inputs: { required: [], optional: [] }
  requires: { tools: [] }
  steps: []
  outputs: []
  effects: []
  metadata: {}
`)).toThrow();
  });
});

describe("topologicalSort", () => {
  it("sorts items in dependency order", () => {
    const items = [
      { id: "c", depends_on: ["a", "b"] },
      { id: "a" },
      { id: "b", depends_on: ["a"] },
    ];

    const sorted = topologicalSort(items);
    const ids = sorted.map((s) => s.id);

    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("c"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
  });

  it("handles items with no dependencies", () => {
    const items = [
      { id: "x" },
      { id: "y" },
      { id: "z" },
    ];

    const sorted = topologicalSort(items);
    expect(sorted).toHaveLength(3);
  });

  it("throws on circular dependency", () => {
    const items = [
      { id: "a", depends_on: ["b"] },
      { id: "b", depends_on: ["a"] },
    ];

    expect(() => topologicalSort(items)).toThrow();
  });

  it("throws on unknown dependency reference", () => {
    const items = [
      { id: "a", depends_on: ["nonexistent"] },
    ];

    expect(() => topologicalSort(items)).toThrow();
  });

  it("sorts mixed steps, outputs, and effects", () => {
    const items = [
      { id: "effect-1", depends_on: ["output-1"] },
      { id: "output-1", depends_on: ["step-1"] },
      { id: "step-1" },
    ];

    const sorted = topologicalSort(items);
    const ids = sorted.map((s) => s.id);

    expect(ids.indexOf("step-1")).toBeLessThan(ids.indexOf("output-1"));
    expect(ids.indexOf("output-1")).toBeLessThan(ids.indexOf("effect-1"));
  });
});

describe("validateSpell — artifact templates", () => {
  it("validates a spell with valid artifact URI", () => {
    const spell = parseSpellContent(`
spell:
  name: artifact-spell
  version: "1.0.0"
  description: Spell with artifact template
  author: tester
  inputs: { required: [], optional: [] }
  requires: { tools: [] }
  outputs:
    - id: report
      type: document
      format: [md]
      artifact: "artifact://artifact-spell/report-template.md"
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects invalid artifact URI scheme", () => {
    const spell = parseSpellContent(`
spell:
  name: bad-artifact
  version: "1.0.0"
  description: Bad artifact URI
  author: tester
  inputs: { required: [], optional: [] }
  requires: { tools: [] }
  outputs:
    - id: report
      type: document
      format: [md]
      artifact: "http://wrong-scheme/template.md"
  metadata: {}
`);
    const result = validateSpell(spell);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_ARTIFACT_URI")).toBe(true);
  });

  it("parses a spell with artifact template from fixture", async () => {
    const spell = await parseSpellFile(resolve(FIXTURES, "templated-spell.yaml"));
    expect(spell.name).toBe("templated-financial-report");
    expect(spell.outputs).toHaveLength(1);
    expect(spell.outputs[0].artifact).toBeDefined();
    expect(spell.outputs[0].artifact).toBe("artifact://templated-financial-report/report-template.md");
  });
});
