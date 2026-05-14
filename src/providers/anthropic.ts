import Anthropic from "@anthropic-ai/sdk";
import { BaseLLMProvider } from "./base.js";
import type { ProviderId, ProviderConfig } from "../types/config.js";
import type {
  LLMResponse,
  ModelInfo,
  SendMessageParams,
  ContentBlock,
  Message,
} from "../types/provider.js";

export class AnthropicProvider extends BaseLLMProvider {
  id: ProviderId = "anthropic";
  name = "Anthropic (Claude)";
  private client: Anthropic;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new Anthropic({
      apiKey: this.getApiKey(),
    });
  }

  async sendMessage(params: SendMessageParams): Promise<LLMResponse> {
    const model = this.getModel(params.model);

    // Convert messages to Anthropic format
    const messages = params.messages.map((m) => this.toAnthropicMessage(m));

    // Convert tools to Anthropic format
    const tools = params.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model,
      system: params.systemPrompt,
      messages,
      max_tokens: params.maxTokens || 4096,
      ...(tools && tools.length > 0 ? { tools } : {}),
    });

    // Map response content to our format
    const content: ContentBlock[] = response.content.map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      }
      return { type: "text" as const, text: "" };
    });

    return {
      content,
      stopReason: this.mapStopReason(response.stop_reason || "end_turn"),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.messages.create({
        model: this.config.model || "claude-sonnet-4-5-20250514",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hello" }],
      });
      return response.content.length > 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // Anthropic doesn't have a list-models endpoint; return known models
    return [
      {
        id: "claude-sonnet-4-5-20250514",
        name: "Claude Sonnet 4.5",
        contextWindow: 200000,
        supportsTools: true,
      },
      {
        id: "claude-opus-4-20250514",
        name: "Claude Opus 4",
        contextWindow: 200000,
        supportsTools: true,
      },
      {
        id: "claude-haiku-3-5-20241022",
        name: "Claude Haiku 3.5",
        contextWindow: 200000,
        supportsTools: true,
      },
    ];
  }

  private toAnthropicMessage(msg: Message): Anthropic.MessageParam {
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }

    // Map content blocks to Anthropic format
    const content: Anthropic.ContentBlockParam[] = msg.content.map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
      if (block.type === "tool_result") {
        return {
          type: "tool_result" as const,
          tool_use_id: block.tool_use_id,
          content: block.content,
        };
      }
      return { type: "text" as const, text: "" };
    });

    return { role: msg.role, content };
  }
}
