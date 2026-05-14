import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content, Part, FunctionDeclarationsTool, FunctionDeclarationSchema } from "@google/generative-ai";
import { BaseLLMProvider } from "./base.js";
import type { ProviderId, ProviderConfig } from "../types/config.js";
import type {
  LLMResponse,
  ModelInfo,
  SendMessageParams,
  ContentBlock,
  Message,
} from "../types/provider.js";

export class GoogleProvider extends BaseLLMProvider {
  id: ProviderId = "google";
  name = "Google (Gemini)";
  private client: GoogleGenerativeAI;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new GoogleGenerativeAI(this.getApiKey());
  }

  async sendMessage(params: SendMessageParams): Promise<LLMResponse> {
    const modelId = this.getModel(params.model);
    const model = this.client.getGenerativeModel({ model: modelId });

    // Convert messages to Gemini Content format
    const contents: Content[] = params.messages.map((m) =>
      this.toGeminiContent(m),
    );

    // Convert tools to Gemini function declarations format
    const tools: FunctionDeclarationsTool[] | undefined =
      params.tools && params.tools.length > 0
        ? [
            {
              functionDeclarations: params.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.input_schema as unknown as FunctionDeclarationSchema,
              })),
            },
          ]
        : undefined;

    const response = await model.generateContent({
      contents,
      systemInstruction: params.systemPrompt,
      ...(tools ? { tools } : {}),
      generationConfig: {
        maxOutputTokens: params.maxTokens || 4096,
      },
    });

    const result = response.response;
    const candidate = result.candidates?.[0];

    if (!candidate) {
      return {
        content: [],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    // Map response parts to our content block format
    const content: ContentBlock[] = [];
    const parts = candidate.content?.parts || [];
    let hasFunctionCalls = false;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.text !== undefined && part.text !== null) {
        content.push({ type: "text", text: part.text });
      }
      if (part.functionCall) {
        hasFunctionCalls = true;
        content.push({
          type: "tool_use",
          id: `call_${i}`,
          name: part.functionCall.name,
          input: (part.functionCall.args as Record<string, unknown>) || {},
        });
      }
    }

    // Map finish reason
    const finishReason = candidate.finishReason;
    let stopReason: LLMResponse["stopReason"];
    if (finishReason === "STOP") {
      stopReason = "end_turn";
    } else if (finishReason === "MAX_TOKENS") {
      stopReason = "max_tokens";
    } else if (hasFunctionCalls) {
      stopReason = "tool_use";
    } else {
      stopReason = "end_turn";
    }

    // Extract usage metadata
    const usageMetadata = result.usageMetadata;

    return {
      content,
      stopReason,
      usage: {
        inputTokens: usageMetadata?.promptTokenCount || 0,
        outputTokens: usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const modelId = this.config.model || "gemini-2.0-flash";
      const model = this.client.getGenerativeModel({ model: modelId });
      const response = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        generationConfig: { maxOutputTokens: 10 },
      });
      const candidate = response.response.candidates?.[0];
      return !!candidate?.content?.parts?.length;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        contextWindow: 1048576,
        supportsTools: true,
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        contextWindow: 1048576,
        supportsTools: true,
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        contextWindow: 1048576,
        supportsTools: true,
      },
      {
        id: "gemini-2.0-pro",
        name: "Gemini 2.0 Pro",
        contextWindow: 1048576,
        supportsTools: true,
      },
    ];
  }

  private toGeminiContent(msg: Message): Content {
    // Gemini uses "user" and "model" roles (not "assistant")
    const role = msg.role === "assistant" ? "model" : "user";

    if (typeof msg.content === "string") {
      return { role, parts: [{ text: msg.content }] };
    }

    // Map content blocks to Gemini parts
    const parts: Part[] = [];

    for (const block of msg.content) {
      if (block.type === "text") {
        parts.push({ text: block.text });
      }
      if (block.type === "tool_use") {
        parts.push({
          functionCall: {
            name: block.name,
            args: block.input,
          },
        });
      }
      if (block.type === "tool_result") {
        parts.push({
          functionResponse: {
            name: block.tool_use_id,
            response: { result: block.content },
          },
        });
      }
    }

    // Ensure at least one part exists
    if (parts.length === 0) {
      parts.push({ text: "" });
    }

    return { role, parts };
  }
}
