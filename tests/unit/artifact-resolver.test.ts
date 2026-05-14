import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  parseTemplateMarkers,
  parseSectionContent,
  parseArtifactTemplate,
  assembleArtifact,
} from "../../src/core/artifact-resolver.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

describe("parseTemplateMarkers", () => {
  it("extracts sections in document order from a markdown template", () => {
    const content = readFileSync(resolve(FIXTURES, "report-template.md"), "utf-8");
    const markers = parseTemplateMarkers(content);

    expect(markers).toHaveLength(4);
    expect(markers[0].id).toBe("executive-summary");
    expect(markers[1].id).toBe("revenue-analysis");
    expect(markers[2].id).toBe("expense-breakdown");
    expect(markers[3].id).toBe("conclusions");

    // Verify ordering: each marker's startLine < endLine, and ordered
    for (let i = 0; i < markers.length; i++) {
      expect(markers[i].startLine).toBeLessThan(markers[i].endLine);
      if (i > 0) {
        expect(markers[i].startLine).toBeGreaterThan(markers[i - 1].endLine);
      }
    }
  });

  it("handles markers embedded in different comment styles", () => {
    const content = [
      "# @begin:imports",
      "prompt: generate imports",
      "# @end:imports",
      "",
      "// @begin:main-logic",
      "prompt: generate main logic",
      "// @end:main-logic",
      "",
      "/* @begin:styles */",
      "prompt: generate styles",
      "/* @end:styles */",
    ].join("\n");

    const markers = parseTemplateMarkers(content);
    expect(markers).toHaveLength(3);
    expect(markers[0].id).toBe("imports");
    expect(markers[1].id).toBe("main-logic");
    expect(markers[2].id).toBe("styles");
  });

  it("handles markers with hyphens and underscores in IDs", () => {
    const content = [
      "@begin:section-one",
      "prompt: content",
      "@end:section-one",
      "@begin:section_two",
      "prompt: content",
      "@end:section_two",
    ].join("\n");

    const markers = parseTemplateMarkers(content);
    expect(markers).toHaveLength(2);
    expect(markers[0].id).toBe("section-one");
    expect(markers[1].id).toBe("section_two");
  });

  it("throws on unmatched @begin (no @end)", () => {
    const content = [
      "@begin:orphan",
      "some content",
    ].join("\n");

    expect(() => parseTemplateMarkers(content)).toThrow("@begin:orphan");
  });

  it("throws on unmatched @end (no @begin)", () => {
    const content = [
      "some content",
      "@end:orphan",
    ].join("\n");

    expect(() => parseTemplateMarkers(content)).toThrow("@end:orphan");
  });

  it("throws on duplicate @begin before @end", () => {
    const content = [
      "@begin:dup",
      "first",
      "@begin:dup",
      "second",
      "@end:dup",
    ].join("\n");

    expect(() => parseTemplateMarkers(content)).toThrow("Duplicate @begin:dup");
  });

  it("returns empty array for content with no markers", () => {
    const content = "# Just a heading\nSome text\n";
    const markers = parseTemplateMarkers(content);
    expect(markers).toHaveLength(0);
  });
});

describe("parseSectionContent", () => {
  it("parses a section with prompt only", () => {
    const section = parseSectionContent("intro", 'prompt: "Write an introduction."');
    expect(section.prompt).toBe("Write an introduction.");
    expect(section.quality_check).toBeUndefined();
  });

  it("parses a section with prompt and quality_check", () => {
    const yaml = [
      "prompt: |",
      "  Analyze the data in detail.",
      "quality_check:",
      '  criteria: "Includes specific numbers"',
      "  min_score: 0.8",
    ].join("\n");

    const section = parseSectionContent("analysis", yaml);
    expect(section.prompt).toContain("Analyze the data");
    expect(section.quality_check).toBeDefined();
    expect(section.quality_check!.criteria).toBe("Includes specific numbers");
    expect(section.quality_check!.min_score).toBe(0.8);
  });

  it("throws on empty section content", () => {
    expect(() => parseSectionContent("empty", "")).toThrow('Section "empty" is empty');
  });

  it("throws on invalid YAML", () => {
    expect(() => parseSectionContent("bad", "prompt: [invalid: yaml: {{")).toThrow('Section "bad"');
  });

  it("throws when prompt field is missing", () => {
    expect(() => parseSectionContent("no-prompt", "quality_check:\n  criteria: test\n  min_score: 0.5")).toThrow('Section "no-prompt"');
  });
});

describe("parseArtifactTemplate", () => {
  it("parses the full fixture template with inline prompts", () => {
    const content = readFileSync(resolve(FIXTURES, "report-template.md"), "utf-8");
    const { sections, sectionOrder } = parseArtifactTemplate(content);

    expect(sectionOrder).toEqual([
      "executive-summary",
      "revenue-analysis",
      "expense-breakdown",
      "conclusions",
    ]);

    expect(sections.size).toBe(4);

    const summary = sections.get("executive-summary");
    expect(summary).toBeDefined();
    expect(summary!.prompt).toContain("executive summary");
    expect(summary!.quality_check).toBeDefined();
    expect(summary!.quality_check!.min_score).toBe(0.8);

    const expenses = sections.get("expense-breakdown");
    expect(expenses).toBeDefined();
    expect(expenses!.prompt).toContain("operating expenses");
    expect(expenses!.quality_check).toBeUndefined();

    const conclusions = sections.get("conclusions");
    expect(conclusions).toBeDefined();
    expect(conclusions!.quality_check!.min_score).toBe(0.75);
  });

  it("parses a simple inline template", () => {
    const content = [
      "# Header",
      "<!-- @begin:intro -->",
      'prompt: "Write an intro."',
      "<!-- @end:intro -->",
      "# Footer",
    ].join("\n");

    const { sections, sectionOrder } = parseArtifactTemplate(content);
    expect(sectionOrder).toEqual(["intro"]);
    expect(sections.get("intro")!.prompt).toBe("Write an intro.");
  });
});

describe("assembleArtifact", () => {
  it("replaces sections and strips markers by default", () => {
    const template = [
      "# Report",
      "",
      "## Summary",
      "<!-- @begin:summary -->",
      "prompt: summarize",
      "<!-- @end:summary -->",
      "",
      "## Details",
      "<!-- @begin:details -->",
      "prompt: detail things",
      "<!-- @end:details -->",
    ].join("\n");

    const filled = new Map<string, string>();
    filled.set("summary", "This is the summary.");
    filled.set("details", "These are the details.\nWith multiple lines.");

    const result = assembleArtifact(template, filled);

    expect(result).toContain("# Report");
    expect(result).toContain("## Summary");
    expect(result).toContain("This is the summary.");
    expect(result).toContain("## Details");
    expect(result).toContain("These are the details.");
    expect(result).toContain("With multiple lines.");
    expect(result).not.toContain("@begin");
    expect(result).not.toContain("@end");
    expect(result).not.toContain("prompt:");
  });

  it("preserves markers when stripMarkers is false", () => {
    const template = [
      "<!-- @begin:section -->",
      "prompt: placeholder",
      "<!-- @end:section -->",
    ].join("\n");

    const filled = new Map<string, string>();
    filled.set("section", "filled content");

    const result = assembleArtifact(template, filled, false);

    expect(result).toContain("@begin:section");
    expect(result).toContain("@end:section");
    expect(result).toContain("filled content");
    expect(result).not.toContain("placeholder");
  });

  it("preserves non-section content", () => {
    const template = [
      "# Header",
      "Intro paragraph.",
      "",
      "<!-- @begin:body -->",
      "prompt: generate body",
      "<!-- @end:body -->",
      "",
      "Footer text.",
    ].join("\n");

    const filled = new Map<string, string>();
    filled.set("body", "Body content here.");

    const result = assembleArtifact(template, filled);

    expect(result).toContain("# Header");
    expect(result).toContain("Intro paragraph.");
    expect(result).toContain("Body content here.");
    expect(result).toContain("Footer text.");
  });

  it("handles sections with existing content between markers", () => {
    const template = [
      "<!-- @begin:section -->",
      "prompt: old content line 1",
      "quality_check:",
      "  criteria: old",
      "  min_score: 0.5",
      "<!-- @end:section -->",
    ].join("\n");

    const filled = new Map<string, string>();
    filled.set("section", "new content");

    const result = assembleArtifact(template, filled);

    expect(result).toBe("new content");
    expect(result).not.toContain("old content");
  });

  it("leaves unfilled sections empty", () => {
    const template = [
      "<!-- @begin:filled -->",
      "prompt: fill me",
      "<!-- @end:filled -->",
      "<!-- @begin:unfilled -->",
      "prompt: fill me too",
      "<!-- @end:unfilled -->",
    ].join("\n");

    const filled = new Map<string, string>();
    filled.set("filled", "some content");

    const result = assembleArtifact(template, filled);

    expect(result).toContain("some content");
    // Unfilled section becomes empty string
    expect(result).not.toContain("@begin");
  });

  it("handles the full fixture template", () => {
    const content = readFileSync(resolve(FIXTURES, "report-template.md"), "utf-8");

    const filled = new Map<string, string>();
    filled.set("executive-summary", "Q4 revenue grew 15% YoY.");
    filled.set("revenue-analysis", "Product A: $10M, Product B: $8M.");
    filled.set("expense-breakdown", "OpEx: $5M, R&D: $3M.");
    filled.set("conclusions", "1. Expand Product A.\n2. Reduce OpEx.\n3. Invest in R&D.");

    const result = assembleArtifact(content, filled);

    expect(result).toContain("# Quarterly Financial Report");
    expect(result).toContain("Q4 revenue grew 15% YoY.");
    expect(result).toContain("Product A: $10M, Product B: $8M.");
    expect(result).toContain("OpEx: $5M, R&D: $3M.");
    expect(result).toContain("Expand Product A.");
    expect(result).not.toContain("@begin");
    expect(result).not.toContain("@end");
    expect(result).not.toContain("prompt:");
  });
});
