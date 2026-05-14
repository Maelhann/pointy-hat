import type { PlatformId, PlatformConfigFormat, PlatformInfo, McpServerEntry } from "../types/platform.js";

export abstract class PlatformAdapter {
  abstract id: PlatformId;
  abstract name: string;
  abstract configFormat: PlatformConfigFormat;

  abstract getConfigPaths(): string[];
  abstract readConfig(): Promise<Record<string, unknown> | null>;
  abstract writeServerEntry(name: string, entry: McpServerEntry): Promise<void>;
  abstract removeServerEntry(name: string): Promise<void>;
  abstract listServers(): Promise<Record<string, McpServerEntry>>;
}
