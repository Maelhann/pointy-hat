import type { Command } from "commander";
import { ConfigManager } from "../core/config-manager.js";
import { LLMClient, createLLMClient } from "../core/llm-client.js";
import { handleError, E_PROVIDER_NOT_CONFIGURED } from "../core/error-handler.js";
import { PROVIDER_IDS, type ProviderId } from "../types/config.js";
import { formatSuccess, formatWarning } from "../ui/format.js";
import { withSpinner } from "../ui/spinner.js";
import { printTable } from "../ui/table.js";
import { select, input, password } from "../ui/prompt.js";
import chalk from "chalk";

const PROVIDER_CHOICES = [
  { name: "Anthropic (Claude)", value: "anthropic" as const, description: "Claude Sonnet, Opus, Haiku" },
  { name: "OpenAI (GPT)", value: "openai" as const, description: "GPT-4o, o1, o3" },
  { name: "Google (Gemini)", value: "google" as const, description: "Gemini 2.0 Flash, Pro" },
  { name: "Ollama (Local)", value: "ollama" as const, description: "Local models, no API key needed" },
];

const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-4-5-20250514",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  ollama: "llama3.1",
};

export function registerProviderCommand(program: Command): void {
  const provider = program
    .command("provider")
    .description("Manage LLM providers for spell casting");

  provider
    .command("setup")
    .description("Interactive provider setup")
    .action(async () => {
      try {
        const mgr = new ConfigManager();

        // 1. Pick provider
        const providerId = await select<ProviderId>(
          "Which LLM provider do you use?",
          PROVIDER_CHOICES,
        );

        // 2. Get API key (unless ollama)
        let apiKey: string | undefined;
        if (providerId !== "ollama") {
          apiKey = await password(`Enter your ${PROVIDER_CHOICES.find((p) => p.value === providerId)!.name} API key:`);
          if (!apiKey) {
            console.log(formatWarning("No API key provided. You can set it later with `pointyhat provider set`."));
            return;
          }
        }

        // 3. Get base URL for ollama or OpenAI-compatible
        let baseUrl: string | undefined;
        if (providerId === "ollama") {
          baseUrl = await input("Ollama base URL:", "http://localhost:11434");
        }

        // 4. Default model
        const model = await input("Default model:", DEFAULT_MODELS[providerId]);

        // 5. Save config
        await mgr.set(`provider.${providerId}.model`, model);
        if (apiKey) {
          await mgr.set(`provider.${providerId}.api_key`, apiKey);
        }
        if (baseUrl) {
          await mgr.set(`provider.${providerId}.base_url`, baseUrl);
        }
        await mgr.set("provider.default", providerId);

        // 6. Test connection
        const result = await withSpinner("Testing connection...", async () => {
          const client = await createLLMClient(mgr);
          return client.testConnection(providerId);
        });

        if (result.success) {
          console.log(
            formatSuccess(
              `${result.providerName} connected! Model: ${chalk.bold(result.model)}, latency: ${result.latencyMs}ms`,
            ),
          );
          console.log(
            chalk.dim("\nTry: pointyhat cast code-review --input-file main.py\n"),
          );
        } else {
          console.log(
            formatWarning(
              "Connection test failed. Check your API key and try again.",
            ),
          );
        }
      } catch (err) {
        handleError(err);
      }
    });

  provider
    .command("list")
    .description("List configured providers")
    .action(async () => {
      try {
        const mgr = new ConfigManager();
        const config = await mgr.loadUserConfig();
        const defaultId = config.provider?.default;

        const rows: string[][] = [];
        for (const id of PROVIDER_IDS) {
          const provConf = config.provider?.[id as keyof typeof config.provider];
          if (provConf && typeof provConf === "object") {
            const conf = provConf as Record<string, unknown>;
            const isDefault = id === defaultId;
            rows.push([
              isDefault ? chalk.green(`* ${id}`) : `  ${id}`,
              String(conf.model || "-"),
              conf.api_key ? chalk.green("configured") : chalk.dim("not set"),
            ]);
          }
        }

        if (rows.length === 0) {
          console.log(chalk.dim("No providers configured. Run `pointyhat provider setup`."));
        } else {
          printTable(["Provider", "Model", "API Key"], rows);
        }
      } catch (err) {
        handleError(err);
      }
    });

  provider
    .command("set <provider>")
    .description("Configure a provider")
    .option("--api-key <key>", "API key")
    .option("--model <model>", "Default model")
    .option("--base-url <url>", "Base URL (for OpenAI-compatible endpoints)")
    .action(async (providerId: string, opts: { apiKey?: string; model?: string; baseUrl?: string }) => {
      try {
        if (!PROVIDER_IDS.includes(providerId as ProviderId)) {
          console.log(formatWarning(`Unknown provider "${providerId}". Valid: ${PROVIDER_IDS.join(", ")}`));
          return;
        }
        const mgr = new ConfigManager();
        if (opts.apiKey) await mgr.set(`provider.${providerId}.api_key`, opts.apiKey);
        if (opts.model) await mgr.set(`provider.${providerId}.model`, opts.model);
        if (opts.baseUrl) await mgr.set(`provider.${providerId}.base_url`, opts.baseUrl);
        console.log(formatSuccess(`Updated ${providerId} configuration.`));
      } catch (err) {
        handleError(err);
      }
    });

  provider
    .command("use <provider>")
    .description("Set the active/default provider")
    .action(async (providerId: string) => {
      try {
        if (!PROVIDER_IDS.includes(providerId as ProviderId)) {
          console.log(formatWarning(`Unknown provider "${providerId}". Valid: ${PROVIDER_IDS.join(", ")}`));
          return;
        }
        const mgr = new ConfigManager();
        await mgr.set("provider.default", providerId);
        console.log(formatSuccess(`Default provider set to ${chalk.bold(providerId)}.`));
      } catch (err) {
        handleError(err);
      }
    });

  provider
    .command("test [provider]")
    .description("Test provider connection")
    .action(async (providerId?: string) => {
      try {
        const mgr = new ConfigManager();
        const result = await withSpinner("Testing connection...", async () => {
          const client = await createLLMClient(mgr);
          return client.testConnection(providerId as ProviderId | undefined);
        });

        if (result.success) {
          console.log(
            formatSuccess(
              `${result.providerName} is working. Model: ${chalk.bold(result.model)}, latency: ${result.latencyMs}ms`,
            ),
          );
        } else {
          console.log(formatWarning(`Connection to ${result.providerName} failed.`));
        }
      } catch (err) {
        handleError(err);
      }
    });
}
