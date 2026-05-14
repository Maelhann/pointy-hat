import { readYamlFile, writeYamlFile } from "../utils/yaml.js";
import { fileExists } from "../utils/fs.js";
import { createHash } from "node:crypto";
import type { ProjectConfig } from "../types/config.js";

export interface LockfileEntry {
  version: string;
  resolved: string;
  integrity: string;
  transport?: string;
  command?: string;
  args?: string[];
  platforms?: Record<string, { configPath: string }>;
}

export interface Lockfile {
  lockfileVersion: number;
  generatedAt: string;
  mcps: Record<string, LockfileEntry>;
  spells: Record<string, LockfileEntry & { requiredMcps?: string[] }>;
}

export interface LockfileDiff {
  added: { type: "mcps" | "spells"; name: string; version: string }[];
  removed: { type: "mcps" | "spells"; name: string; version: string }[];
  updated: { type: "mcps" | "spells"; name: string; from: string; to: string }[];
  unchanged: { type: "mcps" | "spells"; name: string; version: string }[];
}

export async function parseLockfile(path: string): Promise<Lockfile | null> {
  if (!(await fileExists(path))) return null;
  return readYamlFile<Lockfile>(path);
}

export async function generateLockfile(path: string, data: Lockfile): Promise<void> {
  data.generatedAt = new Date().toISOString();
  await writeYamlFile(path, data);
}

export function createEmptyLockfile(): Lockfile {
  return {
    lockfileVersion: 1,
    generatedAt: new Date().toISOString(),
    mcps: {},
    spells: {},
  };
}

export function updateLockEntry(
  lockfile: Lockfile,
  type: "mcps" | "spells",
  name: string,
  entry: LockfileEntry,
): Lockfile {
  lockfile[type][name] = entry;
  lockfile.generatedAt = new Date().toISOString();
  return lockfile;
}

export function removeLockEntry(
  lockfile: Lockfile,
  type: "mcps" | "spells",
  name: string,
): Lockfile {
  delete lockfile[type][name];
  lockfile.generatedAt = new Date().toISOString();
  return lockfile;
}

export function diffLockfile(current: Lockfile, incoming: Lockfile): LockfileDiff {
  const diff: LockfileDiff = { added: [], removed: [], updated: [], unchanged: [] };

  for (const type of ["mcps", "spells"] as const) {
    const currentEntries = current[type];
    const incomingEntries = incoming[type];

    // Check for added and updated
    for (const [name, entry] of Object.entries(incomingEntries)) {
      if (!(name in currentEntries)) {
        diff.added.push({ type, name, version: entry.version });
      } else if (currentEntries[name].version !== entry.version) {
        diff.updated.push({
          type,
          name,
          from: currentEntries[name].version,
          to: entry.version,
        });
      } else {
        diff.unchanged.push({ type, name, version: entry.version });
      }
    }

    // Check for removed
    for (const name of Object.keys(currentEntries)) {
      if (!(name in incomingEntries)) {
        diff.removed.push({ type, name, version: currentEntries[name].version });
      }
    }
  }

  return diff;
}

export function validateLockIntegrity(lockfile: Lockfile): {
  valid: boolean;
  failures: { type: string; name: string; expected: string; actual: string }[];
} {
  const failures: { type: string; name: string; expected: string; actual: string }[] = [];

  for (const type of ["mcps", "spells"] as const) {
    for (const [name, entry] of Object.entries(lockfile[type])) {
      if (!entry.integrity) continue;

      // Integrity format: sha512-<base64> or just a hash string
      // We can only validate if we have the resolved content — for now just check format
      const isValidFormat =
        entry.integrity.startsWith("sha512-") ||
        entry.integrity.startsWith("sha256-") ||
        /^[a-f0-9]{64,128}$/.test(entry.integrity);

      if (!isValidFormat) {
        failures.push({
          type,
          name,
          expected: "valid integrity hash format",
          actual: entry.integrity,
        });
      }
    }
  }

  return { valid: failures.length === 0, failures };
}

export function syncWithYaml(
  lockfile: Lockfile,
  projectConfig: ProjectConfig,
): { toAdd: string[]; toRemove: string[] } {
  const toAdd: string[] = [];
  const toRemove: string[] = [];

  // MCPs declared in yaml but missing from lock
  for (const name of Object.keys(projectConfig.mcps)) {
    if (!(name in lockfile.mcps)) {
      toAdd.push(name);
    }
  }

  // MCPs in lock but not in yaml
  for (const name of Object.keys(lockfile.mcps)) {
    if (!(name in projectConfig.mcps)) {
      toRemove.push(name);
    }
  }

  // Same for spells
  for (const name of Object.keys(projectConfig.spells)) {
    if (!(name in lockfile.spells)) {
      toAdd.push(name);
    }
  }

  for (const name of Object.keys(lockfile.spells)) {
    if (!(name in projectConfig.spells)) {
      toRemove.push(name);
    }
  }

  return { toAdd, toRemove };
}

export function computeIntegrity(content: string): string {
  const hash = createHash("sha512").update(content).digest("base64");
  return `sha512-${hash}`;
}
