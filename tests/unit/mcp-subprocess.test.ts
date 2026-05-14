import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpSubprocess } from "../../src/core/mcp-subprocess.js";
import { EventEmitter } from "node:events";
import { Writable, Readable } from "node:stream";

// Mock child_process.spawn
vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(),
  };
});

import { spawn } from "node:child_process";
const mockSpawn = vi.mocked(spawn);

function createMockProcess() {
  const stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const stdout = new Readable({
    read() {},
  });

  const stderr = new Readable({
    read() {},
  });

  const proc = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    pid: 12345,
    exitCode: null as number | null,
    signalCode: null,
    killed: false,
    kill: vi.fn(),
  });

  return proc;
}

describe("McpSubprocess", () => {
  let mcp: McpSubprocess;
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as any);
    mcp = new McpSubprocess("test-cmd", ["--arg"], { TEST: "1" }, 5000);
  });

  afterEach(() => {
    mcp.kill();
  });

  describe("constructor", () => {
    it("creates an instance with default values", () => {
      const sub = new McpSubprocess("cmd");
      expect(sub.isRunning()).toBe(false);
      expect(sub.getServerInfo()).toBeNull();
    });
  });

  describe("start", () => {
    it("spawns process and sends initialize request", async () => {
      // Simulate server responding to initialize
      const startPromise = mcp.start();

      // Wait for the write to happen
      await new Promise((r) => setTimeout(r, 10));

      // Simulate server sending back initialize response
      mockProc.stdout.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "test-server", version: "1.0.0" },
          },
        }) + "\n",
      );

      await startPromise;

      expect(mockSpawn).toHaveBeenCalledWith("test-cmd", ["--arg"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({ TEST: "1" }),
      });

      expect(mcp.getServerInfo()).toEqual({
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "test-server", version: "1.0.0" },
      });
    });
  });

  describe("listTools", () => {
    it("sends tools/list and returns tools array", async () => {
      // Start first
      const startPromise = mcp.start();
      await new Promise((r) => setTimeout(r, 10));
      mockProc.stdout.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "test", version: "1.0.0" },
          },
        }) + "\n",
      );
      await startPromise;

      // Now list tools
      const toolsPromise = mcp.listTools();
      await new Promise((r) => setTimeout(r, 10));

      mockProc.stdout.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: {
            tools: [
              {
                name: "read_file",
                description: "Reads a file",
                inputSchema: { type: "object", properties: { path: { type: "string" } } },
              },
            ],
          },
        }) + "\n",
      );

      const tools = await toolsPromise;
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("read_file");
    });
  });

  describe("callTool", () => {
    it("sends tools/call and returns result", async () => {
      // Start
      const startPromise = mcp.start();
      await new Promise((r) => setTimeout(r, 10));
      mockProc.stdout.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "test", version: "1.0.0" },
          },
        }) + "\n",
      );
      await startPromise;

      // Call tool
      const callPromise = mcp.callTool("read_file", { path: "/tmp/test.txt" });
      await new Promise((r) => setTimeout(r, 10));

      mockProc.stdout.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: {
            content: [{ type: "text", text: "file contents here" }],
          },
        }) + "\n",
      );

      const result = await callPromise;
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe("file contents here");
    });

    it("handles error responses", async () => {
      // Start
      const startPromise = mcp.start();
      await new Promise((r) => setTimeout(r, 10));
      mockProc.stdout.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "test", version: "1.0.0" },
          },
        }) + "\n",
      );
      await startPromise;

      // Call tool with error response
      const callPromise = mcp.callTool("bad_tool", {});
      await new Promise((r) => setTimeout(r, 10));

      mockProc.stdout.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          error: { code: -32601, message: "Method not found" },
        }) + "\n",
      );

      await expect(callPromise).rejects.toThrow("MCP error [-32601]: Method not found");
    });
  });

  describe("isRunning", () => {
    it("returns false before start", () => {
      expect(mcp.isRunning()).toBe(false);
    });

    it("returns true after start", async () => {
      const startPromise = mcp.start();
      await new Promise((r) => setTimeout(r, 10));
      mockProc.stdout.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "test", version: "1.0.0" },
          },
        }) + "\n",
      );
      await startPromise;

      expect(mcp.isRunning()).toBe(true);
    });
  });

  describe("kill", () => {
    it("kills the process and rejects pending requests", async () => {
      // Start
      const startPromise = mcp.start();
      await new Promise((r) => setTimeout(r, 10));
      mockProc.stdout.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "test", version: "1.0.0" },
          },
        }) + "\n",
      );
      await startPromise;

      // Start a request but don't respond
      const toolPromise = mcp.listTools();

      // Kill immediately
      mcp.kill();

      await expect(toolPromise).rejects.toThrow("MCP process killed");
      expect(mockProc.kill).toHaveBeenCalled();
    });

    it("is safe to call multiple times", () => {
      expect(() => {
        mcp.kill();
        mcp.kill();
      }).not.toThrow();
    });
  });

  describe("sendRequest error handling", () => {
    it("rejects when process is not started", async () => {
      // Don't call start(), directly try to list tools
      // mcp.process is null, so sendRequest should reject
      await expect(mcp.listTools()).rejects.toThrow("MCP process not started");
    });
  });

  describe("stdout parsing", () => {
    it("handles multiple JSON-RPC messages in a single chunk", async () => {
      // Start
      const startPromise = mcp.start();
      await new Promise((r) => setTimeout(r, 10));
      mockProc.stdout.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "test", version: "1.0.0" },
          },
        }) + "\n",
      );
      await startPromise;

      // Send two requests
      const p1 = mcp.listTools();
      const p2 = mcp.listResources();
      await new Promise((r) => setTimeout(r, 10));

      // Both responses in one chunk
      const msg1 = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [{ name: "t1", inputSchema: {} }] },
      });
      const msg2 = JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        result: { resources: [{ uri: "file:///test", name: "test" }] },
      });
      mockProc.stdout.push(msg1 + "\n" + msg2 + "\n");

      const tools = await p1;
      const resources = await p2;
      expect(tools).toHaveLength(1);
      expect(resources).toHaveLength(1);
    });

    it("ignores non-JSON lines", async () => {
      const startPromise = mcp.start();
      await new Promise((r) => setTimeout(r, 10));

      // Push some non-JSON text followed by valid response
      mockProc.stdout.push("DEBUG: starting up\n");
      mockProc.stdout.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "test", version: "1.0.0" },
          },
        }) + "\n",
      );

      // Should still complete successfully
      await startPromise;
      expect(mcp.getServerInfo()).toBeTruthy();
    });
  });
});
