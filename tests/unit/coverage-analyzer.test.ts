import { describe, it, expect } from "vitest";
import { analyzeCoverage, parseToolUri, type ProvidedInput } from "../../src/core/coverage-analyzer.js";
import type { SpellDefinition } from "../../src/types/spell.js";

function makeRecipe(overrides?: Partial<SpellDefinition>): SpellDefinition {
  return {
    name: "test-spell",
    version: "1.0.0",
    description: "Test",
    author: "test",
    tags: [],
    inputs: {
      required: [
        { id: "data-file", description: "CSV data file", formats: ["csv"] },
      ],
      optional: [
        { id: "config", description: "Optional config", formats: ["json"] },
      ],
    },
    catalysts: [],
    requires: {
      tools: [
        { uri: "mcp://filesystem/read_file", reason: "Read files", optional: false },
        { uri: "mcp://analysis/analyze", reason: "Analyze data", optional: true },
      ],
      resources: [],
    },
    steps: [{ id: "step-1", instruction: "Do something", optional: false }],
    outputs: [],
    metadata: {},
    ...overrides,
  };
}

describe("parseToolUri", () => {
  it("parses mcp:// URIs", () => {
    expect(parseToolUri("mcp://filesystem/read_file")).toBe("filesystem/read_file");
  });

  it("returns non-mcp URIs as-is", () => {
    expect(parseToolUri("filesystem/read_file")).toBe("filesystem/read_file");
  });
});

describe("analyzeCoverage", () => {
  it("returns 100% when all requirements are met", () => {
    const spell = makeRecipe();
    const tools = new Set(["filesystem/read_file", "analysis/analyze"]);
    const inputs: ProvidedInput[] = [
      { key: "data-file", value: "data.csv" },
      { key: "config", value: "config.json" },
    ];

    const result = analyzeCoverage(spell, tools, inputs);
    expect(result.score).toBe(100);
    expect(result.canCast).toBe(true);
    expect(result.missingRequired).toHaveLength(0);
  });

  it("canCast is true when only optional items are missing", () => {
    const spell = makeRecipe();
    const tools = new Set(["filesystem/read_file"]);
    const inputs: ProvidedInput[] = [
      { key: "data-file", value: "data.csv" },
    ];

    const result = analyzeCoverage(spell, tools, inputs);
    expect(result.canCast).toBe(true);
    expect(result.score).toBeLessThan(100);
    expect(result.missingOptional.length).toBeGreaterThan(0);
  });

  it("canCast is false when required items are missing", () => {
    const spell = makeRecipe();
    const tools = new Set<string>();
    const inputs: ProvidedInput[] = [];

    const result = analyzeCoverage(spell, tools, inputs);
    expect(result.canCast).toBe(false);
    expect(result.missingRequired.length).toBeGreaterThan(0);
  });

  it("matches inputs by file extension", () => {
    const spell = makeRecipe();
    const tools = new Set(["filesystem/read_file"]);
    const inputs: ProvidedInput[] = [
      { key: "myfile", value: "quarterly.csv" },
    ];

    const result = analyzeCoverage(spell, tools, inputs);
    // Should match "quarterly.csv" to "data-file" requirement via .csv extension
    const dataItem = result.items.find((i) => i.id === "data-file");
    expect(dataItem?.status).toBe("matched");
  });

  it("matches inputs by exact key", () => {
    const spell = makeRecipe();
    const tools = new Set(["filesystem/read_file"]);
    const inputs: ProvidedInput[] = [
      { key: "data-file", value: "anything.txt" },
    ];

    const result = analyzeCoverage(spell, tools, inputs);
    const dataItem = result.items.find((i) => i.id === "data-file");
    expect(dataItem?.status).toBe("matched");
    expect(dataItem?.confidence).toBe(1.0);
  });

  it("returns correct score with weighted formula", () => {
    // 1 required tool (matched) + 1 required input (missing) + 1 optional tool (missing) + 1 optional input (missing)
    // matchedRequired=1, totalRequired=2, matchedOptional=0, totalOptional=2
    // score = (1*3 + 0) / (2*3 + 2) * 100 = 3/8 * 100 = 37.5
    const spell = makeRecipe();
    const tools = new Set(["filesystem/read_file"]);
    const inputs: ProvidedInput[] = [];

    const result = analyzeCoverage(spell, tools, inputs);
    expect(result.score).toBe(37.5);
  });

  it("returns 100% for spell with no requirements", () => {
    const spell = makeRecipe({
      inputs: { required: [], optional: [] },
      requires: { tools: [], resources: [] },
    });

    const result = analyzeCoverage(spell, new Set(), []);
    expect(result.score).toBe(100);
    expect(result.canCast).toBe(true);
  });

  it("includes warnings for missing optional tools", () => {
    const spell = makeRecipe();
    const tools = new Set(["filesystem/read_file"]); // missing optional analysis/analyze
    const inputs: ProvidedInput[] = [{ key: "data-file", value: "data.csv" }];

    const result = analyzeCoverage(spell, tools, inputs);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("analysis/analyze");
  });

  it("includes catalyst items in coverage results", () => {
    const spell = makeRecipe({
      catalysts: [
        { id: "methods", description: "Calculation methods", uri: "catalyst://test/methods.md", type: "reference" },
        { id: "template", description: "Report template", uri: "catalyst://test/template.md", type: "template" },
      ],
    });
    const tools = new Set(["filesystem/read_file"]);
    const inputs: ProvidedInput[] = [{ key: "data-file", value: "data.csv" }];

    const result = analyzeCoverage(spell, tools, inputs);
    const catalystItems = result.items.filter((i) => i.type === "catalyst");
    expect(catalystItems).toHaveLength(2);
    expect(catalystItems[0].status).toBe("matched");
    expect(catalystItems[0].required).toBe(true);
    expect(catalystItems[1].id).toBe("template");
  });

  it("catalysts are always matched (bundled with spell)", () => {
    const spell = makeRecipe({
      catalysts: [
        { id: "data", description: "Reference data", uri: "catalyst://test/data.json", type: "data" },
      ],
    });

    const result = analyzeCoverage(spell, new Set(), []);
    const catalystItem = result.items.find((i) => i.type === "catalyst");
    expect(catalystItem?.status).toBe("matched");
    expect(catalystItem?.confidence).toBe(1.0);
  });
});
