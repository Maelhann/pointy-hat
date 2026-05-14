import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveCatalysts, type ResolvedCatalyst } from "../../src/core/catalyst-resolver.js";
import type { SpellDefinition } from "../../src/types/spell.js";
import type { RegistryClient } from "../../src/core/registry-client.js";
import { Cache } from "../../src/core/cache.js";

function makeRecipe(overrides?: Partial<SpellDefinition>): SpellDefinition {
  return {
    name: "test-spell",
    version: "1.0.0",
    description: "Test",
    author: "test",
    tags: [],
    inputs: { required: [], optional: [] },
    catalysts: [],
    requires: { tools: [], resources: [] },
    steps: [{ id: "step-1", instruction: "Do something", optional: false }],
    outputs: [],
    metadata: {},
    ...overrides,
  };
}

function mockRegistryClient(responses?: Record<string, string>): RegistryClient {
  return {
    fetchCatalyst: vi.fn(async (spellName: string, version: string, catalystId: string) => {
      const key = `${spellName}/${version}/${catalystId}`;
      const content = responses?.[key];
      if (!content) throw new Error(`Catalyst not found: ${key}`);
      return content;
    }),
  } as unknown as RegistryClient;
}

describe("resolveCatalysts", () => {
  it("returns empty map for spell with no catalysts", async () => {
    const spell = makeRecipe();
    const client = mockRegistryClient();
    const result = await resolveCatalysts(spell, client);
    expect(result.size).toBe(0);
  });

  it("fetches catalysts from registry", async () => {
    const spell = makeRecipe({
      catalysts: [
        { id: "methods", description: "Methods", uri: "catalyst://test-spell/methods.md", type: "reference" },
      ],
    });
    const client = mockRegistryClient({
      "test-spell/1.0.0/methods": "# GAAP Methods\nRevenue recognition rules...",
    });

    const result = await resolveCatalysts(spell, client);
    expect(result.size).toBe(1);
    expect(result.get("methods")?.content).toContain("GAAP Methods");
    expect(result.get("methods")?.type).toBe("reference");
  });

  it("resolves multiple catalysts", async () => {
    const spell = makeRecipe({
      catalysts: [
        { id: "methods", description: "Methods", uri: "catalyst://test-spell/methods.md", type: "reference" },
        { id: "template", description: "Template", uri: "catalyst://test-spell/template.md", type: "template" },
      ],
    });
    const client = mockRegistryClient({
      "test-spell/1.0.0/methods": "Methods content",
      "test-spell/1.0.0/template": "Template content",
    });

    const result = await resolveCatalysts(spell, client);
    expect(result.size).toBe(2);
    expect(result.has("methods")).toBe(true);
    expect(result.has("template")).toBe(true);
  });

  it("throws when catalyst is not found in registry", async () => {
    const spell = makeRecipe({
      catalysts: [
        { id: "missing", description: "Missing", uri: "catalyst://test-spell/missing.md", type: "reference" },
      ],
    });
    const client = mockRegistryClient({}); // no responses

    await expect(resolveCatalysts(spell, client)).rejects.toThrow("Catalyst not found");
  });
});
