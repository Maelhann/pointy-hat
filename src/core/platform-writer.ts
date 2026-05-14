import type { PlatformId, McpServerEntry } from "../types/platform.js";
import { PlatformAdapter } from "../platforms/base.js";
import { ClaudeDesktopAdapter } from "../platforms/claude-desktop.js";
import { ClaudeCodeAdapter } from "../platforms/claude-code.js";
import { CursorAdapter } from "../platforms/cursor.js";
import { WindsurfAdapter } from "../platforms/windsurf.js";
import { VSCodeContinueAdapter } from "../platforms/vscode-continue.js";
import { VSCodeCopilotAdapter } from "../platforms/vscode-copilot.js";

const adapters: Record<string, PlatformAdapter> = {
  "claude-desktop": new ClaudeDesktopAdapter(),
  "claude-code": new ClaudeCodeAdapter(),
  cursor: new CursorAdapter(),
  windsurf: new WindsurfAdapter(),
  "vscode-continue": new VSCodeContinueAdapter(),
  "vscode-copilot": new VSCodeCopilotAdapter(),
};

export function getAdapter(platformId: PlatformId): PlatformAdapter | null {
  return adapters[platformId] || null;
}

export async function writeMcpToPlatform(
  name: string,
  entry: McpServerEntry,
  platformId: PlatformId,
): Promise<void> {
  const adapter = getAdapter(platformId);
  if (!adapter) {
    throw new Error(`No adapter for platform "${platformId}"`);
  }
  await adapter.writeServerEntry(name, entry);
}

export async function removeMcpFromPlatform(
  name: string,
  platformId: PlatformId,
): Promise<void> {
  const adapter = getAdapter(platformId);
  if (!adapter) {
    throw new Error(`No adapter for platform "${platformId}"`);
  }
  await adapter.removeServerEntry(name);
}
