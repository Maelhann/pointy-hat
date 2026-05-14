import { SpellFileSchema, type SpellDefinition } from "../types/spell.js";
import { readYamlFile } from "../utils/yaml.js";
import { parseYaml } from "../utils/yaml.js";
import { E_SPELL_INVALID } from "./error-handler.js";

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// Parse a spell from a YAML file path
export async function parseSpellFile(filePath: string): Promise<SpellDefinition> {
  let raw: unknown;
  try {
    raw = await readYamlFile<unknown>(filePath);
  } catch (err) {
    throw E_SPELL_INVALID(`Cannot read file "${filePath}": ${err}`);
  }
  return parseSpellRaw(raw);
}

// Parse a spell from a YAML string
export function parseSpellContent(yamlContent: string): SpellDefinition {
  let raw: unknown;
  try {
    raw = parseYaml<unknown>(yamlContent);
  } catch (err) {
    throw E_SPELL_INVALID(`Invalid YAML syntax: ${err}`);
  }
  return parseSpellRaw(raw);
}

function parseSpellRaw(raw: unknown): SpellDefinition {
  const result = SpellFileSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw E_SPELL_INVALID(issues);
  }
  return result.data.spell;
}

// Deeper semantic validation beyond Zod schema
export function validateSpell(spell: SpellDefinition): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const stepIds = new Set(spell.steps.map((s) => s.id));
  const outputIds = new Set(spell.outputs.map((o) => o.id));
  const effectIds = new Set(spell.effects.map((e) => e.id));
  const allIds = new Set([...stepIds, ...outputIds, ...effectIds]);
  const inputIds = new Set([
    ...spell.inputs.required.map((i: { id: string }) => i.id),
    ...spell.inputs.optional.map((i: { id: string }) => i.id),
  ]);
  const catalystIds = new Set(spell.catalysts.map((c) => c.id));

  // Check for duplicate IDs across all collections
  const seenIds = new Set<string>();
  const checkDuplicate = (id: string, path: string) => {
    if (seenIds.has(id)) {
      errors.push({ path, message: `Duplicate ID "${id}" across steps, outputs, or effects`, code: "DUPLICATE_ID" });
    }
    seenIds.add(id);
  };
  spell.steps.forEach((s, i) => checkDuplicate(s.id, `steps[${i}].id`));
  spell.outputs.forEach((o, i) => checkDuplicate(o.id, `outputs[${i}].id`));
  spell.effects.forEach((e, i) => checkDuplicate(e.id, `effects[${i}].id`));

  // Validate steps
  for (let i = 0; i < spell.steps.length; i++) {
    const step = spell.steps[i];

    // Step depends_on can only reference other steps
    if (step.depends_on) {
      for (const dep of step.depends_on) {
        if (!stepIds.has(dep)) {
          errors.push({
            path: `steps[${i}].depends_on`,
            message: `Step "${step.id}" depends on unknown step "${dep}"`,
            code: "UNKNOWN_DEPENDENCY",
          });
        }
      }
    }

    if (step.inputs_needed) {
      for (const inputId of step.inputs_needed) {
        if (!inputIds.has(inputId)) {
          warnings.push({
            path: `steps[${i}].inputs_needed`,
            message: `Step "${step.id}" references unknown input "${inputId}"`,
          });
        }
      }
    }

    if (step.tools_needed) {
      for (const tool of step.tools_needed) {
        if (tool.includes("://") && !tool.startsWith("mcp://")) {
          errors.push({
            path: `steps[${i}].tools_needed`,
            message: `Invalid tool reference "${tool}" — must use "server/tool" format`,
            code: "INVALID_TOOL_REF",
          });
        }
      }
    }

    if (step.catalysts_needed) {
      for (const catId of step.catalysts_needed) {
        if (!catalystIds.has(catId)) {
          errors.push({
            path: `steps[${i}].catalysts_needed`,
            message: `Step "${step.id}" references unknown catalyst "${catId}"`,
            code: "UNKNOWN_CATALYST",
          });
        }
      }
    }

    if (step.quality_check) {
      if (step.quality_check.min_score < 0 || step.quality_check.min_score > 1) {
        errors.push({
          path: `steps[${i}].quality_check.min_score`,
          message: `min_score must be between 0 and 1, got ${step.quality_check.min_score}`,
          code: "INVALID_SCORE",
        });
      }
    }
  }

  // Validate outputs — depends_on can reference steps, outputs, or effects
  for (let i = 0; i < spell.outputs.length; i++) {
    const output = spell.outputs[i];
    if (output.depends_on) {
      for (const dep of output.depends_on) {
        if (!allIds.has(dep)) {
          errors.push({
            path: `outputs[${i}].depends_on`,
            message: `Output "${output.id}" depends on unknown ID "${dep}"`,
            code: "UNKNOWN_DEPENDENCY",
          });
        }
      }
    }
    if (output.inputs_needed) {
      for (const inputId of output.inputs_needed) {
        if (!inputIds.has(inputId)) {
          warnings.push({
            path: `outputs[${i}].inputs_needed`,
            message: `Output "${output.id}" references unknown input "${inputId}"`,
          });
        }
      }
    }
    if (output.catalysts_needed) {
      for (const catId of output.catalysts_needed) {
        if (!catalystIds.has(catId)) {
          errors.push({
            path: `outputs[${i}].catalysts_needed`,
            message: `Output "${output.id}" references unknown catalyst "${catId}"`,
            code: "UNKNOWN_CATALYST",
          });
        }
      }
    }
    if (output.quality_check) {
      if (output.quality_check.min_score < 0 || output.quality_check.min_score > 1) {
        errors.push({
          path: `outputs[${i}].quality_check.min_score`,
          message: `min_score must be between 0 and 1, got ${output.quality_check.min_score}`,
          code: "INVALID_SCORE",
        });
      }
    }
  }

  // Validate effects — depends_on can reference steps, outputs, or effects
  for (let i = 0; i < spell.effects.length; i++) {
    const effect = spell.effects[i];
    if (effect.depends_on) {
      for (const dep of effect.depends_on) {
        if (!allIds.has(dep)) {
          errors.push({
            path: `effects[${i}].depends_on`,
            message: `Effect "${effect.id}" depends on unknown ID "${dep}"`,
            code: "UNKNOWN_DEPENDENCY",
          });
        }
      }
    }
    if (effect.inputs_needed) {
      for (const inputId of effect.inputs_needed) {
        if (!inputIds.has(inputId)) {
          warnings.push({
            path: `effects[${i}].inputs_needed`,
            message: `Effect "${effect.id}" references unknown input "${inputId}"`,
          });
        }
      }
    }
    if (effect.catalysts_needed) {
      for (const catId of effect.catalysts_needed) {
        if (!catalystIds.has(catId)) {
          errors.push({
            path: `effects[${i}].catalysts_needed`,
            message: `Effect "${effect.id}" references unknown catalyst "${catId}"`,
            code: "UNKNOWN_CATALYST",
          });
        }
      }
    }
    if (effect.quality_check) {
      if (effect.quality_check.min_score < 0 || effect.quality_check.min_score > 1) {
        errors.push({
          path: `effects[${i}].quality_check.min_score`,
          message: `min_score must be between 0 and 1, got ${effect.quality_check.min_score}`,
          code: "INVALID_SCORE",
        });
      }
    }
  }

  // Validate artifact template URIs on outputs
  for (let i = 0; i < spell.outputs.length; i++) {
    const output = spell.outputs[i];
    if (output.artifact) {
      if (!output.artifact.startsWith("artifact://")) {
        errors.push({
          path: `outputs[${i}].artifact`,
          message: `Artifact template URI must start with "artifact://", got "${output.artifact}"`,
          code: "INVALID_ARTIFACT_URI",
        });
      }
    }
  }

  // Validate tool requirement URIs
  for (let i = 0; i < spell.requires.tools.length; i++) {
    const tool = spell.requires.tools[i];
    if (!tool.uri.startsWith("mcp://")) {
      errors.push({
        path: `requires.tools[${i}].uri`,
        message: `Tool URI must start with "mcp://", got "${tool.uri}"`,
        code: "INVALID_TOOL_URI",
      });
    }
  }

  // Validate catalyst URIs
  for (let i = 0; i < spell.catalysts.length; i++) {
    const catalyst = spell.catalysts[i];
    if (!catalyst.uri.startsWith("catalyst://")) {
      errors.push({
        path: `catalysts[${i}].uri`,
        message: `Catalyst URI must start with "catalyst://", got "${catalyst.uri}"`,
        code: "INVALID_CATALYST_URI",
      });
    }
  }

  // Check for circular dependencies across all items (steps + outputs + effects)
  const allSortable = [
    ...spell.steps.map((s) => ({ id: s.id, depends_on: s.depends_on })),
    ...spell.outputs.map((o) => ({ id: o.id, depends_on: o.depends_on })),
    ...spell.effects.map((e) => ({ id: e.id, depends_on: e.depends_on })),
  ];
  try {
    topologicalSort(allSortable);
  } catch {
    errors.push({
      path: "steps/outputs/effects",
      message: "Circular dependency detected across steps, outputs, and effects",
      code: "CIRCULAR_DEPENDENCY",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Kahn's algorithm for topological sort — generic over any { id, depends_on? } item
interface Sortable { id: string; depends_on?: string[] }

export function topologicalSort<T extends Sortable>(items: T[]): T[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const itemMap = new Map<string, T>();

  for (const item of items) {
    itemMap.set(item.id, item);
    inDegree.set(item.id, 0);
    adjacency.set(item.id, []);
  }

  for (const item of items) {
    if (item.depends_on) {
      for (const dep of item.depends_on) {
        if (!itemMap.has(dep)) {
          throw E_SPELL_INVALID(
            `"${item.id}" depends on unknown ID "${dep}"`,
          );
        }
        adjacency.get(dep)!.push(item.id);
        inDegree.set(item.id, (inDegree.get(item.id) || 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const result: T[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(itemMap.get(current)!);

    for (const neighbor of adjacency.get(current)!) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (result.length !== items.length) {
    throw E_SPELL_INVALID("Circular dependency detected");
  }

  return result;
}
