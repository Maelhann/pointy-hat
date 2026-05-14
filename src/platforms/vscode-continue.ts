import { join } from "node:path";
import { PlatformAdapter } from "./base.js";
import type { PlatformId, PlatformConfigFormat, McpServerEntry } from "../types/platform.js";
import { fileExists, ensureDir, listFiles } from "../utils/fs.js";
import { readYamlFile, writeYamlFile } from "../utils/yaml.js";

export class VSCodeContinueAdapter extends PlatformAdapter {
  id: PlatformId = "vscode-continue";
  name = "VS Code + Continue";
  configFormat: PlatformConfigFormat = "yaml";

  getConfigPaths(): string[] {
    return [join(process.cwd(), ".continue", "mcpServers")];
  }

  async readConfig(): Promise<Record<string, unknown> | null> {
    const dir = this.getConfigPaths()[0];
    if (!(await fileExists(dir))) return null;
    return { mcpServers: await this.listServers() };
  }

  async writeServerEntry(name: string, entry: McpServerEntry): Promise<void> {
    const dir = this.getConfigPaths()[0];
    await ensureDir(dir);
    const filePath = join(dir, `${name}.yaml`);
    await writeYamlFile(filePath, {
      name,
      command: entry.command,
      args: entry.args,
      ...(entry.env && Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
    });
  }

  async removeServerEntry(name: string): Promise<void> {
    const dir = this.getConfigPaths()[0];
    const filePath = join(dir, `${name}.yaml`);
    if (await fileExists(filePath)) {
      const { unlink } = await import("node:fs/promises");
      await unlink(filePath);
    }
  }

  async listServers(): Promise<Record<string, McpServerEntry>> {
    const dir = this.getConfigPaths()[0];
    if (!(await fileExists(dir))) return {};

    const files = await listFiles(dir, ".yaml");
    const servers: Record<string, McpServerEntry> = {};

    for (const file of files) {
      try {
        const data = await readYamlFile<Record<string, unknown>>(join(dir, file));
        const name = (data.name as string) || file.replace(".yaml", "");
        servers[name] = {
          command: (data.command as string) || "",
          args: (data.args as string[]) || [],
          env: data.env as Record<string, string> | undefined,
        };
      } catch {
        // Skip invalid files
      }
    }

    return servers;
  }
}
