import { z } from "zod";
import type { PlatformId } from "./platform.js";

export type McpTransport = "stdio" | "sse" | "http";

export const McpPackageSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  transport: z.enum(["stdio", "sse", "http"]).default("stdio"),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  platforms: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  resources: z.array(z.string()).default([]),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  downloads: z.number().optional(),
  rating: z.number().optional(),
});
export type McpPackage = z.infer<typeof McpPackageSchema>;

export interface McpInstallSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  configPath: string;
  platform: PlatformId;
}

// ── MCP Protocol Types (JSON-RPC over stdio) ──

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface McpInitializeParams {
  protocolVersion: string;
  capabilities: {
    roots?: { listChanged?: boolean };
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, unknown>;
    resources?: Record<string, unknown>;
    prompts?: Record<string, unknown>;
  };
  serverInfo: {
    name: string;
    version?: string;
  };
}
