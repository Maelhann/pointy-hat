import { describe, it, expect, vi, beforeEach } from "vitest";
import { PointyHatMcpServer } from "../../src/core/mcp-server.js";
import { SpellbookManager } from "../../src/core/spellbook-manager.js";
import { RegistryClient } from "../../src/core/registry-client.js";
import { ConfigManager } from "../../src/core/config-manager.js";
import { Cache } from "../../src/core/cache.js";

function createMockDeps() {
  const configManager = new ConfigManager();
  vi.spyOn(configManager, "loadUserConfig").mockResolvedValue({
    provider: {},
    cache: {},
  } as any);
  vi.spyOn(configManager, "loadProjectConfig").mockResolvedValue(null);
  vi.spyOn(configManager, "getProjectDir").mockReturnValue("/tmp/test");

  const cache = new Cache("/tmp/test-cache");
  vi.spyOn(cache, "get").mockResolvedValue(null);
  vi.spyOn(cache, "set").mockResolvedValue(undefined);
  vi.spyOn(cache, "getCacheKey").mockReturnValue("mock-key");

  const registryClient = new RegistryClient({
    baseUrl: "https://api.test.org",
    cache,
  });

  const spellbook = new SpellbookManager(configManager, registryClient);

  return { configManager, registryClient, spellbook, cache };
}

describe("PointyHatMcpServer", () => {
  let server: PointyHatMcpServer;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    server = new PointyHatMcpServer(deps.spellbook, deps.configManager, deps.registryClient);
  });

  describe("initialize", () => {
    it("returns server info and capabilities", async () => {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as any;
      expect(result.protocolVersion).toBe("2024-11-05");
      expect(result.serverInfo.name).toBe("pointyhat");
      expect(result.capabilities.tools).toBeDefined();
      expect(result.capabilities.prompts).toBeDefined();
      expect(result.capabilities.resources).toBeDefined();
    });
  });

  describe("tools/list", () => {
    it("returns all available tools", async () => {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });

      const result = response.result as any;
      expect(result.tools).toBeInstanceOf(Array);
      expect(result.tools.length).toBeGreaterThanOrEqual(6);

      const toolNames = result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("search_spells");
      expect(toolNames).toContain("search_mcps");
      expect(toolNames).toContain("get_spell");
      expect(toolNames).toContain("check_coverage");
      expect(toolNames).toContain("quality_check");
      expect(toolNames).toContain("install_mcp");
    });

    it("each tool has name, description, and inputSchema", async () => {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });

      const result = response.result as any;
      for (const tool of result.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });
  });

  describe("tools/call - quality_check", () => {
    it("passes when output meets criteria", async () => {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "quality_check",
          arguments: {
            step_id: "test-step",
            output: "The report includes specific numbers like revenue of $1.5M and growth of 15%. The executive summary covers all key areas with actionable recommendations.",
            criteria: "Must include specific numbers and executive summary with recommendations",
            min_score: 0.5,
          },
        },
      });

      const result = response.result as any;
      expect(result.content).toHaveLength(1);
      const check = JSON.parse(result.content[0].text);
      expect(check.passed).toBe(true);
      expect(check.score).toBeGreaterThan(0);
    });

    it("fails when output does not meet criteria", async () => {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "quality_check",
          arguments: {
            step_id: "test-step",
            output: "Here is some generic text.",
            criteria: "Must include specific financial numbers and detailed analysis with charts",
            min_score: 0.8,
          },
        },
      });

      const result = response.result as any;
      const check = JSON.parse(result.content[0].text);
      expect(check.passed).toBe(false);
    });
  });

  describe("tools/call - install_mcp", () => {
    it("returns install instructions", async () => {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "install_mcp",
          arguments: { name: "@mcp/filesystem", platform: "cursor" },
        },
      });

      const result = response.result as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.message).toContain("pointyhat mcp install");
      expect(data.name).toBe("@mcp/filesystem");
    });
  });

  describe("tools/call - unknown tool", () => {
    it("returns error for unknown tool", async () => {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "nonexistent_tool",
          arguments: {},
        },
      });

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32602);
    });
  });

  describe("prompts/list", () => {
    it("returns all prompts", async () => {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 7,
        method: "prompts/list",
      });

      const result = response.result as any;
      expect(result.prompts).toHaveLength(4);
      const names = result.prompts.map((p: any) => p.name);
      expect(names).toContain("guide");
      expect(names).toContain("spell_format");
      expect(names).toContain("interpret_spell");
      expect(names).toContain("cast_spell");
    });
  });

  describe("prompts/get", () => {
    it("returns error for missing spell name", async () => {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 8,
        method: "prompts/get",
        params: {
          name: "cast_spell",
          arguments: {},
        },
      });

      expect(response.error).toBeDefined();
    });

    it("returns error for unknown prompt", async () => {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 9,
        method: "prompts/get",
        params: {
          name: "nonexistent",
          arguments: {},
        },
      });

      expect(response.error).toBeDefined();
    });
  });

  describe("resources/list", () => {
    it("returns list of spell resources", async () => {
      vi.spyOn(deps.spellbook, "list").mockResolvedValue([
        {
          name: "test-spell",
          version: "1.0.0",
          description: "Test",
          installedAt: "2025-01-01",
          mcpDependencies: [],
        },
      ]);

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 10,
        method: "resources/list",
      });

      const result = response.result as any;
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0].uri).toBe("spell://test-spell/1.0.0");
    });
  });

  describe("unknown method", () => {
    it("returns method not found error", async () => {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 11,
        method: "unknown/method",
      });

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32601);
    });
  });
});
