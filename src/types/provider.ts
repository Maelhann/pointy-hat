import type { ProviderId, ProviderConfig } from "./config.js";

// Message content blocks
export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

// Messages
export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

// Tool definitions (MCP tools converted for LLM)
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// LLM response
export interface LLMResponse {
  content: ContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// Model info
export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  supportsTools: boolean;
}

// Send message params
export interface SendMessageParams {
  model?: string;
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  providerId?: ProviderId;
}

// Provider interface
export interface LLMProviderInterface {
  id: ProviderId;
  name: string;
  sendMessage(params: SendMessageParams): Promise<LLMResponse>;
  listModels(): Promise<ModelInfo[]>;
  testConnection(): Promise<boolean>;
}
