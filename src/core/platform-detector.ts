import { join } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";
import type {
  PlatformId,
  PlatformInfo,
  PlatformSpec,
  PlatformStatus,
  DetectionResult,
} from "../types/platform.js";
import { fileExists, expandPath, readFile } from "../utils/fs.js";

const os = platform();

// Platform specifications with OS-aware config paths
export const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  "claude-desktop": {
    id: "claude-desktop",
    name: "Claude Desktop",
    configPaths: {
      darwin: [join(homedir(), "Library/Application Support/Claude/claude_desktop_config.json")],
      win32: [join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json")],
      linux: [join(homedir(), ".config/Claude/claude_desktop_config.json")],
    },
    configFormat: "json",
    configKey: "mcpServers",
    binaryNames: ["Claude"],
    knownInstallPaths: {
      darwin: ["/Applications/Claude.app"],
      win32: [join(process.env.LOCALAPPDATA || "", "Programs", "Claude", "Claude.exe")],
    },
  },
  "claude-code": {
    id: "claude-code",
    name: "Claude Code",
    configPaths: {
      darwin: [join(homedir(), ".claude.json")],
      win32: [join(homedir(), ".claude.json")],
      linux: [join(homedir(), ".claude.json")],
    },
    configFormat: "json",
    configKey: "mcpServers",
    binaryNames: ["claude"],
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    configPaths: {
      darwin: [join(homedir(), ".cursor/mcp.json")],
      win32: [join(homedir(), ".cursor/mcp.json")],
      linux: [join(homedir(), ".cursor/mcp.json")],
    },
    configFormat: "json",
    configKey: "mcpServers",
    binaryNames: ["cursor"],
    knownInstallPaths: {
      darwin: ["/Applications/Cursor.app"],
      win32: [join(process.env.LOCALAPPDATA || "", "Programs", "Cursor", "Cursor.exe")],
    },
  },
  windsurf: {
    id: "windsurf",
    name: "Windsurf",
    configPaths: {
      darwin: [join(homedir(), ".codeium/windsurf/mcp_config.json")],
      win32: [join(homedir(), ".codeium/windsurf/mcp_config.json")],
      linux: [join(homedir(), ".codeium/windsurf/mcp_config.json")],
    },
    configFormat: "json",
    configKey: "mcpServers",
    binaryNames: ["windsurf"],
  },
  "vscode-continue": {
    id: "vscode-continue",
    name: "VS Code + Continue",
    configPaths: {
      darwin: [join(process.cwd(), ".continue/config.json")],
      win32: [join(process.cwd(), ".continue/config.json")],
      linux: [join(process.cwd(), ".continue/config.json")],
    },
    configFormat: "yaml",
    configKey: "mcpServers",
    binaryNames: ["code"],
  },
  "vscode-copilot": {
    id: "vscode-copilot",
    name: "VS Code + Copilot",
    configPaths: {
      darwin: [join(process.cwd(), ".vscode/mcp.json")],
      win32: [join(process.cwd(), ".vscode/mcp.json")],
      linux: [join(process.cwd(), ".vscode/mcp.json")],
    },
    configFormat: "json",
    configKey: "mcpServers",
    binaryNames: ["code"],
  },
};

export async function binaryExistsInPath(name: string): Promise<boolean> {
  try {
    const cmd = os === "win32" ? `where.exe ${name}` : `which ${name}`;
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function checkKnownPaths(spec: PlatformSpec): Promise<boolean> {
  const paths = spec.knownInstallPaths?.[os as keyof typeof spec.knownInstallPaths];
  if (!paths) return false;
  for (const p of paths) {
    if (await fileExists(p)) return true;
  }
  return false;
}

export async function detectPlatform(id: PlatformId): Promise<PlatformInfo> {
  const spec = PLATFORM_SPECS[id];
  if (!spec) {
    return { id, name: id, status: "not-detected" };
  }

  const configPaths = spec.configPaths[os as keyof typeof spec.configPaths] || [];

  // Check if config file exists
  for (const configPath of configPaths) {
    const expanded = expandPath(configPath);
    if (await fileExists(expanded)) {
      try {
        // Attempt to read and basic-validate
        await readFile(expanded);
        return {
          id,
          name: spec.name,
          status: "ok",
          configPath: expanded,
        };
      } catch (err) {
        return {
          id,
          name: spec.name,
          status: "error",
          configPath: expanded,
          error: String(err),
        };
      }
    }
  }

  // No config found — check if binary exists
  for (const bin of spec.binaryNames) {
    if (await binaryExistsInPath(bin)) {
      return {
        id,
        name: spec.name,
        status: "missing-config",
      };
    }
  }

  // Check known install paths
  if (await checkKnownPaths(spec)) {
    return {
      id,
      name: spec.name,
      status: "missing-config",
    };
  }

  return { id, name: spec.name, status: "not-detected" };
}

export async function detectAllPlatforms(): Promise<DetectionResult> {
  const platformIds = Object.keys(PLATFORM_SPECS) as PlatformId[];
  const platforms = await Promise.all(platformIds.map(detectPlatform));
  const detected = platforms.filter(
    (p) => p.status === "ok" || p.status === "missing-config",
  );

  return {
    platforms,
    detectedCount: detected.length,
    primaryPlatform: getPrimaryPlatform({ platforms, detectedCount: detected.length }),
  };
}

const PLATFORM_PRIORITY: PlatformId[] = [
  "claude-code",
  "cursor",
  "claude-desktop",
  "windsurf",
  "vscode-copilot",
  "vscode-continue",
];

export function getPrimaryPlatform(result: DetectionResult): PlatformId | undefined {
  for (const id of PLATFORM_PRIORITY) {
    const p = result.platforms.find((p) => p.id === id);
    if (p && p.status === "ok") return id;
  }
  // Fallback: first detected (even with missing-config)
  for (const id of PLATFORM_PRIORITY) {
    const p = result.platforms.find((p) => p.id === id);
    if (p && p.status === "missing-config") return id;
  }
  return undefined;
}
