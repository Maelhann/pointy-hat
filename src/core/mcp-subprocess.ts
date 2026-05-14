import { spawn, type ChildProcess } from "node:child_process";
import type {
  McpToolDefinition,
  McpToolResult,
  McpResource,
  McpResourceContent,
  McpInitializeParams,
  McpInitializeResult,
} from "../types/mcp-package.js";

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT = 30000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class McpSubprocess {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private command: string;
  private args: string[];
  private env: Record<string, string>;
  private timeout: number;
  private serverInfo: McpInitializeResult | null = null;

  constructor(
    command: string,
    args: string[] = [],
    env?: Record<string, string>,
    timeout?: number,
  ) {
    this.command = command;
    this.args = args;
    this.env = env || {};
    this.timeout = timeout || DEFAULT_TIMEOUT;
  }

  async start(): Promise<void> {
    this.process = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.env },
    });

    // Handle stdout data (JSON-RPC responses)
    this.process.stdout!.on("data", (data: Buffer) => {
      this.handleStdout(data);
    });

    // Handle process errors
    this.process.on("error", (err) => {
      // Reject all pending requests
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`MCP process error: ${err.message}`));
        this.pending.delete(id);
      }
    });

    this.process.on("exit", (code) => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`MCP process exited with code ${code}`));
        this.pending.delete(id);
      }
    });

    // Send initialize handshake
    const initParams: McpInitializeParams = {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        roots: { listChanged: false },
      },
      clientInfo: {
        name: "pointyhat",
        version: "0.1.0",
      },
    };

    const result = await this.sendRequest("initialize", initParams) as McpInitializeResult;
    this.serverInfo = result;

    // Send initialized notification (no response expected)
    this.sendNotification("notifications/initialized", {});
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.sendRequest("tools/list", {}) as { tools: McpToolDefinition[] };
    return result.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = await this.sendRequest("tools/call", {
      name,
      arguments: args,
    }) as McpToolResult;
    return result;
  }

  async listResources(): Promise<McpResource[]> {
    const result = await this.sendRequest("resources/list", {}) as { resources: McpResource[] };
    return result.resources || [];
  }

  async readResource(uri: string): Promise<McpResourceContent> {
    const result = await this.sendRequest("resources/read", { uri }) as {
      contents: McpResourceContent[];
    };
    return result.contents?.[0] || { uri, text: "" };
  }

  getServerInfo(): McpInitializeResult | null {
    return this.serverInfo;
  }

  isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  kill(): void {
    if (this.process) {
      // Clean up pending requests
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("MCP process killed"));
        this.pending.delete(id);
      }
      this.process.kill();
      this.process = null;
    }
  }

  private sendRequest(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        return reject(new Error("MCP process not started"));
      }

      const id = ++this.requestId;
      const message = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: params || {},
      });

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });

      this.process.stdin.write(message + "\n");
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.process || !this.process.stdin) return;

    const message = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params: params || {},
    });

    this.process.stdin.write(message + "\n");
  }

  private handleStdout(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete lines (JSON-RPC messages are newline-delimited)
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const msg = JSON.parse(line) as {
          jsonrpc: string;
          id?: number;
          result?: unknown;
          error?: { code: number; message: string; data?: unknown };
          method?: string;
          params?: unknown;
        };

        // Response to a request we sent
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id)!;
          clearTimeout(pending.timer);
          this.pending.delete(msg.id);

          if (msg.error) {
            pending.reject(new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`));
          } else {
            pending.resolve(msg.result);
          }
        }
        // Server-initiated notifications are ignored for now
      } catch {
        // Non-JSON output from stderr leak or debug output — skip
      }
    }
  }
}
