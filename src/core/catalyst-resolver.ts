import { join } from "node:path";
import type { SpellDefinition, SpellCatalyst } from "../types/spell.js";
import type { RegistryClient } from "./registry-client.js";
import { Cache } from "./cache.js";
import { computeSha512, verifyIntegrity } from "../utils/hash.js";
import { fileExists, readFile, writeFile, getCacheDir } from "../utils/fs.js";

export interface ResolvedCatalyst {
  id: string;
  description: string;
  type: string;
  content: string;
}

/**
 * Resolve all catalysts for a spell.
 * Checks local cache first, then fetches from the registry.
 */
export async function resolveCatalysts(
  spell: SpellDefinition,
  registryClient: RegistryClient,
  cache?: Cache,
): Promise<Map<string, ResolvedCatalyst>> {
  const resolved = new Map<string, ResolvedCatalyst>();

  if (!spell.catalysts || spell.catalysts.length === 0) {
    return resolved;
  }

  for (const catalyst of spell.catalysts) {
    const content = await resolveSingleCatalyst(
      spell.name,
      spell.version,
      catalyst,
      registryClient,
      cache,
    );

    resolved.set(catalyst.id, {
      id: catalyst.id,
      description: catalyst.description,
      type: catalyst.type,
      content,
    });
  }

  return resolved;
}

async function resolveSingleCatalyst(
  spellName: string,
  spellVersion: string,
  catalyst: SpellCatalyst,
  registryClient: RegistryClient,
  cache?: Cache,
): Promise<string> {
  // Check local cache
  const cacheKey = `catalysts_${spellName}_${spellVersion}_${catalyst.id}`;

  if (cache) {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  }

  // Fetch from registry
  const content = await registryClient.fetchCatalyst(
    spellName,
    spellVersion,
    catalyst.id,
  );

  // Cache the result
  if (cache) {
    await cache.set(cacheKey, content, 86400); // 24h TTL
  }

  return content;
}
