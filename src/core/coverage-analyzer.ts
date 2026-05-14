import { extname, basename } from "node:path";
import type { SpellDefinition } from "../types/spell.js";
import type { CoverageItem, CoverageResult } from "../types/coverage.js";
import type { LLMClient } from "./llm-client.js";

export interface ProvidedInput {
  key: string; // key=val from CLI or auto-detected filename
  value: string; // file path or literal value
}

// Parse a tool URI like "mcp://filesystem/read_file" -> "filesystem/read_file"
export function parseToolUri(uri: string): string {
  if (uri.startsWith("mcp://")) {
    return uri.slice("mcp://".length);
  }
  return uri;
}

// Match an input requirement against provided inputs by format/extension
function matchInput(
  requirement: { id: string; description: string; formats: string[] },
  inputs: ProvidedInput[],
): { path: string; confidence: number } | null {
  // First: exact key match
  const exactMatch = inputs.find((i) => i.key === requirement.id);
  if (exactMatch) {
    return { path: exactMatch.value, confidence: 1.0 };
  }

  // Second: match by file extension against required formats
  for (const input of inputs) {
    const ext = extname(input.value).slice(1).toLowerCase(); // ".csv" -> "csv"
    if (ext && requirement.formats.includes(ext)) {
      return { path: input.value, confidence: 0.8 };
    }
  }

  // Third: check if any input key partially matches requirement id
  for (const input of inputs) {
    const keyLower = input.key.toLowerCase();
    const reqLower = requirement.id.toLowerCase().replace(/-/g, "");
    if (keyLower.includes(reqLower) || reqLower.includes(keyLower)) {
      return { path: input.value, confidence: 0.6 };
    }
  }

  return null;
}

// LLM-based semantic matching: ask the LLM if an input satisfies a requirement
async function matchInputSemantic(
  requirement: { id: string; description: string; formats: string[] },
  inputs: ProvidedInput[],
  llmClient: LLMClient,
): Promise<{ path: string; confidence: number } | null> {
  for (const input of inputs) {
    const filename = basename(input.value);
    const prompt = [
      "Does this input file satisfy the given requirement?",
      `Input: "${filename}"`,
      `Requirement ID: "${requirement.id}"`,
      `Requirement description: "${requirement.description}"`,
      `Required formats: ${requirement.formats.join(", ")}`,
      "",
      "Reply with JSON only: { \"match\": true/false, \"confidence\": 0.0-1.0 }",
    ].join("\n");

    try {
      const response = await llmClient.sendMessage({
        systemPrompt: "You are a precise input-matching assistant. Respond only with valid JSON.",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 100,
      });

      const text = response.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");

      // Extract JSON from response
      const jsonMatch = text.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.match && typeof parsed.confidence === "number" && parsed.confidence > 0.6) {
          return { path: input.value, confidence: parsed.confidence };
        }
      }
    } catch {
      // LLM call failed, skip semantic matching for this input
    }
  }

  return null;
}

export function analyzeCoverage(
  spell: SpellDefinition,
  availableTools: Set<string>,
  providedInputs: ProvidedInput[],
): CoverageResult {
  const items: CoverageItem[] = [];
  const warnings: string[] = [];

  // 1. Check tool requirements
  for (const toolReq of spell.requires.tools) {
    const toolName = parseToolUri(toolReq.uri);
    const isRequired = !toolReq.optional;

    if (availableTools.has(toolName)) {
      items.push({
        id: toolName,
        type: "tool",
        requirement: toolReq.reason || toolReq.uri,
        status: "matched",
        matchedTo: toolName,
        confidence: 1.0,
        required: isRequired,
      });
    } else {
      items.push({
        id: toolName,
        type: "tool",
        requirement: toolReq.reason || toolReq.uri,
        status: "missing",
        confidence: 0,
        required: isRequired,
      });
      if (!isRequired) {
        warnings.push(`Optional tool "${toolName}" is not available but would improve results.`);
      }
    }
  }

  // 2. Check required inputs
  for (const inputReq of spell.inputs.required) {
    const match = matchInput(inputReq, providedInputs);
    if (match && match.confidence > 0.5) {
      items.push({
        id: inputReq.id,
        type: "input",
        requirement: inputReq.description,
        status: "matched",
        matchedTo: match.path,
        confidence: match.confidence,
        required: true,
      });
    } else {
      items.push({
        id: inputReq.id,
        type: "input",
        requirement: inputReq.description,
        status: "missing",
        confidence: 0,
        required: true,
      });
    }
  }

  // 3. Check optional inputs
  for (const inputReq of spell.inputs.optional) {
    const match = matchInput(inputReq, providedInputs);
    items.push({
      id: inputReq.id,
      type: "input",
      requirement: inputReq.description,
      status: match ? "matched" : "missing",
      matchedTo: match?.path,
      confidence: match?.confidence || 0,
      required: false,
    });
  }

  // 4. Check catalysts (always required — they ship with the spell)
  for (const catalyst of spell.catalysts) {
    // Catalysts are always treated as available since they're bundled with the spell.
    // During actual casting, the resolver will fetch them from the registry/cache.
    items.push({
      id: catalyst.id,
      type: "catalyst",
      requirement: catalyst.description,
      status: "matched",
      matchedTo: catalyst.uri,
      confidence: 1.0,
      required: true,
    });
  }

  // 5. Calculate score (required items weighted 3x)
  const matchedRequired = items.filter(
    (i) => i.required && i.status === "matched",
  ).length;
  const totalRequired = items.filter((i) => i.required).length;
  const matchedOptional = items.filter(
    (i) => !i.required && i.status === "matched",
  ).length;
  const totalOptional = items.filter((i) => !i.required).length;

  const totalWeight = totalRequired * 3 + totalOptional;
  const score =
    totalWeight > 0
      ? ((matchedRequired * 3 + matchedOptional) / totalWeight) * 100
      : 100;

  const canCast = items.filter((i) => i.required && i.status === "missing").length === 0;

  const missingRequired = items.filter((i) => i.required && i.status === "missing");
  const missingOptional = items.filter((i) => !i.required && i.status === "missing");

  return {
    spellName: spell.name,
    spellVersion: spell.version,
    score: Math.round(score * 10) / 10,
    canCast,
    items,
    missingRequired,
    missingOptional,
    warnings,
  };
}

// Async variant with optional LLM-based semantic matching fallback.
// When llmClient is provided and basic matching fails for an input,
// the LLM is asked whether the input semantically satisfies the requirement.
export async function analyzeCoverageAsync(
  spell: SpellDefinition,
  availableTools: Set<string>,
  providedInputs: ProvidedInput[],
  llmClient: LLMClient,
): Promise<CoverageResult> {
  // Start with basic analysis
  const result = analyzeCoverage(spell, availableTools, providedInputs);

  // For any missing input items, try LLM-based semantic matching
  for (const item of result.items) {
    if (item.type === "input" && item.status === "missing") {
      const requirement = [
        ...spell.inputs.required,
        ...spell.inputs.optional,
      ].find((i) => i.id === item.id);

      if (!requirement) continue;

      const semanticMatch = await matchInputSemantic(requirement, providedInputs, llmClient);
      if (semanticMatch) {
        item.status = "matched";
        item.matchedTo = semanticMatch.path;
        item.confidence = semanticMatch.confidence;
      }
    }
  }

  // Recalculate score
  const matchedRequired = result.items.filter(
    (i) => i.required && i.status === "matched",
  ).length;
  const totalRequired = result.items.filter((i) => i.required).length;
  const matchedOptional = result.items.filter(
    (i) => !i.required && i.status === "matched",
  ).length;
  const totalOptional = result.items.filter((i) => !i.required).length;

  const totalWeight = totalRequired * 3 + totalOptional;
  result.score = totalWeight > 0
    ? Math.round(((matchedRequired * 3 + matchedOptional) / totalWeight) * 1000) / 10
    : 100;

  result.canCast = result.items.filter((i) => i.required && i.status === "missing").length === 0;
  result.missingRequired = result.items.filter((i) => i.required && i.status === "missing");
  result.missingOptional = result.items.filter((i) => !i.required && i.status === "missing");

  return result;
}
