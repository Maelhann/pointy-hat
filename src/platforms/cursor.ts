import { join } from "node:path";
import { homedir } from "node:os";
import { PlatformAdapter } from "./base.js";
import type { PlatformId, PlatformConfigFormat, McpServerEntry } from "../types/platform.js";
import { fileExists, readJsoncFile, writeJsonFile } from "../utils/fs.js";

export class CursorAdapter extends PlatformAdapter {
  id: PlatformId = "cursor";
  name = "Cursor";
  configFormat: PlatformConfigFormat = "json";

  getConfigPaths(): string[] {
    return [
      join(homedir(), ".cursor", "mcp.json"),
      join(process.cwd(), ".cursor", "mcp.json"),
    ];
  }

  async readConfig(): Promise<Record<string, unknown> | null> {
    for (const path of this.getConfigPaths()) {
      if (await fileExists(path)) {
        return readJsoncFile<Record<string, unknown>>(path);
      }
    }
    return null;
  }

  async writeServerEntry(name: string, entry: McpServerEntry): Promise<void> {
    const configPath = this.getConfigPaths()[0];
    const config = (await this.readConfig()) || {};
    const servers = (config.mcpServers as Record<string, unknown>) || {};
    servers[name] = {
      command: entry.command,
      args: entry.args,
      ...(entry.env && Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
    };
    config.mcpServers = servers;
    await writeJsonFile(configPath, config);
  }

  async removeServerEntry(name: string): Promise<void> {
    const configPath = this.getConfigPaths()[0];
    const config = await this.readConfig();
    if (!config) return;
    const servers = (config.mcpServers as Record<string, unknown>) || {};
    delete servers[name];
    config.mcpServers = servers;
    await writeJsonFile(configPath, config);
  }

  async listServers(): Promise<Record<string, McpServerEntry>> {
    const config = await this.readConfig();
    if (!config?.mcpServers) return {};
    return config.mcpServers as Record<string, McpServerEntry>;
  }
}
