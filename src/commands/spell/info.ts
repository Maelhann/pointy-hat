import type { Command } from "commander";
import { resolve } from "node:path";
import { ConfigManager } from "../../core/config-manager.js";
import { RegistryClient } from "../../core/registry-client.js";
import { Cache } from "../../core/cache.js";
import { SpellbookManager } from "../../core/spellbook-manager.js";
import { parseSpellFile } from "../../core/spell-parser.js";
import { handleError } from "../../core/error-handler.js";
import { keyValueTable } from "../../ui/table.js";
import { formatWarning, printResult } from "../../ui/format.js";
import { listFiles } from "../../utils/fs.js";
import type { SpellDefinition } from "../../types/spell.js";
import chalk from "chalk";

export function registerSpellInfoCommand(spellCmd: Command): void {
  spellCmd
    .command("info <name>")
    .description("Show detailed information about a spell")
    .option("--version <v>", "Specific version")
    .option("--json", "Output as JSON")
    .action(async (name: string, opts: { version?: string; json?: boolean }) => {
      try {
        let spell: SpellDefinition | null = null;
        let source = "local";

        // 1. Try local .spell.yaml files
        const files = await listFiles(process.cwd(), ".spell.yaml");
        for (const file of files) {
          try {
            const parsed = await parseSpellFile(resolve(process.cwd(), file));
            if (parsed.name === name) {
              spell = parsed;
              break;
            }
          } catch {
            // Skip
          }
        }

        // 2. Try spellbook
        if (!spell) {
          try {
            const configManager = new ConfigManager();
            const userConfig = await configManager.loadUserConfig();
            const cache = new Cache(userConfig.cache?.directory);
            const registryClient = new RegistryClient({
              baseUrl: userConfig.registry?.url,
              timeout: userConfig.registry?.timeout,
              cache,
              cacheTtl: userConfig.cache?.ttl,
            });
            const spellbook = new SpellbookManager(configManager, registryClient);
            spell = await spellbook.get(name);
            if (spell) source = "spellbook";
          } catch {
            // Spellbook unavailable
          }
        }

        // 3. Try registry
        if (!spell) {
          try {
            const configManager = new ConfigManager();
            const userConfig = await configManager.loadUserConfig();
            const cache = new Cache(userConfig.cache?.directory);
            const registryClient = new RegistryClient({
              baseUrl: userConfig.registry?.url,
              timeout: userConfig.registry?.timeout,
              cache,
              cacheTtl: userConfig.cache?.ttl,
            });
            const detail = await registryClient.getSpell(name, opts.version);
            spell = {
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
            source = "registry";
          } catch {
            // Not in registry
          }
        }

        if (!spell) {
          console.log(formatWarning(`Spell "${name}" not found locally, in spellbook, or in registry.`));
          process.exit(1);
          return;
        }

        if (opts.json) {
          printResult({ spell, source }, "json");
          return;
        }

        console.log(`\n${chalk.bold(spell.name)} ${chalk.dim(`v${spell.version}`)} ${chalk.dim(`(${source})`)}\n`);

        const details: Record<string, string> = {
          Description: spell.description,
          Author: spell.author,
        };

        if (spell.license) details["License"] = spell.license;
        if (spell.tags.length > 0) details["Tags"] = spell.tags.join(", ");
        if (spell.metadata.category) details["Category"] = spell.metadata.category;
        if (spell.metadata.estimated_duration) details["Est. Duration"] = spell.metadata.estimated_duration;

        console.log(keyValueTable(details));

        // Card
        if (spell.card) {
          console.log(chalk.bold("\nCard:"));
          console.log(chalk.dim(spell.card.trim()));
        }

        // Outputs (shown first - outcome-centric)
        if (spell.outputs.length > 0) {
          console.log(chalk.bold("\nOutputs:"));
          for (const output of spell.outputs) {
            const out = output as Record<string, unknown>;
            console.log(`  - ${chalk.bold(out.id as string)} (${out.type as string}): ${(out.format as string[]).join(", ")}`);
            if (out.description) {
              console.log(`    ${chalk.dim(out.description as string)}`);
            }
            if (out.acceptance_criteria) {
              console.log(`    ${chalk.cyan("Acceptance:")} ${chalk.dim(out.acceptance_criteria as string)}`);
            }
            if (out.quality_check) {
              console.log(`    ${chalk.yellow("[quality-check]")} ${chalk.dim((out.quality_check as Record<string, unknown>).criteria as string)}`);
            }
            if (out.artifact) {
              console.log(`    ${chalk.magenta("[artifact-template]")} ${chalk.dim(out.artifact as string)}`);
            }
          }
        }

        // Effects
        const effects = (spell as Record<string, unknown>).effects as Array<Record<string, unknown>> | undefined;
        if (effects && effects.length > 0) {
          console.log(chalk.bold("\nEffects:"));
          for (const effect of effects) {
            console.log(`  - ${chalk.bold(effect.id as string)} (${effect.type as string}): ${effect.description as string}`);
            if (effect.verification) {
              console.log(`    ${chalk.cyan("Verification:")} ${chalk.dim(effect.verification as string)}`);
            }
            if (effect.quality_check) {
              console.log(`    ${chalk.yellow("[quality-check]")} ${chalk.dim((effect.quality_check as Record<string, unknown>).criteria as string)}`);
            }
          }
        }

        // Guidance Steps (only if steps exist)
        if (spell.steps.length > 0) {
          console.log(chalk.bold("\nGuidance Steps:"));
          for (let i = 0; i < spell.steps.length; i++) {
            const step = spell.steps[i];
            const firstLine = step.instruction.trim().split("\n")[0];
            const qc = step.quality_check ? chalk.yellow(" [quality-check]") : "";
            const optional = step.optional ? chalk.dim(" (optional)") : "";
            console.log(`  ${i + 1}. ${chalk.bold(step.id)}: ${chalk.dim(firstLine)}${qc}${optional}`);
          }
        }

        // Required inputs
        if (spell.inputs.required.length > 0) {
          console.log(chalk.bold("\nRequired Inputs:"));
          for (const input of spell.inputs.required) {
            console.log(`  - ${chalk.bold(input.id)}: ${input.description} ${chalk.dim(`(${input.formats.join(", ")})`)}`);
          }
        }

        // Required tools
        if (spell.requires.tools.length > 0) {
          console.log(chalk.bold("\nRequired Tools:"));
          for (const tool of spell.requires.tools) {
            const optional = tool.optional ? chalk.dim(" (optional)") : "";
            console.log(`  - ${tool.uri}${optional}${tool.reason ? `: ${chalk.dim(tool.reason)}` : ""}`);
          }
        }

        console.log("");
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}
