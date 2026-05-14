import { z } from "zod";

// ── Search ──

export const SearchOptionsSchema = z.object({
  category: z.string().optional(),
  sort: z.enum(["relevance", "downloads", "rating", "newest"]).optional(),
  limit: z.number().min(1).max(100).optional(),
  page: z.number().min(1).optional(),
});
export type SearchOptions = z.infer<typeof SearchOptionsSchema>;

export const SearchResultSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  type: z.enum(["mcp", "spell"]),
  downloads: z.number().default(0),
  rating: z.number().optional(),
  tags: z.array(z.string()).default([]),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ── Package Detail ──

export const PackageVersionEntrySchema = z.object({
  version: z.string(),
  publishedAt: z.string(),
  integrity: z.string().optional(),
});
export type PackageVersionEntry = z.infer<typeof PackageVersionEntrySchema>;

export const PackageDetailSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  transport: z.enum(["stdio", "sse", "http"]).default("stdio"),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  platforms: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  resources: z.array(z.string()).default([]),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  downloads: z.number().optional(),
  rating: z.number().optional(),
  versions: z.array(PackageVersionEntrySchema).default([]),
});
export type PackageDetail = z.infer<typeof PackageDetailSchema>;

// ── Package Versions ──

export const PackageVersionsSchema = z.object({
  name: z.string(),
  latest: z.string(),
  versions: z.array(PackageVersionEntrySchema),
});
export type PackageVersions = z.infer<typeof PackageVersionsSchema>;

// ── Spell Detail ──

export const SpellDetailSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().default(""),
  author: z.string().default("unknown"),
  license: z.string().optional(),
  tags: z.array(z.string()).default([]),
  card: z.string().optional(),
  downloads: z.number().optional(),
  rating: z.number().optional(),
  requiredMcps: z.array(z.string()).default([]),
  publishedAt: z.string().optional(),
  catalysts: z.array(z.object({
    id: z.string(),
    description: z.string(),
    type: z.enum(["reference", "template", "data"]),
  })).default([]),
  // Full spell data (available when fetching by name/version)
  inputs: z.object({
    required: z.array(z.any()).default([]),
    optional: z.array(z.any()).default([]),
  }).optional(),
  requires: z.object({
    tools: z.array(z.any()).default([]),
    resources: z.array(z.any()).default([]),
  }).optional(),
  steps: z.array(z.any()).optional(),
  outputs: z.array(z.any()).optional(),
  effects: z.array(z.any()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type SpellDetail = z.infer<typeof SpellDetailSchema>;

// ── Trending ──

export const TrendingItemSchema = z.object({
  name: z.string(),
  type: z.enum(["mcp", "spell"]),
  version: z.string(),
  description: z.string().optional(),
  downloads: z.number().default(0),
  rating: z.number().optional(),
  trend: z.number().optional(), // trend score / change
});
export type TrendingItem = z.infer<typeof TrendingItemSchema>;

export const TrendingResponseSchema = z.object({
  items: z.array(TrendingItemSchema),
  period: z.string(),
});
export type TrendingResponse = z.infer<typeof TrendingResponseSchema>;

// ── Categories ──

export const CategorySchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  count: z.number().default(0),
});
export type Category = z.infer<typeof CategorySchema>;

export const CategoriesResponseSchema = z.object({
  categories: z.array(CategorySchema),
});
export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;

// ── Publish ──

export const PublishCatalystSchema = z.object({
  id: z.string(),
  description: z.string(),
  uri: z.string(),
  type: z.enum(["reference", "template", "data"]),
  content: z.string(), // raw content of the catalyst file
  integrity: z.string(), // sha512 hash of content
});
export type PublishCatalyst = z.infer<typeof PublishCatalystSchema>;

export const PublishArtifactSchema = z.object({
  id: z.string(),
  outputId: z.string(),
  content: z.string(),
  integrity: z.string(),
});
export type PublishArtifact = z.infer<typeof PublishArtifactSchema>;

export const PublishRequestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  license: z.string().optional(),
  tags: z.array(z.string()).default([]),
  card: z.string().optional(),
  access: z.enum(["public", "private"]).default("public"),
  integrity: z.string(),
  requiredMcps: z.array(z.string()).default([]),
  spellYaml: z.string(), // the raw YAML content
  catalysts: z.array(PublishCatalystSchema).default([]),
  artifacts: z.array(PublishArtifactSchema).default([]),
});
export type PublishRequest = z.infer<typeof PublishRequestSchema>;

export const PublishResponseSchema = z.object({
  name: z.string(),
  version: z.string(),
  publishedAt: z.string(),
  url: z.string().optional(),
});
export type PublishResponse = z.infer<typeof PublishResponseSchema>;

// ── Errors ──

export const RegistryErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type RegistryError = z.infer<typeof RegistryErrorSchema>;
