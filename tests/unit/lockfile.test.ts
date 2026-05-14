import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createEmptyLockfile,
  updateLockEntry,
  removeLockEntry,
  diffLockfile,
  validateLockIntegrity,
  syncWithYaml,
  computeIntegrity,
  generateLockfile,
  parseLockfile,
  type Lockfile,
} from "../../src/core/lockfile.js";

describe("lockfile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pointyhat-lock-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createEmptyLockfile", () => {
    it("creates a valid empty lockfile", () => {
      const lf = createEmptyLockfile();
      expect(lf.lockfileVersion).toBe(1);
      expect(lf.mcps).toEqual({});
      expect(lf.spells).toEqual({});
      expect(lf.generatedAt).toBeTruthy();
    });
  });

  describe("updateLockEntry", () => {
    it("adds an MCP entry", () => {
      const lf = createEmptyLockfile();
      updateLockEntry(lf, "mcps", "@mcp/test", {
        version: "1.0.0",
        resolved: "https://api.pointyhat.org/v1/mcps/@mcp/test",
        integrity: "sha512-abc",
      });

      expect(lf.mcps["@mcp/test"]).toBeDefined();
      expect(lf.mcps["@mcp/test"].version).toBe("1.0.0");
    });

    it("adds a spell entry", () => {
      const lf = createEmptyLockfile();
      updateLockEntry(lf, "spells", "my-spell", {
        version: "2.0.0",
        resolved: "https://api.pointyhat.org/v1/spells/my-spell",
        integrity: "sha512-def",
      });

      expect(lf.spells["my-spell"].version).toBe("2.0.0");
    });
  });

  describe("removeLockEntry", () => {
    it("removes an entry by name", () => {
      const lf = createEmptyLockfile();
      updateLockEntry(lf, "mcps", "pkg-a", {
        version: "1.0.0",
        resolved: "url",
        integrity: "hash",
      });
      updateLockEntry(lf, "mcps", "pkg-b", {
        version: "2.0.0",
        resolved: "url",
        integrity: "hash",
      });

      removeLockEntry(lf, "mcps", "pkg-a");

      expect(lf.mcps["pkg-a"]).toBeUndefined();
      expect(lf.mcps["pkg-b"]).toBeDefined();
    });

    it("does nothing for non-existent entry", () => {
      const lf = createEmptyLockfile();
      removeLockEntry(lf, "mcps", "nonexistent");
      expect(Object.keys(lf.mcps)).toHaveLength(0);
    });
  });

  describe("diffLockfile", () => {
    it("detects added entries", () => {
      const current = createEmptyLockfile();
      const incoming = createEmptyLockfile();
      updateLockEntry(incoming, "mcps", "new-pkg", {
        version: "1.0.0",
        resolved: "url",
        integrity: "hash",
      });

      const diff = diffLockfile(current, incoming);
      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].name).toBe("new-pkg");
    });

    it("detects removed entries", () => {
      const current = createEmptyLockfile();
      updateLockEntry(current, "mcps", "old-pkg", {
        version: "1.0.0",
        resolved: "url",
        integrity: "hash",
      });
      const incoming = createEmptyLockfile();

      const diff = diffLockfile(current, incoming);
      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].name).toBe("old-pkg");
    });

    it("detects updated entries", () => {
      const current = createEmptyLockfile();
      updateLockEntry(current, "mcps", "pkg", {
        version: "1.0.0",
        resolved: "url",
        integrity: "hash",
      });
      const incoming = createEmptyLockfile();
      updateLockEntry(incoming, "mcps", "pkg", {
        version: "2.0.0",
        resolved: "url",
        integrity: "hash2",
      });

      const diff = diffLockfile(current, incoming);
      expect(diff.updated).toHaveLength(1);
      expect(diff.updated[0].from).toBe("1.0.0");
      expect(diff.updated[0].to).toBe("2.0.0");
    });

    it("detects unchanged entries", () => {
      const current = createEmptyLockfile();
      updateLockEntry(current, "mcps", "stable", {
        version: "1.0.0",
        resolved: "url",
        integrity: "hash",
      });
      const incoming = createEmptyLockfile();
      updateLockEntry(incoming, "mcps", "stable", {
        version: "1.0.0",
        resolved: "url",
        integrity: "hash",
      });

      const diff = diffLockfile(current, incoming);
      expect(diff.unchanged).toHaveLength(1);
    });
  });

  describe("validateLockIntegrity", () => {
    it("passes for valid integrity hashes", () => {
      const lf = createEmptyLockfile();
      updateLockEntry(lf, "mcps", "valid-hash", {
        version: "1.0.0",
        resolved: "url",
        integrity: "sha512-abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      });

      const result = validateLockIntegrity(lf);
      expect(result.valid).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("fails for invalid integrity format", () => {
      const lf = createEmptyLockfile();
      updateLockEntry(lf, "mcps", "bad-hash", {
        version: "1.0.0",
        resolved: "url",
        integrity: "not-a-valid-hash!@#",
      });

      const result = validateLockIntegrity(lf);
      expect(result.valid).toBe(false);
      expect(result.failures).toHaveLength(1);
    });

    it("skips entries without integrity", () => {
      const lf = createEmptyLockfile();
      updateLockEntry(lf, "mcps", "no-hash", {
        version: "1.0.0",
        resolved: "url",
        integrity: "",
      });

      const result = validateLockIntegrity(lf);
      expect(result.valid).toBe(true);
    });
  });

  describe("syncWithYaml", () => {
    it("detects packages to add and remove", () => {
      const lf = createEmptyLockfile();
      updateLockEntry(lf, "mcps", "existing", {
        version: "1.0.0",
        resolved: "url",
        integrity: "hash",
      });
      updateLockEntry(lf, "mcps", "orphaned", {
        version: "1.0.0",
        resolved: "url",
        integrity: "hash",
      });

      const projectConfig = {
        registry: "https://api.pointyhat.org",
        platforms: [],
        mcps: {
          existing: { version: "^1.0.0" },
          missing: { version: "^2.0.0" },
        },
        spells: {},
      };

      const result = syncWithYaml(lf, projectConfig);
      expect(result.toAdd).toContain("missing");
      expect(result.toRemove).toContain("orphaned");
    });
  });

  describe("computeIntegrity", () => {
    it("produces sha512 hash", () => {
      const hash = computeIntegrity("hello world");
      expect(hash).toMatch(/^sha512-/);
    });

    it("produces consistent hashes", () => {
      const a = computeIntegrity("test content");
      const b = computeIntegrity("test content");
      expect(a).toBe(b);
    });

    it("produces different hashes for different content", () => {
      const a = computeIntegrity("content A");
      const b = computeIntegrity("content B");
      expect(a).not.toBe(b);
    });
  });

  describe("parseLockfile / generateLockfile", () => {
    it("round-trips a lockfile through YAML", async () => {
      const lf = createEmptyLockfile();
      updateLockEntry(lf, "mcps", "@mcp/test", {
        version: "1.0.0",
        resolved: "https://example.com",
        integrity: "sha512-abc",
        command: "npx",
        args: ["-y", "@mcp/test"],
      });

      const lockPath = join(tempDir, "pointyhat.lock");
      await generateLockfile(lockPath, lf);

      const parsed = await parseLockfile(lockPath);
      expect(parsed).not.toBeNull();
      expect(parsed!.mcps["@mcp/test"].version).toBe("1.0.0");
      expect(parsed!.mcps["@mcp/test"].command).toBe("npx");
    });

    it("returns null for non-existent lockfile", async () => {
      const result = await parseLockfile(join(tempDir, "nonexistent.lock"));
      expect(result).toBeNull();
    });
  });
});
