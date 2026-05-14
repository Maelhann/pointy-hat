import { join } from "node:path";
import { readdir, rm } from "node:fs/promises";
import type { SpellDefinition } from "../types/spell.js";
import type { ConfigManager } from "./config-manager.js";
import type { RegistryClient } from "./registry-client.js";
import { SpellFileSchema } from "../types/spell.js";
import { scanSpell } from "./security-scanner.js";
import {
  parseLockfile,
  generateLockfile,
  createEmptyLockfile,
  updateLockEntry,
  removeLockEntry,
  computeIntegrity,
  type Lockfile,
} from "./lockfile.js";
import {
  fileExists,
  ensureDir,
  readFile,
  writeFile,
  getConfigDir,
} from "../utils/fs.js";
import { readYamlFile, stringifyYaml } from "../utils/yaml.js";

export interface InstalledSpell {
  name: string;
  version: string;
  description: string;
  installedAt: string;
  mcpDependencies: { name: string; installed: boolean }[];
}

export interface SyncResult {
  added: string[];
  removed: string[];
  updated: string[];
  unchanged: string[];
}

export interface DependencyCheck {
  satisfied: string[];
  missing: string[];
  optional: string[];
}

export class SpellbookManager {
  private configManager: ConfigManager;
  private registryClient: RegistryClient;

  constructor(configManager: ConfigManager, registryClient: RegistryClient) {
    this.configManager = configManager;
    this.registryClient = registryClient;
  }

  private getSpellbookDir(): string {
    return join(getConfigDir(), "spellbook");
  }

  private getSpellDir(name: string, version: string): string {
    return join(this.getSpellbookDir(), name, version);
  }

  private getSpellPath(name: string, version: string): string {
    return join(this.getSpellDir(name, version), "spell.yaml");
  }

  async add(name: string, version?: string): Promise<SpellDefinition> {
    // 1. Query registry for spell
    const spellDetail = await this.registryClient.getSpell(name, version);
    const resolvedVersion = spellDetail.version;

    // 2. Build SpellDefinition from registry data
    const spellDef: SpellDefinition = {
      name: spellDetail.name,
      version: spellDetail.version,
      description: spellDetail.description ?? "",
      author: spellDetail.author ?? "unknown",
      license: spellDetail.license,
      tags: spellDetail.tags ?? [],
      card: spellDetail.card,
      inputs: spellDetail.inputs ?? { required: [], optional: [] },
      catalysts: spellDetail.catalysts?.map((c) => ({ id: c.id, description: c.description, uri: `catalyst://${spellDetail.name}/${c.id}`, type: c.type })) ?? [],
      requires: spellDetail.requires ?? { tools: [], resources: [] },
      steps: spellDetail.steps ?? [],
      outputs: spellDetail.outputs ?? [],
      effects: spellDetail.effects ?? [],
      metadata: (spellDetail.metadata as Record<string, unknown>) ?? {},
    };

    // 3. Run security scan
    const findings = scanSpell(spellDef);
    const errors = findings.filter((f) => f.severity === "error");
    if (errors.length > 0) {
      throw new Error(
        `Security scan found ${errors.length} error(s) in spell "${name}". Use --force to override.`,
      );
    }

    // 4. Store in ~/.pointyhat/spellbook/{name}/{version}/spell.yaml
    const yamlContent = stringifyYaml({ spell: spellDef });
    const spellPath = this.getSpellPath(name, resolvedVersion);
    await ensureDir(this.getSpellDir(name, resolvedVersion));
    await writeFile(spellPath, yamlContent);

    // 5. Write metadata file
    await writeFile(
      join(this.getSpellDir(name, resolvedVersion), "metadata.json"),
      JSON.stringify({ installedAt: new Date().toISOString() }),
    );

    // 6. Update pointyhat.yaml spells section
    await this.updateProjectConfigSpell(name, `^${resolvedVersion}`);

    // 7. Update pointyhat.lock with integrity hash
    const integrity = computeIntegrity(yamlContent);
    const requiredMcps = this.extractRequiredMcps(spellDef);
    await this.updateLockSpell(name, {
      version: resolvedVersion,
      resolved: `${this.registryClient["baseUrl"]}/v1/spells/${encodeURIComponent(name)}/${resolvedVersion}`,
      integrity,
      requiredMcps,
    });

    return spellDef;
  }

  async remove(name: string): Promise<void> {
    // 1. Find and delete from ~/.pointyhat/spellbook/{name}/
    const spellDir = join(this.getSpellbookDir(), name);
    if (await fileExists(spellDir)) {
      await rm(spellDir, { recursive: true, force: true });
    }

    // 2. Remove from pointyhat.yaml spells section
    await this.removeProjectConfigSpell(name);

    // 3. Remove from pointyhat.lock
    await this.removeLockSpell(name);
  }

  async list(): Promise<InstalledSpell[]> {
    const spellbookDir = this.getSpellbookDir();
    if (!(await fileExists(spellbookDir))) return [];

    const installed: InstalledSpell[] = [];

    let entries: string[];
    try {
      const dirEntries = await readdir(spellbookDir, { withFileTypes: true });
      entries = dirEntries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }

    for (const spellName of entries) {
      const spellNameDir = join(spellbookDir, spellName);
      let versionDirs: string[];
      try {
        const vEntries = await readdir(spellNameDir, { withFileTypes: true });
        versionDirs = vEntries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        continue;
      }

      for (const version of versionDirs) {
        const spellPath = this.getSpellPath(spellName, version);
        if (!(await fileExists(spellPath))) continue;

        try {
          const raw = await readYamlFile<unknown>(spellPath);
          const parsed = SpellFileSchema.safeParse(raw);
          if (!parsed.success) continue;

          const spell = parsed.data.spell;
          const mcpDeps = this.extractRequiredMcps(spell);

          // Check which MCP deps are installed
          const lockfile = await this.loadLockfile();
          const depStatus = mcpDeps.map((dep) => ({
            name: dep,
            installed: lockfile ? dep in lockfile.mcps : false,
          }));

          // Read metadata
          let installedAt = "";
          const metaPath = join(this.getSpellDir(spellName, version), "metadata.json");
          try {
            const metaContent = await readFile(metaPath);
            const meta = JSON.parse(metaContent);
            installedAt = meta.installedAt || "";
          } catch {
            // No metadata
          }

          installed.push({
            name: spell.name,
            version: spell.version,
            description: spell.description,
            installedAt,
            mcpDependencies: depStatus,
          });
        } catch {
          // Skip malformed spells
        }
      }
    }

    return installed;
  }

  async get(name: string): Promise<SpellDefinition | null> {
    const spellbookDir = join(this.getSpellbookDir(), name);
    if (!(await fileExists(spellbookDir))) return null;

    // Get latest version
    let versionDirs: string[];
    try {
      const entries = await readdir(spellbookDir, { withFileTypes: true });
      versionDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return null;
    }

    if (versionDirs.length === 0) return null;

    // Sort versions descending and take the latest
    versionDirs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const latestVersion = versionDirs[0];

    const spellPath = this.getSpellPath(name, latestVersion);
    if (!(await fileExists(spellPath))) return null;

    try {
      const raw = await readYamlFile<unknown>(spellPath);
      const parsed = SpellFileSchema.safeParse(raw);
      if (!parsed.success) return null;
      return parsed.data.spell;
    } catch {
      return null;
    }
  }

  async sync(dryRun = false): Promise<SyncResult> {
    const result: SyncResult = { added: [], removed: [], updated: [], unchanged: [] };

    const lockfile = await this.loadLockfile();
    if (!lockfile) return result;

    const spellEntries = lockfile.spells;

    for (const [name, entry] of Object.entries(spellEntries)) {
      const spellPath = this.getSpellPath(name, entry.version);

      if (await fileExists(spellPath)) {
        result.unchanged.push(name);
      } else {
        // Missing from spellbook — need to download
        if (!dryRun) {
          try {
            await this.add(name, entry.version);
            result.added.push(name);
          } catch {
            // Failed to sync this spell
          }
        } else {
          result.added.push(name);
        }
      }
    }

    // Check for spells in spellbook not in lockfile (orphaned)
    const spellbookDir = this.getSpellbookDir();
    if (await fileExists(spellbookDir)) {
      try {
        const dirEntries = await readdir(spellbookDir, { withFileTypes: true });
        const spellNames = dirEntries.filter((e) => e.isDirectory()).map((e) => e.name);

        for (const spellName of spellNames) {
          if (!(spellName in spellEntries)) {
            if (!dryRun) {
              await rm(join(spellbookDir, spellName), { recursive: true, force: true });
            }
            result.removed.push(spellName);
          }
        }
      } catch {
        // Can't list spellbook
      }
    }

    return result;
  }

  async checkDependencies(spell: SpellDefinition): Promise<DependencyCheck> {
    const lockfile = await this.loadLockfile();
    const check: DependencyCheck = { satisfied: [], missing: [], optional: [] };

    for (const tool of spell.requires.tools) {
      // Extract server name from "mcp://server/tool_name"
      const match = tool.uri.match(/^mcp:\/\/([^/]+)/);
      if (!match) continue;

      const serverName = match[1];
      const isInstalled = lockfile ? serverName in lockfile.mcps ||
        Object.keys(lockfile.mcps).some((k) => k.endsWith(`/${serverName}`) || k.includes(serverName)) : false;

      if (tool.optional) {
        if (isInstalled) {
          check.satisfied.push(serverName);
        } else {
          check.optional.push(serverName);
        }
      } else {
        if (isInstalled) {
          check.satisfied.push(serverName);
        } else {
          check.missing.push(serverName);
        }
      }
    }

    // Deduplicate
    check.satisfied = [...new Set(check.satisfied)];
    check.missing = [...new Set(check.missing)];
    check.optional = [...new Set(check.optional)];

    return check;
  }

  // -- Helpers --

  private extractRequiredMcps(spell: SpellDefinition): string[] {
    const mcps = new Set<string>();
    for (const tool of spell.requires.tools) {
      const match = tool.uri.match(/^mcp:\/\/([^/]+)/);
      if (match) mcps.add(match[1]);
    }
    return [...mcps];
  }

  private async loadLockfile(): Promise<Lockfile | null> {
    const projectDir = this.configManager.getProjectDir() || process.cwd();
    const lockPath = join(projectDir, "pointyhat.lock");
    return parseLockfile(lockPath);
  }

  private async updateProjectConfigSpell(name: string, versionRange: string): Promise<void> {
    const config = await this.configManager.loadProjectConfig();
    if (!config) return; // No project config, skip

    if (!config.spells) {
      config.spells = {};
    }
    config.spells[name] = { version: versionRange };
    await this.configManager.saveProjectConfig(config);
  }

  private async removeProjectConfigSpell(name: string): Promise<void> {
    const config = await this.configManager.loadProjectConfig();
    if (!config) return;

    if (config.spells && name in config.spells) {
      delete config.spells[name];
      await this.configManager.saveProjectConfig(config);
    }
  }

  private async updateLockSpell(
    name: string,
    entry: { version: string; resolved: string; integrity: string; requiredMcps: string[] },
  ): Promise<void> {
    const projectDir = this.configManager.getProjectDir() || process.cwd();
    const lockPath = join(projectDir, "pointyhat.lock");

    let lockfile = await parseLockfile(lockPath);
    if (!lockfile) lockfile = createEmptyLockfile();

    // Assign directly to spells section (supports requiredMcps extension)
    lockfile.spells[name] = {
      version: entry.version,
      resolved: entry.resolved,
      integrity: entry.integrity,
      requiredMcps: entry.requiredMcps,
    };
    lockfile.generatedAt = new Date().toISOString();

    await generateLockfile(lockPath, lockfile);
  }

  private async removeLockSpell(name: string): Promise<void> {
    const projectDir = this.configManager.getProjectDir() || process.cwd();
    const lockPath = join(projectDir, "pointyhat.lock");

    const lockfile = await parseLockfile(lockPath);
    if (!lockfile) return;

    removeLockEntry(lockfile, "spells", name);
    await generateLockfile(lockPath, lockfile);
  }
}
