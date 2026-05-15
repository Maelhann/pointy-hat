import { z } from "zod";

// Spell input (user-provided data)
export const SpellInputSchema = z.object({
  id: z.string(),
  description: z.string(),
  formats: z.array(z.string()),
});
export type SpellInput = z.infer<typeof SpellInputSchema>;

// Tool requirement
export const ToolRequirementSchema = z.object({
  uri: z.string(), // "mcp://server/tool_name"
  reason: z.string().optional(),
  optional: z.boolean().default(false),
});
export type ToolRequirement = z.infer<typeof ToolRequirementSchema>;

// Resource requirement
export const ResourceRequirementSchema = z.object({
  uri: z.string(),
});

// Quality check — semantic quality gate
export const QualityCheckSchema = z.object({
  criteria: z.string(),
  min_score: z.number().min(0).max(1),
  retry_on_failure: z.boolean().default(false),
  max_retries: z.number().default(2),
});
export type QualityCheck = z.infer<typeof QualityCheckSchema>;

// Ward — extends quality check with deterministic verification options
export const WardSchema = QualityCheckSchema.extend({
  /** Shell command that must exit 0 to pass */
  verify_command: z.string().optional(),
  /** File paths that must exist */
  verify_file_exists: z.array(z.string()).optional(),
  /** Regex pattern the output must match */
  verify_pattern: z.string().optional(),
});
export type Ward = z.infer<typeof WardSchema>;

/** Accept both `quality_check` and `ward` keys, mapping to the same schema */
const QualityOrWardSchema = z.union([QualityCheckSchema, WardSchema]).optional();

// Artifact template URI — points to a single self-contained template file
// The template contains @begin:ID / @end:ID markers with inline prompts and quality checks
export const ArtifactTemplateSchema = z.string(); // "artifact://spell-name/filename"
export type ArtifactTemplate = z.infer<typeof ArtifactTemplateSchema>;

// Catalyst — packaged reference data that ships with the spell
export const SpellCatalystSchema = z.object({
  id: z.string(),
  description: z.string(),
  uri: z.string(), // "catalyst://spell-name/filename"
  type: z.enum(["reference", "template", "data"]),
});
export type SpellCatalyst = z.infer<typeof SpellCatalystSchema>;

// Spell step
export const SpellStepSchema = z.object({
  id: z.string(),
  instruction: z.string(),
  depends_on: z.array(z.string()).optional(),
  tools_needed: z.array(z.string()).optional(),
  inputs_needed: z.array(z.string()).optional(),
  catalysts_needed: z.array(z.string()).optional(),
  optional: z.boolean().default(false),
  timeout: z.number().optional(), // seconds
  quality_check: QualityCheckSchema.optional(),
  ward: WardSchema.optional(),
}).transform((step) => ({
  ...step,
  quality_check: step.quality_check ?? step.ward,
}));
export type SpellStep = z.infer<typeof SpellStepSchema>;

// Spell output — first-class outcome declaration
export const SpellOutputSchema = z.object({
  id: z.string(),
  type: z.enum(["document", "data", "code", "image"]),
  format: z.array(z.string()),
  description: z.string().optional(),
  acceptance_criteria: z.string().optional(),
  depends_on: z.array(z.string()).optional(),
  inputs_needed: z.array(z.string()).optional(),
  catalysts_needed: z.array(z.string()).optional(),
  quality_check: QualityCheckSchema.optional(),
  ward: WardSchema.optional(),
  artifact: ArtifactTemplateSchema.optional(),
}).transform((output) => ({
  ...output,
  quality_check: output.quality_check ?? output.ward,
}));
export type SpellOutput = z.infer<typeof SpellOutputSchema>;

// Spell effect — postcondition / state change
export const SpellEffectSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  verification: z.string().optional(),
  depends_on: z.array(z.string()).optional(),
  inputs_needed: z.array(z.string()).optional(),
  catalysts_needed: z.array(z.string()).optional(),
  quality_check: QualityCheckSchema.optional(),
  ward: WardSchema.optional(),
}).transform((effect) => ({
  ...effect,
  quality_check: effect.quality_check ?? effect.ward,
}));
export type SpellEffect = z.infer<typeof SpellEffectSchema>;

// Spell metadata
export const SpellMetadataSchema = z.object({
  min_pointyhat_version: z.string().optional(),
  estimated_duration: z.string().optional(),
  category: z.string().optional(),
});
export type SpellMetadata = z.infer<typeof SpellMetadataSchema>;

// Full spell definition (inside the spell: key)
export const SpellDefinitionSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  license: z.string().optional(),
  tags: z.array(z.string()).default([]),
  card: z.string().optional(),

  inputs: z.object({
    required: z.array(SpellInputSchema).default([]),
    optional: z.array(SpellInputSchema).default([]),
  }),

  catalysts: z.array(SpellCatalystSchema).default([]),

  requires: z.object({
    tools: z.array(ToolRequirementSchema).default([]),
    resources: z.array(ResourceRequirementSchema).default([]),
  }),

  steps: z.array(SpellStepSchema).default([]),

  outputs: z.array(SpellOutputSchema).default([]),

  effects: z.array(SpellEffectSchema).default([]),

  metadata: SpellMetadataSchema.default({}),
}).refine(
  (r) => r.outputs.length > 0 || r.effects.length > 0 || r.steps.length > 0,
  { message: "Spell must define at least one output, effect, or step" },
);
export type SpellDefinition = z.infer<typeof SpellDefinitionSchema>;

// The root of a spell.yaml file has a top-level `spell:` key
export const SpellFileSchema = z.object({
  spell: SpellDefinitionSchema,
});
export type SpellFile = z.infer<typeof SpellFileSchema>;
