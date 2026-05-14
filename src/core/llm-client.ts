import type { ProviderId, ProviderConfig } from "../types/config.js";
import type {
  LLMProviderInterface,
  LLMResponse,
  ModelInfo,
  SendMessageParams,
} from "../types/provider.js";
import type { ConfigManager } from "./config-manager.js";
import { E_PROVIDER_NOT_CONFIGURED, E_PROVIDER_AUTH_FAILED } from "./error-handler.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OpenAIProvider } from "../providers/openai.js";
import { GoogleProvider } from "../providers/google.js";
import { OllamaProvider } from "../providers/ollama.js";

export class LLMClient {
  private providers = new Map<ProviderId, LLMProviderInterface>();
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
  }

  registerProvider(provider: LLMProviderInterface): void {
    this.providers.set(provider.id, provider);
  }

  async getProvider(id?: ProviderId): Promise<LLMProviderInterface> {
    const providerId = id || (await this.configManager.getDefaultProviderId());
    if (!providerId) throw E_PROVIDER_NOT_CONFIGURED();

    const cached = this.providers.get(providerId);
    if (cached) return cached;

    // Lazy-initialize provider
    const config = await this.configManager.getProvider(providerId);
    if (!config) throw E_PROVIDER_NOT_CONFIGURED();

    const provider = createProviderInstance(providerId, config);
    this.providers.set(providerId, provider);
    return provider;
  }

  async sendMessage(params: SendMessageParams): Promise<LLMResponse> {
    const provider = await this.getProvider(params.providerId);
    return provider.sendMessage(params);
  }

  async testConnection(
    providerId?: ProviderId,
  ): Promise<{ success: boolean; model: string; latencyMs: number; providerName: string }> {
    const provider = await this.getProvider(providerId);
    const config = await this.configManager.getProvider(provider.id);

    const start = Date.now();
    try {
      const success = await provider.testConnection();
      return {
        success,
        model: config?.model || "unknown",
        latencyMs: Date.now() - start,
        providerName: provider.name,
      };
    } catch {
      return {
        success: false,
        model: config?.model || "unknown",
        latencyMs: Date.now() - start,
        providerName: provider.name,
      };
    }
  }

  async listModels(providerId?: ProviderId): Promise<ModelInfo[]> {
    const provider = await this.getProvider(providerId);
    return provider.listModels();
  }
}

function createProviderInstance(
  id: ProviderId,
  config: ProviderConfig,
): LLMProviderInterface {
  switch (id) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "openai":
      return new OpenAIProvider(config);
    case "google":
      return new GoogleProvider(config);
    case "ollama":
      return new OllamaProvider(config);
    default:
      throw new Error(`Unknown provider: ${id}`);
  }
}

export async function createLLMClient(
  configManager: ConfigManager,
): Promise<LLMClient> {
  return new LLMClient(configManager);
}
