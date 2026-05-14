import type { ProviderId, ProviderConfig } from "../types/config.js";
import type {
  LLMProviderInterface,
  LLMResponse,
  ModelInfo,
  SendMessageParams,
} from "../types/provider.js";

export abstract class BaseLLMProvider implements LLMProviderInterface {
  abstract id: ProviderId;
  abstract name: string;

  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  abstract sendMessage(params: SendMessageParams): Promise<LLMResponse>;
  abstract testConnection(): Promise<boolean>;
  abstract listModels(): Promise<ModelInfo[]>;

  protected getModel(override?: string): string {
    return override || this.config.model;
  }

  protected getApiKey(): string {
    if (!this.config.api_key) {
      throw new Error(`No API key configured for ${this.name}`);
    }
    return this.config.api_key;
  }

  protected mapStopReason(
    providerReason: string,
  ): LLMResponse["stopReason"] {
    switch (providerReason) {
      case "end_turn":
      case "stop":
        return "end_turn";
      case "tool_use":
      case "tool_calls":
        return "tool_use";
      case "max_tokens":
      case "length":
        return "max_tokens";
      default:
        return "end_turn";
    }
  }
}
