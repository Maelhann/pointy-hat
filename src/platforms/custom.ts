import { PlatformAdapter } from "./base.js";
import type { PlatformId, PlatformConfigFormat, McpServerEntry } from "../types/platform.js";
import { fileExists, readJsoncFile, writeJsonFile } from "../utils/fs.js";

export class CustomPlatformAdapter extends PlatformAdapter {
  id: PlatformId = "custom";
  name = "Custom Platform";
  configFormat: PlatformConfigFormat = "json";

  private configPath: string;
  private configKey: string;

  constructor(configPath: string, configKey: string = "mcpServers") {
    super();
    this.configPath = configPath;
    this.configKey = configKey;
  }

  getConfigPaths(): string[] {
    return [this.configPath];
  }

  async readConfig(): Promise<Record<string, unknown> | null> {
    if (await fileExists(this.configPath)) {
      return readJsoncFile<Record<string, unknown>>(this.configPath);
    }
    return null;
  }

  async writeServerEntry(name: string, entry: McpServerEntry): Promise<void> {
    const config = (await this.readConfig()) || {};
    const servers = (config[this.configKey] as Record<string, unknown>) || {};
    servers[name] = {
      command: entry.command,
      args: entry.args,
      ...(entry.env && Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
    };
    config[this.configKey] = servers;
    await writeJsonFile(this.configPath, config);
  }

  async removeServerEntry(name: string): Promise<void> {
    const config = await this.readConfig();
    if (!config) return;
    const servers = (config[this.configKey] as Record<string, unknown>) || {};
    delete servers[name];
    config[this.configKey] = servers;
    await writeJsonFile(this.configPath, config);
  }

  async listServers(): Promise<Record<string, McpServerEntry>> {
    const config = await this.readConfig();
    if (!config?.[this.configKey]) return {};
    return config[this.configKey] as Record<string, McpServerEntry>;
  }
}
