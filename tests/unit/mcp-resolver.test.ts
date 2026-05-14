import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolvePackage, resolveVersion, buildInstallSpec } from "../../src/core/mcp-resolver.js";
import { RegistryClient } from "../../src/core/registry-client.js";

describe("mcp-resolver", () => {
  let mockClient: RegistryClient;

  beforeEach(() => {
    mockClient = {
      getPackage: vi.fn(),
      getPackageVersions: vi.fn(),
    } as unknown as RegistryClient;
  });

  describe("resolvePackage", () => {
    it("resolves a package from registry", async () => {
      vi.mocked(mockClient.getPackage).mockResolvedValueOnce({
        name: "@mcp/filesystem",
        version: "2.0.0",
        description: "File system tools",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@mcp/filesystem"],
        env: { HOME: "/home/user" },
        platforms: ["cursor", "claude-desktop"],
        tools: ["read_file", "write_file"],
        resources: [],
        versions: [
          { version: "2.0.0", publishedAt: "2025-01-01", integrity: "sha512-abc" },
        ],
      });

      const resolved = await resolvePackage("@mcp/filesystem", mockClient);

      expect(resolved.name).toBe("@mcp/filesystem");
      expect(resolved.version).toBe("2.0.0");
      expect(resolved.command).toBe("npx");
      expect(resolved.args).toEqual(["-y", "@mcp/filesystem"]);
      expect(resolved.env).toEqual({ HOME: "/home/user" });
      expect(resolved.transport).toBe("stdio");
      expect(resolved.integrity).toBe("sha512-abc");
    });

    it("defaults to npx command when none specified", async () => {
      vi.mocked(mockClient.getPackage).mockResolvedValueOnce({
        name: "my-mcp",
        version: "1.0.0",
        transport: "stdio",
        args: [],
        env: {},
        platforms: [],
        tools: [],
        resources: [],
        versions: [],
      });

      const resolved = await resolvePackage("my-mcp", mockClient);
      expect(resolved.command).toBe("npx");
      expect(resolved.args).toEqual(["-y", "my-mcp"]);
    });
  });

  describe("resolveVersion", () => {
    it("finds latest version matching semver range", async () => {
      vi.mocked(mockClient.getPackageVersions).mockResolvedValueOnce({
        name: "test-pkg",
        latest: "3.0.0",
        versions: [
          { version: "3.0.0", publishedAt: "2025-03-01" },
          { version: "2.1.0", publishedAt: "2025-02-01" },
          { version: "2.0.0", publishedAt: "2025-01-01" },
          { version: "1.5.0", publishedAt: "2024-06-01" },
        ],
      });

      const version = await resolveVersion("test-pkg", "^2.0.0", mockClient);
      expect(version).toBe("2.1.0");
    });

    it("throws when no version matches range", async () => {
      vi.mocked(mockClient.getPackageVersions).mockResolvedValueOnce({
        name: "test-pkg",
        latest: "1.0.0",
        versions: [
          { version: "1.0.0", publishedAt: "2025-01-01" },
        ],
      });

      await expect(resolveVersion("test-pkg", "^5.0.0", mockClient))
        .rejects.toThrow("not found");
    });
  });

  describe("buildInstallSpec", () => {
    it("builds install spec from resolved package", () => {
      const spec = buildInstallSpec(
        {
          name: "test",
          version: "1.0.0",
          command: "npx",
          args: ["-y", "test"],
          env: { KEY: "val" },
          transport: "stdio",
          integrity: "sha512-abc",
        },
        "cursor",
        "/home/.cursor/mcp.json",
      );

      expect(spec.command).toBe("npx");
      expect(spec.args).toEqual(["-y", "test"]);
      expect(spec.env).toEqual({ KEY: "val" });
      expect(spec.platform).toBe("cursor");
      expect(spec.configPath).toBe("/home/.cursor/mcp.json");
    });
  });
});
