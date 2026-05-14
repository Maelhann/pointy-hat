import OpenAI from "openai";
import { BaseLLMProvider } from "./base.js";
import type { ProviderId, ProviderConfig } from "../types/config.js";
import type {
  LLMResponse,
  ModelInfo,
  SendMessageParams,
  ContentBlock,
  Message,
} from "../types/provider.js";

export class OpenAIProvider extends BaseLLMProvider {
  id: ProviderId = "openai";
  name = "OpenAI (GPT)";
  private client: OpenAI;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: this.getApiKey(),
      ...(config.base_url ? { baseURL: config.base_url } : {}),
    });
  }

  async sendMessage(params: SendMessageParams): Promise<LLMResponse> {
    const model = this.getModel(params.model);

    // Build messages array with system prompt
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: params.systemPrompt },
      ...params.messages.map((m) => this.toOpenAIMessage(m)),
    ];

    // Convert tools to OpenAI function calling format
    const tools: OpenAI.ChatCompletionTool[] | undefined = params.tools?.map(
      (t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }),
    );

    const response = await this.client.chat.completions.create({
      model,
      messages,
      max_tokens: params.maxTokens || 4096,
      ...(tools && tools.length > 0 ? { tools } : {}),
    });

    const choice = response.choices[0];
    if (!choice) {
      return {
        content: [],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const content: ContentBlock[] = [];

    // Map text content
    if (choice.message.content) {
      content.push({ type: "text", text: choice.message.content });
    }

    // Map tool calls
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || "{}"),
        });
      }
    }

    return {
      content,
      stopReason: this.mapStopReason(choice.finish_reason || "stop"),
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model || "gpt-4o",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hello" }],
      });
      return response.choices.length > 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.client.models.list();
      return response.data
        .filter((m) => m.id.startsWith("gpt-"))
        .map((m) => ({
          id: m.id,
          name: m.id,
          supportsTools: true,
        }));
    } catch {
      // Fallback to known models
      return [
        { id: "gpt-4o", name: "GPT-4o", supportsTools: true },
        { id: "gpt-4o-mini", name: "GPT-4o Mini", supportsTools: true },
        { id: "o1", name: "o1", supportsTools: true },
      ];
    }
  }

  private toOpenAIMessage(
    msg: Message,
  ): OpenAI.ChatCompletionMessageParam {
    if (typeof msg.content === "string") {
      return { role: msg.role as "user" | "assistant", content: msg.content };
    }

    // Handle tool results
    if (msg.role === "user") {
      for (const block of msg.content) {
        if (block.type === "tool_result") {
          return {
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
          };
        }
      }
    }

    // Handle assistant messages with tool calls
    if (msg.role === "assistant") {
      const textParts = msg.content.filter((b) => b.type === "text");
      const toolParts = msg.content.filter((b) => b.type === "tool_use");

      if (toolParts.length > 0) {
        return {
          role: "assistant",
          content: textParts.map((t) => (t as { text: string }).text).join("") || null,
          tool_calls: toolParts.map((t) => ({
            id: (t as { id: string }).id,
            type: "function" as const,
            function: {
              name: (t as { name: string }).name,
              arguments: JSON.stringify((t as { input: unknown }).input),
            },
          })),
        };
      }
    }

    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    return { role: msg.role as "user" | "assistant", content: text };
  }
}
