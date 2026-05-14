import { z } from "zod";
import { join } from "node:path";
import { homedir } from "node:os";

// Valid LLM provider identifiers
export const PROVIDER_IDS = ["anthropic", "openai", "google", "ollama"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

// Default constants
export const DEFAULT_REGISTRY_URL = "https://api.pointyhat.org";
export const DEFAULT_CONFIG_DIR = join(homedir(), ".pointyhat");
export const DEFAULT_CACHE_DIR = join(DEFAULT_CONFIG_DIR, "cache");
export const DEFAULT_CACHE_TTL = 3600;
export const DEFAULT_CACHE_MAX_SIZE = 100; // MB

// Per-provider config schema
export const ProviderConfigSchema = z.object({
  api_key: z.string().optional(),
  model: z.string(),
  base_url: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// User-level config (~/.pointyhat/config.yaml)
export const UserConfigSchema = z.object({
  auth: z
    .object({
      email: z.string().optional(),
      method: z.string().optional(),
    })
    .optional(),

  provider: z
    .object({
      default: z.string().optional(),
      anthropic: ProviderConfigSchema.optional(),
      openai: ProviderConfigSchema.optional(),
      google: ProviderConfigSchema.optional(),
      ollama: ProviderConfigSchema.optional(),
    })
    .optional(),

  registry: z
    .object({
      url: z.string().default(DEFAULT_REGISTRY_URL),
      timeout: z.number().default(30000),
    })
    .optional(),

  defaults: z
    .object({
      platform: z.string().default("auto"),
      output_format: z.enum(["human", "json"]).default("human"),
      confirm_installs: z.boolean().default(true),
    })
    .optional(),

  telemetry: z
    .object({
      enabled: z.boolean().default(false),
    })
    .optional(),

  cache: z
    .object({
      ttl: z.number().default(DEFAULT_CACHE_TTL),
      maxSize: z.number().default(DEFAULT_CACHE_MAX_SIZE),
      directory: z.string().default(DEFAULT_CACHE_DIR),
    })
    .optional(),
});
export type UserConfig = z.infer<typeof UserConfigSchema>;

// MCP entry in project config
export const McpEntrySchema = z.object({
  version: z.string(),
  env: z.record(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
});
export type McpEntry = z.infer<typeof McpEntrySchema>;

// Spell entry in project config
export const SpellEntrySchema = z.object({
  version: z.string(),
});

// Project-level config (pointyhat.yaml)
export const ProjectConfigSchema = z.object({
  registry: z.string().default(DEFAULT_REGISTRY_URL),
  platforms: z.array(z.string()).default([]),
  mcps: z.record(McpEntrySchema).default({}),
  spells: z.record(SpellEntrySchema).default({}),
  defaults: z
    .object({
      platform: z.string().optional(),
      output_format: z.enum(["human", "json"]).optional(),
    })
    .optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// Returns a sensible default user config
export function getDefaultUserConfig(): UserConfig {
  return {
    provider: {
      default: undefined,
    },
    registry: {
      url: DEFAULT_REGISTRY_URL,
      timeout: 30000,
    },
    defaults: {
      platform: "auto",
      output_format: "human",
      confirm_installs: true,
    },
    telemetry: {
      enabled: false,
    },
    cache: {
      ttl: DEFAULT_CACHE_TTL,
      maxSize: DEFAULT_CACHE_MAX_SIZE,
      directory: DEFAULT_CACHE_DIR,
    },
  };
}

// Returns a sensible default project config
export function getDefaultProjectConfig(): ProjectConfig {
  return {
    registry: DEFAULT_REGISTRY_URL,
    platforms: [],
    mcps: {},
    spells: {},
  };
}
