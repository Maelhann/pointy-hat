import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegistryClient } from "../../src/core/registry-client.js";
import { Cache } from "../../src/core/cache.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RegistryClient", () => {
  let client: RegistryClient;
  let cache: Cache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new Cache("/tmp/test-cache");
    // Mock cache to always miss
    vi.spyOn(cache, "get").mockResolvedValue(null);
    vi.spyOn(cache, "set").mockResolvedValue(undefined);
    vi.spyOn(cache, "getCacheKey").mockReturnValue("mock-key");

    client = new RegistryClient({
      baseUrl: "https://api.test.org",
      timeout: 5000,
      cache,
    });
  });

  describe("search", () => {
    it("searches with query and returns validated results", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        results: [
          { name: "test-mcp", version: "1.0.0", type: "mcp", downloads: 100, tags: [] },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }));

      const result = await client.search("test");
      expect(result.results).toHaveLength(1);
      expect(result.results[0].name).toBe("test-mcp");
      expect(result.total).toBe(1);
    });

    it("passes search options as query params", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        results: [],
        total: 0,
        page: 1,
        pageSize: 10,
      }));

      await client.search("test", { category: "dev", sort: "downloads", limit: 10, page: 2 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("q=test");
      expect(url).toContain("category=dev");
      expect(url).toContain("sort=downloads");
      expect(url).toContain("limit=10");
      expect(url).toContain("page=2");
    });
  });

  describe("getPackage", () => {
    it("returns validated package detail", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        name: "@mcp/filesystem",
        version: "2.0.0",
        description: "File system tools",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@mcp/filesystem"],
        env: {},
        platforms: [],
        tools: ["read_file", "write_file"],
        resources: [],
        versions: [{ version: "2.0.0", publishedAt: "2025-01-01" }],
      }));

      const pkg = await client.getPackage("@mcp/filesystem");
      expect(pkg.name).toBe("@mcp/filesystem");
      expect(pkg.version).toBe("2.0.0");
      expect(pkg.tools).toContain("read_file");
    });

    it("throws E_MCP_NOT_FOUND for 404 response", async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));

      await expect(client.getPackage("nonexistent")).rejects.toThrow("not found");
    });
  });

  describe("getPackageVersions", () => {
    it("returns validated versions list", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        name: "@mcp/filesystem",
        latest: "2.0.0",
        versions: [
          { version: "2.0.0", publishedAt: "2025-01-01" },
          { version: "1.5.0", publishedAt: "2024-06-01" },
        ],
      }));

      const versions = await client.getPackageVersions("@mcp/filesystem");
      expect(versions.latest).toBe("2.0.0");
      expect(versions.versions).toHaveLength(2);
    });
  });

  describe("healthCheck", () => {
    it("returns true for healthy registry", async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const result = await client.healthCheck();
      expect(result).toBe(true);
    });

    it("returns false for unreachable registry", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      const result = await client.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe("caching", () => {
    it("uses cache for repeated GET requests", async () => {
      const cachedData = JSON.stringify({
        name: "@mcp/cached",
        version: "1.0.0",
        transport: "stdio",
        args: [],
        env: {},
        platforms: [],
        tools: [],
        resources: [],
        versions: [],
      });

      vi.spyOn(cache, "get").mockResolvedValueOnce(cachedData);

      const pkg = await client.getPackage("@mcp/cached");
      expect(pkg.name).toBe("@mcp/cached");
      // fetch should not have been called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("stores fetched data in cache", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        name: "@mcp/fresh",
        version: "1.0.0",
        transport: "stdio",
        args: [],
        env: {},
        platforms: [],
        tools: [],
        resources: [],
        versions: [],
      }));

      await client.getPackage("@mcp/fresh");
      expect(cache.set).toHaveBeenCalled();
    });
  });

  describe("offline mode", () => {
    it("returns cached data in offline mode", async () => {
      const offlineClient = new RegistryClient({
        baseUrl: "https://api.test.org",
        cache,
        offline: true,
      });

      const cachedData = JSON.stringify({
        name: "@mcp/offline",
        version: "1.0.0",
        transport: "stdio",
        args: [],
        env: {},
        platforms: [],
        tools: [],
        resources: [],
        versions: [],
      });

      vi.spyOn(cache, "get").mockResolvedValueOnce(cachedData);

      const pkg = await offlineClient.getPackage("@mcp/offline");
      expect(pkg.name).toBe("@mcp/offline");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws when offline with no cache", async () => {
      const offlineClient = new RegistryClient({
        baseUrl: "https://api.test.org",
        cache,
        offline: true,
      });

      vi.spyOn(cache, "get").mockResolvedValueOnce(null);

      await expect(offlineClient.getPackage("anything")).rejects.toThrow("Cannot reach");
    });
  });
});
