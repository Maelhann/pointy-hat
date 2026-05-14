import { DEFAULT_REGISTRY_URL } from "../types/config.js";
import {
  SearchResponseSchema,
  PackageDetailSchema,
  PackageVersionsSchema,
  SpellDetailSchema,
  TrendingResponseSchema,
  CategoriesResponseSchema,
  PublishResponseSchema,
  type SearchResponse,
  type SearchOptions,
  type PackageDetail,
  type PackageVersions,
  type SpellDetail,
  type TrendingResponse,
  type CategoriesResponse,
  type PublishRequest,
  type PublishResponse,
} from "../types/registry.js";
import { fetchWithTimeout } from "../utils/network.js";
import { E_REGISTRY_UNREACHABLE, E_MCP_NOT_FOUND } from "./error-handler.js";
import { Cache } from "./cache.js";

export class RegistryClient {
  private baseUrl: string;
  private timeout: number;
  private cache: Cache;
  private offline: boolean;
  private cacheTtl: number;

  constructor(options?: {
    baseUrl?: string;
    timeout?: number;
    cache?: Cache;
    offline?: boolean;
    cacheTtl?: number;
  }) {
    this.baseUrl = options?.baseUrl || DEFAULT_REGISTRY_URL;
    this.timeout = options?.timeout || 30000;
    this.cache = options?.cache || new Cache();
    this.offline = options?.offline || false;
    this.cacheTtl = options?.cacheTtl || 3600;
  }

  // ── Search ──

  async search(query: string, opts?: SearchOptions): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (opts?.category) params.set("category", opts.category);
    if (opts?.sort) params.set("sort", opts.sort);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.page) params.set("page", String(opts.page));

    const url = `${this.baseUrl}/v1/mcps/search?${params}`;
    const data = await this.cachedGet(url);
    return SearchResponseSchema.parse(data);
  }

  async searchSpells(query: string, opts?: SearchOptions & { requiresTools?: string[] }): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (opts?.category) params.set("category", opts.category);
    if (opts?.sort) params.set("sort", opts.sort);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.page) params.set("page", String(opts.page));
    if (opts?.requiresTools) params.set("requires-tools", opts.requiresTools.join(","));

    const url = `${this.baseUrl}/v1/spells/search?${params}`;
    const data = await this.cachedGet(url);
    return SearchResponseSchema.parse(data);
  }

  // ── Package ──

  async getPackage(name: string): Promise<PackageDetail> {
    const url = `${this.baseUrl}/v1/mcps/${encodeURIComponent(name)}`;
    const data = await this.cachedGet(url);
    if (!data) throw E_MCP_NOT_FOUND(name);
    return PackageDetailSchema.parse(data);
  }

  async getPackageVersions(name: string): Promise<PackageVersions> {
    const url = `${this.baseUrl}/v1/mcps/${encodeURIComponent(name)}/versions`;
    const data = await this.cachedGet(url);
    if (!data) throw E_MCP_NOT_FOUND(name);
    return PackageVersionsSchema.parse(data);
  }

  // ── Spell ──

  async getSpell(name: string, version?: string): Promise<SpellDetail> {
    const path = version
      ? `/v1/spells/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
      : `/v1/spells/${encodeURIComponent(name)}`;

    const url = `${this.baseUrl}${path}`;
    const data = await this.cachedGet(url);
    if (!data) throw E_MCP_NOT_FOUND(name);
    return SpellDetailSchema.parse(data);
  }

  // ── Trending & Categories ──

  async getTrending(opts?: { type?: string; period?: string; limit?: number }): Promise<TrendingResponse> {
    const params = new URLSearchParams();
    if (opts?.type) params.set("type", opts.type);
    if (opts?.period) params.set("period", opts.period);
    if (opts?.limit) params.set("limit", String(opts.limit));

    const qs = params.toString();
    const url = `${this.baseUrl}/v1/trending${qs ? `?${qs}` : ""}`;
    const data = await this.cachedGet(url);
    return TrendingResponseSchema.parse(data);
  }

  async getCategories(): Promise<CategoriesResponse> {
    const url = `${this.baseUrl}/v1/categories`;
    const data = await this.cachedGet(url);
    return CategoriesResponseSchema.parse(data);
  }

  // ── Publish (auth required) ──

  async publishSpell(data: PublishRequest, token: string): Promise<PublishResponse> {
    const url = `${this.baseUrl}/v1/spells`;
    const resp = await this.fetchJson(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    return PublishResponseSchema.parse(resp);
  }

  // ── Catalyst ──

  async fetchCatalyst(spellName: string, version: string, catalystId: string): Promise<string> {
    const url = `${this.baseUrl}/v1/spells/${encodeURIComponent(spellName)}/${encodeURIComponent(version)}/catalysts/${encodeURIComponent(catalystId)}`;
    const resp = await fetchWithTimeout(url, undefined, this.timeout);
    if (!resp.ok) {
      if (resp.status === 404) {
        throw E_MCP_NOT_FOUND(`catalyst ${catalystId} for spell ${spellName}@${version}`);
      }
      throw E_REGISTRY_UNREACHABLE();
    }
    return resp.text();
  }

  // ── Artifact ──

  async fetchArtifact(spellName: string, version: string, outputId: string, filename: string): Promise<string> {
    const url = `${this.baseUrl}/v1/spells/${encodeURIComponent(spellName)}/${encodeURIComponent(version)}/artifacts/${encodeURIComponent(outputId)}/${encodeURIComponent(filename)}`;
    const resp = await fetchWithTimeout(url, undefined, this.timeout);
    if (!resp.ok) {
      if (resp.status === 404) {
        throw E_MCP_NOT_FOUND(`artifact ${filename} for output ${outputId} in spell ${spellName}@${version}`);
      }
      throw E_REGISTRY_UNREACHABLE();
    }
    return resp.text();
  }

  // ── Unpublish (auth required) ──

  async unpublishSpell(name: string, version: string, token: string): Promise<void> {
    const url = `${this.baseUrl}/v1/spells/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
    const resp = await fetchWithTimeout(
      url,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
      this.timeout,
    );
    if (!resp.ok) {
      throw E_REGISTRY_UNREACHABLE();
    }
  }

  // ── Health ──

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetchWithTimeout(
        `${this.baseUrl}/health`,
        { method: "HEAD" },
        5000,
      );
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ── Internal helpers ──

  private async cachedGet(url: string): Promise<unknown> {
    const cacheKey = this.cache.getCacheKey(url);

    // Try cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache entry, fetch fresh
      }
    }

    // In offline mode, return cached data or throw
    if (this.offline) {
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {}
      }
      throw E_REGISTRY_UNREACHABLE();
    }

    // Fetch from registry
    const data = await this.fetchJson(url);

    // Cache the response
    await this.cache.set(cacheKey, JSON.stringify(data), this.cacheTtl);

    return data;
  }

  private async fetchJson(url: string, options?: RequestInit): Promise<unknown> {
    try {
      const resp = await fetchWithTimeout(url, options, this.timeout);
      if (!resp.ok) {
        if (resp.status === 404) return null;
        throw E_REGISTRY_UNREACHABLE();
      }
      return resp.json();
    } catch (err) {
      if (err instanceof Error && err.name === "PointyHatError") throw err;
      throw E_REGISTRY_UNREACHABLE();
    }
  }
}
