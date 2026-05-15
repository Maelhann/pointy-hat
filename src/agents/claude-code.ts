/**
 * Claude Code agent runtime.
 *
 * Spawns `claude` as a subprocess in non-interactive (--print) mode,
 * pipes the mission prompt via stdin, and streams output in real-time.
 * MCP servers are passed via a temporary config file.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { binaryExistsInPath } from "../core/platform-detector.js";
import type { AgentRuntime, AgentMission, AgentResult } from "./runtime.js";

export class ClaudeCodeRuntime implements AgentRuntime {
  readonly id = "claude-code";
  readonly name = "Claude Code";

  private process: ChildProcess | null = null;
  private binaryName = "claude";

  async isAvailable(): Promise<boolean> {
    return binaryExistsInPath(this.binaryName);
  }

  async execute(mission: AgentMission): Promise<AgentResult> {
    const start = Date.now();
    let mcpConfigPath: string | undefined;

    try {
      // Write temporary MCP config if servers are needed
      if (Object.keys(mission.mcpServers).length > 0) {
        mcpConfigPath = await writeTempMcpConfig(mission.mcpServers);
      }

      // Build the command arguments
      const args = buildArgs(mission, mcpConfigPath);

      return await new Promise<AgentResult>((resolve) => {
        const chunks: string[] = [];

        this.process = spawn(this.binaryName, args, {
          cwd: mission.workingDirectory,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        });

        this.process.stdout?.on("data", (data: Buffer) => {
          const text = data.toString();
          chunks.push(text);
          if (mission.streamOutput) {
            process.stdout.write(text);
          }
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          const text = data.toString();
          if (mission.streamOutput) {
            process.stderr.write(text);
          }
        });

        // Pipe the prompt to stdin
        if (this.process.stdin) {
          this.process.stdin.write(mission.prompt);
          this.process.stdin.end();
        }

        // Timeout handling
        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (mission.timeout > 0) {
          timer = setTimeout(() => {
            timedOut = true;
            this.process?.kill("SIGTERM");
          }, mission.timeout * 1000);
        }

        this.process.on("close", (code) => {
          if (timer) clearTimeout(timer);
          this.process = null;

          resolve({
            completed: !timedOut && code === 0,
            output: chunks.join(""),
            exitCode: code ?? 1,
            durationMs: Date.now() - start,
          });
        });

        this.process.on("error", (err) => {
          if (timer) clearTimeout(timer);
          this.process = null;

          resolve({
            completed: false,
            output: `Agent process error: ${err.message}`,
            exitCode: 1,
            durationMs: Date.now() - start,
          });
        });
      });
    } finally {
      // Clean up temporary MCP config
      if (mcpConfigPath) {
        try {
          await unlink(mcpConfigPath);
        } catch {
          // Best effort
        }
      }
    }
  }

  async abort(): Promise<void> {
    if (this.process) {
      this.process.kill("SIGTERM");
      // Give it a moment, then force-kill
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.process?.kill("SIGKILL");
          resolve();
        }, 5000);
        this.process?.on("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.process = null;
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildArgs(
  mission: AgentMission,
  mcpConfigPath?: string,
): string[] {
  const args: string[] = [
    "--print",        // Non-interactive: read prompt from stdin, write to stdout
    "--verbose",      // Include tool use details
  ];

  if (mcpConfigPath) {
    args.push("--mcp-config", mcpConfigPath);
  }

  return args;
}

async function writeTempMcpConfig(
  servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>,
): Promise<string> {
  const configDir = join(tmpdir(), "pointyhat-agent");
  await mkdir(configDir, { recursive: true });

  const id = randomBytes(8).toString("hex");
  const configPath = join(configDir, `mcp-${id}.json`);

  const config: Record<string, unknown> = {
    mcpServers: {} as Record<string, unknown>,
  };

  for (const [name, server] of Object.entries(servers)) {
    (config.mcpServers as Record<string, unknown>)[name] = {
      command: server.command,
      args: server.args,
      ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
    };
  }

  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  return configPath;
}
