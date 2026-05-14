import { BaseLLMProvider } from "./base.js";
import type { ProviderId, ProviderConfig } from "../types/config.js";
import type {
  LLMResponse,
  ModelInfo,
  SendMessageParams,
  ContentBlock,
  Message,
} from "../types/provider.js";
import { fetchWithTimeout } from "../utils/network.js";

// Ollama REST API types
interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
}

interface OllamaToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done_reason: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider extends BaseLLMProvider {
  id: ProviderId = "ollama";
  name = "Ollama (Local)";

  constructor(config: ProviderConfig) {
    super(config);
  }

  private get baseUrl(): string {
    return this.config.base_url || "http://localhost:11434";
  }

  async sendMessage(params: SendMessageParams): Promise<LLMResponse> {
    const model = this.getModel(params.model);

    // Build messages array with system prompt
    const messages: OllamaChatMessage[] = [
      { role: "system", content: params.systemPrompt },
      ...params.messages.flatMap((m) => this.toOllamaMessage(m)),
    ];

    // Convert tools to OpenAI-compatible function calling format
    const tools: OllamaTool[] | undefined =
      params.tools && params.tools.length > 0
        ? params.tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
            },
          }))
        : undefined;

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      120000, // 2 minute timeout for local models which can be slow
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Ollama API error (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as OllamaChatResponse;

    // Map response to our content block format
    const content: ContentBlock[] = [];

    // Map text content
    if (data.message.content) {
      content.push({ type: "text", text: data.message.content });
    }

    // Map tool calls
    if (data.message.tool_calls) {
      for (const tc of data.message.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id || `call_${Math.random().toString(36).slice(2, 11)}`,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || "{}"),
        });
      }
    }

    // Determine stop reason: tool_calls present overrides done_reason
    let stopReason: LLMResponse["stopReason"];
    if (data.message.tool_calls && data.message.tool_calls.length > 0) {
      stopReason = "tool_use";
    } else {
      stopReason = this.mapStopReason(data.done_reason || "stop");
    }

    return {
      content,
      stopReason,
      usage: {
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0,
      },
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const resp = await fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        undefined,
        5000,
      );
      return resp.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const resp = await fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        undefined,
        10000,
      );
      if (!resp.ok) return [];
      const data = (await resp.json()) as { models?: { name: string }[] };
      return (data.models || []).map((m) => ({
        id: m.name,
        name: m.name,
        supportsTools: true,
      }));
    } catch {
      return [];
    }
  }

  private toOllamaMessage(msg: Message): OllamaChatMessage[] {
    if (typeof msg.content === "string") {
      return [
        {
          role: msg.role as "user" | "assistant",
          content: msg.content,
        },
      ];
    }

    // Handle user messages containing tool results
    // Each tool_result block becomes a separate "tool" role message
    if (msg.role === "user") {
      const results: OllamaChatMessage[] = [];
      const textParts: string[] = [];

      for (const block of msg.content) {
        if (block.type === "tool_result") {
          results.push({
            role: "tool",
            content:
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content),
            tool_call_id: block.tool_use_id,
          });
        } else if (block.type === "text") {
          textParts.push(block.text);
        }
      }

      // If there are tool results, return them (possibly preceded by a text message)
      if (results.length > 0) {
        if (textParts.length > 0) {
          return [
            { role: "user", content: textParts.join("") },
            ...results,
          ];
        }
        return results;
      }

      // Plain text user message
      return [
        {
          role: "user",
          content: textParts.join(""),
        },
      ];
    }

    // Handle assistant messages with tool calls
    if (msg.role === "assistant") {
      const textParts = msg.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text);
      const toolParts = msg.content.filter((b) => b.type === "tool_use");

      if (toolParts.length > 0) {
        return [
          {
            role: "assistant",
            content: textParts.join("") || "",
            tool_calls: toolParts.map((t) => ({
              id: (t as { id: string }).id,
              type: "function" as const,
              function: {
                name: (t as { name: string }).name,
                arguments: JSON.stringify((t as { input: unknown }).input),
              },
            })),
          },
        ];
      }

      return [
        {
          role: "assistant",
          content: textParts.join(""),
        },
      ];
    }

    // Fallback: extract text content
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    return [{ role: msg.role as "user" | "assistant", content: text }];
  }
}
