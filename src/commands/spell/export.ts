import type { Command } from "commander";
import { resolve } from "node:path";
import { ConfigManager } from "../../core/config-manager.js";
import { RegistryClient } from "../../core/registry-client.js";
import { Cache } from "../../core/cache.js";
import { SpellbookManager } from "../../core/spellbook-manager.js";
import { parseSpellFile } from "../../core/spell-parser.js";
import { topologicalSort } from "../../core/spell-parser.js";
import { handleError } from "../../core/error-handler.js";
import { formatWarning } from "../../ui/format.js";
import { stringifyYaml } from "../../utils/yaml.js";
import { writeFile, listFiles } from "../../utils/fs.js";
import chalk from "chalk";

export function registerSpellExportCommand(spellCmd: Command): void {
  spellCmd
    .command("export <name>")
    .description("Export a spell in different formats")
    .option("--format <format>", "Output format: yaml, json, prompt", "yaml")
    .option("--output <path>", "Write to file instead of stdout")
    .action(async (name: string, opts: { format: string; output?: string }) => {
      try {
        // Try to find spell: local file first, then spellbook, then registry
        let spell = await findSpell(name);

        if (!spell) {
          console.log(formatWarning(`Spell "${name}" not found locally or in spellbook.`));
          process.exit(1);
          return;
        }

        let output: string;

        switch (opts.format) {
          case "yaml":
            output = stringifyYaml({ spell });
            break;

          case "json":
            output = JSON.stringify({ spell }, null, 2) + "\n";
            break;

          case "prompt":
            output = generateFlatPrompt(spell);
            break;

          default:
            console.log(formatWarning(`Unknown format "${opts.format}". Use yaml, json, or prompt.`));
            process.exit(1);
            return;
        }

        if (opts.output) {
          await writeFile(resolve(opts.output), output);
          console.log(chalk.dim(`Exported to ${opts.output}`));
        } else {
          process.stdout.write(output);
        }

        if (opts.format === "prompt") {
          console.error(
            chalk.yellow(
              "\nNote: Flat prompt mode loses quality gates and step dependency guarantees. " +
              "Use `pointyhat spell cast` for full orchestration.",
            ),
          );
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}

async function findSpell(name: string) {
  // 1. Try local .spell.yaml files
  const files = await listFiles(process.cwd(), ".spell.yaml");
  for (const file of files) {
    try {
      const spell = await parseSpellFile(resolve(process.cwd(), file));
      if (spell.name === name) return spell;
    } catch {
      // Skip
    }
  }

  // 2. Try spellbook
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
    const spell = await spellbook.get(name);
    if (spell) return spell;
  } catch {
    // Spellbook unavailable
  }

  return null;
}

function generateFlatPrompt(spell: import("../../types/spell.js").SpellDefinition): string {
  const sortedSteps = topologicalSort(spell.steps);
  const lines: string[] = [];

  lines.push(`You are casting the spell "${spell.name}" v${spell.version}.`);
  lines.push(`${spell.description}`);
  lines.push("");
  lines.push("Follow these steps in order:");
  lines.push("");

  for (let i = 0; i < sortedSteps.length; i++) {
    const step = sortedSteps[i];
    lines.push(`## Step ${i + 1}: ${step.id}`);
    lines.push(step.instruction.trim());

    if (step.inputs_needed && step.inputs_needed.length > 0) {
      lines.push(`[Inputs needed: ${step.inputs_needed.join(", ")}]`);
    }

    if (step.quality_check) {
      lines.push(`[Quality criteria: ${step.quality_check.criteria.trim()}]`);
    }

    lines.push("");
  }

  // Required inputs
  if (spell.inputs.required.length > 0) {
    lines.push("## Required Inputs");
    for (const input of spell.inputs.required) {
      lines.push(`- **${input.id}**: ${input.description} (formats: ${input.formats.join(", ")})`);
    }
    lines.push("");
  }

  // Optional inputs
  if (spell.inputs.optional.length > 0) {
    lines.push("## Optional Inputs");
    for (const input of spell.inputs.optional) {
      lines.push(`- **${input.id}**: ${input.description} (formats: ${input.formats.join(", ")})`);
    }
    lines.push("");
  }

  // Available tools
  if (spell.requires.tools.length > 0) {
    lines.push("## Available Tools");
    for (const tool of spell.requires.tools) {
      const optional = tool.optional ? " (optional)" : "";
      lines.push(`- ${tool.uri}: ${tool.reason || "No description"}${optional}`);
    }
    lines.push("");
  }

  // Outputs
  if (spell.outputs.length > 0) {
    lines.push("## Expected Outputs");
    for (const output of spell.outputs) {
      lines.push(`- **${output.id}** (${output.type}): ${output.format.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
