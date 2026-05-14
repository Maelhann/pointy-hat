export const PLATFORM_IDS = [
  "claude-desktop",
  "claude-code",
  "cursor",
  "windsurf",
  "vscode-continue",
  "vscode-copilot",
  "custom",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export type PlatformStatus = "ok" | "missing-config" | "not-detected" | "error";

export type PlatformConfigFormat = "json" | "jsonc" | "yaml";

export interface PlatformInfo {
  id: PlatformId;
  name: string;
  status: PlatformStatus;
  configPath?: string;
  version?: string;
  error?: string;
}

export interface PlatformSpec {
  id: PlatformId;
  name: string;
  configPaths: {
    darwin?: string[];
    win32?: string[];
    linux?: string[];
  };
  configFormat: PlatformConfigFormat;
  configKey: string; // e.g. "mcpServers"
  binaryNames: string[];
  knownInstallPaths?: {
    darwin?: string[];
    win32?: string[];
    linux?: string[];
  };
}

export interface DetectionResult {
  platforms: PlatformInfo[];
  detectedCount: number;
  primaryPlatform?: PlatformId;
}

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}
