import { z } from "zod";
import type { SpellDefinition, SpellOutput, QualityCheck } from "../types/spell.js";
import { QualityCheckSchema } from "../types/spell.js";
import type { RegistryClient } from "./registry-client.js";
import { Cache } from "./cache.js";
import { E_SPELL_INVALID } from "./error-handler.js";
import { parseYaml } from "../utils/yaml.js";

// Inline section definition — parsed from YAML between markers
export interface ArtifactSection {
  prompt: string;
  quality_check?: QualityCheck;
}

export interface ResolvedArtifact {
  templateContent: string;
  sections: Map<string, ArtifactSection>;
  sectionOrder: string[]; // IDs in document order
}

export interface TemplateMarker {
  id: string;
  startLine: number;
  endLine: number;
}

const ArtifactSectionSchema = z.object({
  prompt: z.string(),
  quality_check: QualityCheckSchema.optional(),
});

const BEGIN_PATTERN = /@begin:([a-zA-Z0-9_-]+)/;
const END_PATTERN = /@end:([a-zA-Z0-9_-]+)/;

/**
 * Parse template content to extract section markers in document order.
 */
export function parseTemplateMarkers(content: string): TemplateMarker[] {
  const lines = content.split("\n");
  const markers: TemplateMarker[] = [];
  const openMarkers = new Map<string, number>(); // id -> startLine

  for (let i = 0; i < lines.length; i++) {
    const beginMatch = lines[i].match(BEGIN_PATTERN);
    if (beginMatch) {
      const id = beginMatch[1];
      if (openMarkers.has(id)) {
        throw E_SPELL_INVALID(`Duplicate @begin:${id} at line ${i + 1} — previous @begin:${id} at line ${openMarkers.get(id)! + 1} was not closed`);
      }
      openMarkers.set(id, i);
      continue;
    }

    const endMatch = lines[i].match(END_PATTERN);
    if (endMatch) {
      const id = endMatch[1];
      const startLine = openMarkers.get(id);
      if (startLine === undefined) {
        throw E_SPELL_INVALID(`@end:${id} at line ${i + 1} has no matching @begin:${id}`);
      }
      markers.push({ id, startLine, endLine: i });
      openMarkers.delete(id);
    }
  }

  // Check for unclosed markers
  for (const [id, line] of openMarkers) {
    throw E_SPELL_INVALID(`@begin:${id} at line ${line + 1} has no matching @end:${id}`);
  }

  return markers;
}

/**
 * Parse the inline YAML content between a marker pair to extract the section definition.
 * Content between @begin:ID and @end:ID is YAML with `prompt` and optional `quality_check`.
 */
export function parseSectionContent(sectionId: string, rawContent: string): ArtifactSection {
  const trimmed = rawContent.trim();
  if (!trimmed) {
    throw E_SPELL_INVALID(`Section "${sectionId}" is empty — must contain at least a "prompt" field`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml<unknown>(trimmed);
  } catch (err) {
    throw E_SPELL_INVALID(`Section "${sectionId}" contains invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }

  const result = ArtifactSectionSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw E_SPELL_INVALID(`Section "${sectionId}" has invalid structure: ${issues}`);
  }

  return result.data;
}

/**
 * Parse a complete artifact template file.
 * Extracts markers and parses the inline YAML between each marker pair.
 * Returns sections in document order.
 */
export function parseArtifactTemplate(content: string): { sections: Map<string, ArtifactSection>; sectionOrder: string[] } {
  const markers = parseTemplateMarkers(content);
  const lines = content.split("\n");
  const sections = new Map<string, ArtifactSection>();
  const sectionOrder: string[] = [];

  for (const marker of markers) {
    // Extract raw content between @begin and @end lines (exclusive of marker lines)
    const sectionLines = lines.slice(marker.startLine + 1, marker.endLine);
    const rawContent = sectionLines.join("\n");
    const section = parseSectionContent(marker.id, rawContent);
    sections.set(marker.id, section);
    sectionOrder.push(marker.id);
  }

  return { sections, sectionOrder };
}

/**
 * Assemble a filled artifact from template + filled sections.
 * Replaces content between markers with filled content.
 * By default strips the marker lines themselves.
 */
export function assembleArtifact(
  templateContent: string,
  filledSections: Map<string, string>,
  stripMarkers = true,
): string {
  const lines = templateContent.split("\n");
  const markers = parseTemplateMarkers(templateContent);

  // Process from bottom to top so line indices stay valid
  const sortedMarkers = [...markers].sort((a, b) => b.startLine - a.startLine);

  for (const marker of sortedMarkers) {
    const filled = filledSections.get(marker.id) ?? "";
    const filledLines = filled.split("\n");

    if (stripMarkers) {
      // Replace from startLine (the @begin line) through endLine (the @end line)
      lines.splice(marker.startLine, marker.endLine - marker.startLine + 1, ...filledLines);
    } else {
      // Keep marker lines, replace only the content between them
      lines.splice(marker.startLine + 1, marker.endLine - marker.startLine - 1, ...filledLines);
    }
  }

  return lines.join("\n");
}

/**
 * Resolve an artifact template for an output.
 * Fetches the single template file from cache or registry, then parses inline sections.
 */
export async function resolveArtifact(
  spell: SpellDefinition,
  output: SpellOutput,
  registryClient: RegistryClient,
  cache?: Cache,
): Promise<ResolvedArtifact> {
  if (!output.artifact) {
    throw E_SPELL_INVALID(`Output "${output.id}" has no artifact template`);
  }

  const templateContent = await resolveArtifactFile(
    spell.name,
    spell.version,
    output.id,
    output.artifact,
    registryClient,
    cache,
  );

  // Parse the template to extract inline section definitions
  const { sections, sectionOrder } = parseArtifactTemplate(templateContent);

  return { templateContent, sections, sectionOrder };
}

async function resolveArtifactFile(
  spellName: string,
  spellVersion: string,
  outputId: string,
  uri: string,
  registryClient: RegistryClient,
  cache?: Cache,
): Promise<string> {
  const cacheKey = `artifact_${spellName}_${spellVersion}_${outputId}`;

  if (cache) {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  }

  // Extract filename from URI: artifact://spell-name/filename
  const match = uri.match(/^artifact:\/\/[^/]+\/(.+)$/);
  if (!match) {
    throw E_SPELL_INVALID(`Invalid artifact URI: "${uri}". Expected format: artifact://spell-name/filename`);
  }

  const filename = match[1];
  const content = await registryClient.fetchArtifact(spellName, spellVersion, outputId, filename);

  if (cache) {
    await cache.set(cacheKey, content, 86400); // 24h TTL
  }

  return content;
}
