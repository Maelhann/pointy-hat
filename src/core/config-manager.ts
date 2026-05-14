import { join } from "node:path";
import {
  UserConfigSchema,
  ProjectConfigSchema,
  getDefaultUserConfig,
  getDefaultProjectConfig,
  type UserConfig,
  type ProjectConfig,
  type ProviderConfig,
  type ProviderId,
  PROVIDER_IDS,
} from "../types/config.js";
import { fileExists, getConfigDir } from "../utils/fs.js";
import { readYamlFile, writeYamlFile } from "../utils/yaml.js";
import { E_CONFIG_MALFORMED } from "./error-handler.js";

export class ConfigManager {
  private userConfigPath: string;
  private projectConfigPath: string | null = null;
  private projectDir: string | null = null;

  constructor(projectConfigPath?: string) {
    this.userConfigPath = join(getConfigDir(), "config.yaml");
    if (projectConfigPath) {
      this.projectConfigPath = projectConfigPath;
    }
  }

  // Discover project config by walking up from cwd
  async discoverProjectConfig(): Promise<void> {
    const { findUpward } = await import("../utils/fs.js");
    const found = await findUpward("pointyhat.yaml");
    if (found) {
      this.projectConfigPath = found;
      const { dirname } = await import("node:path");
      this.projectDir = dirname(found);
    }
  }

  getProjectDir(): string | null {
    return this.projectDir;
  }

  hasProjectConfig(): boolean {
    return this.projectConfigPath !== null;
  }

  // ── User config ──

  async loadUserConfig(): Promise<UserConfig> {
    const exists = await fileExists(this.userConfigPath);
    if (!exists) {
      const defaults = getDefaultUserConfig();
      await this.saveUserConfig(defaults);
      return defaults;
    }

    try {
      const raw = await readYamlFile<unknown>(this.userConfigPath);
      const parsed = UserConfigSchema.safeParse(raw);
      if (!parsed.success) {
        throw E_CONFIG_MALFORMED(
          this.userConfigPath,
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof Error && err.name === "PointyHatError") throw err;
      throw E_CONFIG_MALFORMED(this.userConfigPath, String(err));
    }
  }

  async saveUserConfig(config: UserConfig): Promise<void> {
    await writeYamlFile(this.userConfigPath, config);
  }

  // ── Project config ──

  async loadProjectConfig(): Promise<ProjectConfig | null> {
    if (!this.projectConfigPath) {
      await this.discoverProjectConfig();
    }
    if (!this.projectConfigPath) return null;

    const exists = await fileExists(this.projectConfigPath);
    if (!exists) return null;

    try {
      const raw = await readYamlFile<unknown>(this.projectConfigPath);
      const parsed = ProjectConfigSchema.safeParse(raw);
      if (!parsed.success) {
        throw E_CONFIG_MALFORMED(
          this.projectConfigPath,
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof Error && err.name === "PointyHatError") throw err;
      throw E_CONFIG_MALFORMED(this.projectConfigPath!, String(err));
    }
  }

  async saveProjectConfig(
    config: ProjectConfig,
    path?: string,
  ): Promise<void> {
    const targetPath = path || this.projectConfigPath;
    if (!targetPath) {
      throw new Error("No project config path set. Run `pointyhat init` first.");
    }
    await writeYamlFile(targetPath, config);
    if (!this.projectConfigPath) {
      this.projectConfigPath = targetPath;
    }
  }

  // ── Dot-path access ──

  async get(key: string): Promise<unknown> {
    // Check project config first, then user config
    const project = await this.loadProjectConfig();
    if (project) {
      const val = getNestedValue(project, key);
      if (val !== undefined) return this.resolveValue(val);
    }

    const user = await this.loadUserConfig();
    const val = getNestedValue(user, key);
    return val !== undefined ? this.resolveValue(val) : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const config = await this.loadUserConfig();
    setNestedValue(config, key, value);
    await this.saveUserConfig(config);
  }

  async delete(key: string): Promise<void> {
    const config = await this.loadUserConfig();
    deleteNestedValue(config, key);
    await this.saveUserConfig(config);
  }

  async list(): Promise<Record<string, unknown>> {
    const user = await this.loadUserConfig();
    const project = await this.loadProjectConfig();
    const flat: Record<string, unknown> = {};
    flattenObject(user, "", flat);
    if (project) {
      flattenObject(project, "project.", flat);
    }
    return flat;
  }

  async reset(): Promise<void> {
    const defaults = getDefaultUserConfig();
    await this.saveUserConfig(defaults);
  }

  // ── Provider helpers ──

  async getDefaultProviderId(): Promise<ProviderId | null> {
    const config = await this.loadUserConfig();
    const id = config.provider?.default;
    if (id && PROVIDER_IDS.includes(id as ProviderId)) {
      return id as ProviderId;
    }
    // Auto-detect: return first provider that has config
    for (const pid of PROVIDER_IDS) {
      const provConf = config.provider?.[pid as keyof typeof config.provider];
      if (provConf && typeof provConf === "object") {
        return pid;
      }
    }
    return null;
  }

  async getProvider(id?: ProviderId): Promise<ProviderConfig | null> {
    const config = await this.loadUserConfig();
    const providerId = id || (await this.getDefaultProviderId());
    if (!providerId) return null;

    const providerSection = config.provider?.[providerId as keyof typeof config.provider];
    if (!providerSection || typeof providerSection !== "object") return null;

    const resolved: ProviderConfig = {
      ...(providerSection as ProviderConfig),
    };

    // Resolve env vars in api_key
    if (resolved.api_key) {
      resolved.api_key = this.resolveEnvVars(resolved.api_key);
    }
    if (resolved.base_url) {
      resolved.base_url = this.resolveEnvVars(resolved.base_url);
    }

    return resolved;
  }

  // ── Env var resolution ──

  resolveEnvVars(value: string): string {
    return value.replace(/\$\{env:([^}]+)\}/g, (_, varName: string) => {
      return process.env[varName] || "";
    });
  }

  private resolveValue(value: unknown): unknown {
    if (typeof value === "string") {
      return this.resolveEnvVars(value);
    }
    return value;
  }
}

// ── Helpers ──

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function deleteNestedValue(
  obj: Record<string, unknown>,
  path: string,
): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") return;
    current = current[part] as Record<string, unknown>;
  }
  delete current[parts[parts.length - 1]];
}

function flattenObject(
  obj: unknown,
  prefix: string,
  result: Record<string, unknown>,
): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj !== "object") {
    result[prefix.slice(0, -1)] = obj; // remove trailing dot
    return;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const newPrefix = prefix + key + ".";
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      flattenObject(value, newPrefix, result);
    } else {
      result[prefix + key] = value;
    }
  }
}
