import type { SpellbookManager } from "./spellbook-manager.js";
import type { ConfigManager } from "./config-manager.js";
import type { RegistryClient } from "./registry-client.js";
import type { SpellDefinition } from "../types/spell.js";
import type { CoverageResult } from "../types/coverage.js";
import type { QualityCheckResult } from "../types/quality.js";
import { analyzeCoverage, parseToolUri, type ProvidedInput } from "./coverage-analyzer.js";
import {
  generateGuidePrompt,
  generateSpellFormatPrompt,
  generateInterpretPrompt,
  generateCastPrompt,
} from "./mcp-prompts.js";
import { Readable, Writable } from "node:stream";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpServerToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpServerPromptDef {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
}

interface McpServerResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
}

const PROTOCOL_VERSION = "2024-11-05";

export class PointyHatMcpServer {
  private spellbookManager: SpellbookManager;
  private configManager: ConfigManager;
  private registryClient: RegistryClient;
  private buffer = "";
  private inputStream: Readable | null = null;
  private outputStream: Writable | null = null;

  constructor(
    spellbookManager: SpellbookManager,
    configManager: ConfigManager,
    registryClient: RegistryClient,
  ) {
    this.spellbookManager = spellbookManager;
    this.configManager = configManager;
    this.registryClient = registryClient;
  }

  async start(transport: "stdio"): Promise<void> {
    if (transport === "stdio") {
      this.inputStream = process.stdin;
      this.outputStream = process.stdout;

      this.inputStream.on("data", (data: Buffer) => {
        this.handleData(data);
      });

      // Keep process alive
      this.inputStream.resume();
    }
  }

  // For testing: process a single request and return the response
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      switch (request.method) {
        case "initialize":
          return this.handleInitialize(request);
        case "notifications/initialized":
          // No response for notifications
          return { jsonrpc: "2.0", id: request.id, result: {} };
        case "tools/list":
          return this.handleToolsList(request);
        case "tools/call":
          return await this.handleToolsCall(request);
        case "prompts/list":
          return this.handlePromptsList(request);
        case "prompts/get":
          return await this.handlePromptsGet(request);
        case "resources/list":
          return await this.handleResourcesList(request);
        case "resources/read":
          return await this.handleResourcesRead(request);
        default:
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32601, message: `Method not found: ${request.method}` },
          };
      }
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  // ── Protocol Handlers ──

  private handleInitialize(request: JsonRpcRequest): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          prompts: { listChanged: false },
          resources: { listChanged: false },
        },
        serverInfo: {
          name: "pointyhat",
          version: "0.1.0",
        },
      },
    };
  }

  private handleToolsList(request: JsonRpcRequest): JsonRpcResponse {
    const tools: McpServerToolDef[] = [
      {
        name: "search_spells",
        description: "Search for spells in the Pointy Hat registry",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            tags: { type: "array", items: { type: "string" }, description: "Filter by tags" },
          },
          required: ["query"],
        },
      },
      {
        name: "search_mcps",
        description: "Search for MCP server packages in the Pointy Hat registry",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            category: { type: "string", description: "Filter by category" },
          },
          required: ["query"],
        },
      },
      {
        name: "get_spell",
        description: "Get full spell definition by name",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Spell name" },
            version: { type: "string", description: "Specific version" },
          },
          required: ["name"],
        },
      },
      {
        name: "check_coverage",
        description: "Check if available tools and inputs satisfy a spell's requirements",
        inputSchema: {
          type: "object",
          properties: {
            spell_name: { type: "string", description: "Name of the spell to check" },
            available_tools: { type: "array", items: { type: "string" }, description: "Available tool names" },
            provided_inputs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  value: { type: "string" },
                },
              },
              description: "Provided inputs",
            },
          },
          required: ["spell_name"],
        },
      },
      {
        name: "quality_check",
        description: "Evaluate a quality check (quality gate) on step output",
        inputSchema: {
          type: "object",
          properties: {
            step_id: { type: "string", description: "Step, output, or effect identifier" },
            output: { type: "string", description: "Step output to evaluate" },
            criteria: { type: "string", description: "Quality criteria" },
            min_score: { type: "number", description: "Minimum passing score (0-1)" },
          },
          required: ["step_id", "output", "criteria"],
        },
      },
      {
        name: "install_mcp",
        description: "Install an MCP server package",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Package name" },
            platform: { type: "string", description: "Target platform" },
          },
          required: ["name"],
        },
      },
    ];

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { tools },
    };
  }

  private async handleToolsCall(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as { name: string; arguments: Record<string, unknown> };
    const toolName = params.name;
    const args = params.arguments || {};

    let result: unknown;

    switch (toolName) {
      case "search_spells":
        result = await this.toolSearchSpells(args);
        break;
      case "search_mcps":
        result = await this.toolSearchMcps(args);
        break;
      case "get_spell":
        result = await this.toolGetSpell(args);
        break;
      case "check_coverage":
        result = await this.toolCheckCoverage(args);
        break;
      case "quality_check":
        result = this.toolQualityCheck(args);
        break;
      case "install_mcp":
        result = await this.toolInstallMcp(args);
        break;
      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: `Unknown tool: ${toolName}` },
        };
    }

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      },
    };
  }

  private handlePromptsList(request: JsonRpcRequest): JsonRpcResponse {
    const prompts: McpServerPromptDef[] = [
      {
        name: "guide",
        description: "Learn how Pointy Hat spells work — concepts, vocabulary, tools, and the complete casting workflow",
        arguments: [],
      },
      {
        name: "spell_format",
        description: "Complete YAML schema reference for spell definitions — every field, type, convention, and example",
        arguments: [],
      },
      {
        name: "interpret_spell",
        description: "Analyze a specific spell: execution mode, dependency graph, inputs, tools, quality gates, and recommended approach",
        arguments: [
          { name: "name", description: "Spell name", required: true },
        ],
      },
      {
        name: "cast_spell",
        description: "Generate structured casting instructions for executing a spell",
        arguments: [
          { name: "name", description: "Spell name", required: true },
          { name: "inputs", description: "JSON object of input key-value pairs", required: false },
        ],
      },
    ];

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { prompts },
    };
  }

  private async handlePromptsGet(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as { name: string; arguments?: Record<string, string> };

    // Static prompts (no arguments)
    if (params.name === "guide") {
      return this.promptResponse(request.id, "Pointy Hat Agent Guide", generateGuidePrompt());
    }
    if (params.name === "spell_format") {
      return this.promptResponse(request.id, "Spell YAML Format Reference", generateSpellFormatPrompt());
    }

    // Spell-specific prompts (require name argument)
    if (params.name === "interpret_spell" || params.name === "cast_spell") {
      const spellName = params.arguments?.name;
      if (!spellName) {
        return this.promptError(request.id, "Missing required argument: name");
      }

      const spell = await this.findSpell(spellName);
      if (!spell) {
        return this.promptError(request.id, `Spell "${spellName}" not found`);
      }

      if (params.name === "interpret_spell") {
        return this.promptResponse(
          request.id,
          `Analysis of spell "${spell.name}" v${spell.version}`,
          generateInterpretPrompt(spell),
        );
      }

      return this.promptResponse(
        request.id,
        `Cast the spell "${spell.name}" v${spell.version}`,
        generateCastPrompt(spell, params.arguments),
      );
    }

    return this.promptError(request.id, `Unknown prompt: ${params.name}`);
  }

  private promptResponse(id: number | string, description: string, text: string): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        description,
        messages: [{ role: "user", content: { type: "text", text } }],
      },
    };
  }

  private promptError(id: number | string, message: string): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32602, message },
    };
  }

  private async handleResourcesList(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const spells = await this.spellbookManager.list();

    const resources = spells.map((r) => ({
      uri: `spell://${r.name}/${r.version}`,
      name: r.name,
      description: r.description,
      mimeType: "application/yaml",
    }));

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { resources },
    };
  }

  private async handleResourcesRead(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as { uri: string };
    const match = params.uri.match(/^spell:\/\/([^/]+)(?:\/(.+))?$/);
    if (!match) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: `Invalid resource URI: ${params.uri}` },
      };
    }

    const spellName = match[1];
    const spell = await this.findSpell(spellName);
    if (!spell) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: `Spell "${spellName}" not found` },
      };
    }

    const { stringifyYaml } = await import("../utils/yaml.js");
    const content = stringifyYaml({ spell });

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        contents: [
          {
            uri: params.uri,
            mimeType: "application/yaml",
            text: content,
          },
        ],
      },
    };
  }

  // ── Tool Implementations ──

  private async toolSearchSpells(args: Record<string, unknown>) {
    const query = args.query as string;
    const response = await this.registryClient.searchSpells(query);
    return response.results.map((r) => ({
      name: r.name,
      version: r.version,
      description: r.description,
      downloads: r.downloads,
    }));
  }

  private async toolSearchMcps(args: Record<string, unknown>) {
    const query = args.query as string;
    const category = args.category as string | undefined;
    const response = await this.registryClient.search(query, { category });
    return response.results.map((r) => ({
      name: r.name,
      version: r.version,
      type: r.type,
      description: r.description,
      downloads: r.downloads,
    }));
  }

  private async toolGetSpell(args: Record<string, unknown>) {
    const name = args.name as string;
    const version = args.version as string | undefined;

    // Try spellbook first, then registry
    const local = await this.spellbookManager.get(name);
    if (local) {
      return {
        ...local,
        catalysts: local.catalysts?.map((c: { id: string; description: string; type: string }) => ({
          id: c.id,
          description: c.description,
          type: c.type,
        })),
      };
    }

    const detail = await this.registryClient.getSpell(name, version);
    return detail;
  }

  private async toolCheckCoverage(args: Record<string, unknown>): Promise<CoverageResult> {
    const spellName = args.spell_name as string;
    const availableToolsList = (args.available_tools as string[]) || [];
    const providedInputsList = (args.provided_inputs as ProvidedInput[]) || [];

    const spell = await this.findSpell(spellName);
    if (!spell) {
      throw new Error(`Spell "${spellName}" not found`);
    }

    return analyzeCoverage(
      spell,
      new Set(availableToolsList),
      providedInputsList,
    );
  }

  private toolQualityCheck(args: Record<string, unknown>): QualityCheckResult {
    const output = args.output as string;
    const criteria = args.criteria as string;
    const minScore = (args.min_score as number) || 0.8;

    // Basic heuristic quality check evaluation (without LLM)
    // Check if the output addresses the criteria keywords
    const criteriaWords = criteria.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const outputLower = output.toLowerCase();
    const matchedWords = criteriaWords.filter((w) => outputLower.includes(w));
    const score = criteriaWords.length > 0 ? matchedWords.length / criteriaWords.length : 0;

    return {
      score,
      passed: score >= minScore,
      feedback: score >= minScore
        ? "Output meets quality criteria."
        : `Output scored ${(score * 100).toFixed(0)}% — below minimum ${(minScore * 100).toFixed(0)}%. Missing: ${criteriaWords.filter((w) => !outputLower.includes(w)).join(", ")}`,
    };
  }

  private async toolInstallMcp(args: Record<string, unknown>) {
    const name = args.name as string;
    const platform = args.platform as string | undefined;

    // Return instructions rather than actually installing (safer from MCP context)
    return {
      message: `To install "${name}", run: pointyhat mcp install ${name}${platform ? ` --platform ${platform}` : ""}`,
      name,
      platform: platform || "auto-detect",
    };
  }

  // ── Helpers ──

  private async findSpell(name: string): Promise<SpellDefinition | null> {
    // Try spellbook first
    const local = await this.spellbookManager.get(name);
    if (local) return local;

    // Try registry
    try {
      const detail = await this.registryClient.getSpell(name);
      return {
        name: detail.name,
        version: detail.version,
        description: detail.description ?? "",
        author: detail.author ?? "unknown",
        license: detail.license,
        tags: detail.tags ?? [],
        card: detail.card,
        inputs: detail.inputs ?? { required: [], optional: [] },
        catalysts: detail.catalysts?.map((c) => ({ id: c.id, description: c.description, uri: `catalyst://${detail.name}/${c.id}`, type: c.type })) ?? [],
        requires: detail.requires ?? { tools: [], resources: [] },
        steps: detail.steps ?? [],
        outputs: detail.outputs ?? [],
        effects: detail.effects ?? [],
        metadata: (detail.metadata as Record<string, unknown>) ?? {},
      };
    } catch {
      return null;
    }
  }

  // ── stdio transport ──

  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const request = JSON.parse(line) as JsonRpcRequest;
        this.handleRequest(request).then((response) => {
          // Don't send response for notifications (no id)
          if (request.id !== undefined) {
            this.sendResponse(response);
          }
        });
      } catch {
        // Invalid JSON — skip
      }
    }
  }

  private sendResponse(response: JsonRpcResponse): void {
    if (this.outputStream) {
      this.outputStream.write(JSON.stringify(response) + "\n");
    }
  }
}
