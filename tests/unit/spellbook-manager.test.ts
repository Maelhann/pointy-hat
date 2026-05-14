import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SpellbookManager } from "../../src/core/spellbook-manager.js";
import { RegistryClient } from "../../src/core/registry-client.js";
import { ConfigManager } from "../../src/core/config-manager.js";
import { Cache } from "../../src/core/cache.js";
import { join } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";

// Use a temp directory for testing
const TEST_DIR = join(process.cwd(), ".test-spellbook-" + Date.now());
const COOKBOOK_DIR = join(TEST_DIR, ".pointyhat", "spellbook");

// Mock getConfigDir to use test directory
vi.mock("../../src/utils/fs.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/fs.js")>();
  return {
    ...original,
    getConfigDir: () => join(TEST_DIR, ".pointyhat"),
  };
});

// Mock registry client
function createMockRegistryClient() {
  const client = new RegistryClient({
    baseUrl: "https://api.test.org",
    cache: new Cache(join(TEST_DIR, "cache")),
  });

  vi.spyOn(client, "getSpell").mockResolvedValue({
    name: "test-spell",
    version: "1.0.0",
    description: "A test spell",
    author: "tester",
    tags: ["test"],
    requiredMcps: ["filesystem"],
    inputs: {
      required: [{ id: "data", description: "Input data", formats: ["csv"] }],
      optional: [],
    },
    requires: {
      tools: [{ uri: "mcp://filesystem/read_file", optional: false }],
      resources: [],
    },
    steps: [{ id: "step1", instruction: "Do the thing", optional: false }],
    outputs: [{ id: "result", type: "data", format: ["json"] }],
    metadata: {},
  });

  return client;
}

function createMockConfigManager() {
  const cm = new ConfigManager();
  vi.spyOn(cm, "loadUserConfig").mockResolvedValue({
    provider: {},
    cache: { ttl: 3600 },
  } as any);
  vi.spyOn(cm, "loadProjectConfig").mockResolvedValue(null);
  vi.spyOn(cm, "saveProjectConfig").mockResolvedValue(undefined);
  vi.spyOn(cm, "getProjectDir").mockReturnValue(TEST_DIR);
  return cm;
}

describe("SpellbookManager", () => {
  let spellbook: SpellbookManager;
  let registryClient: ReturnType<typeof createMockRegistryClient>;
  let configManager: ReturnType<typeof createMockConfigManager>;

  beforeEach(async () => {
    await mkdir(COOKBOOK_DIR, { recursive: true });
    registryClient = createMockRegistryClient();
    configManager = createMockConfigManager();
    spellbook = new SpellbookManager(configManager, registryClient);
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("add", () => {
    it("downloads and stores a spell from registry", async () => {
      const spell = await spellbook.add("test-spell");
      expect(spell.name).toBe("test-spell");
      expect(spell.version).toBe("1.0.0");
      expect(registryClient.getSpell).toHaveBeenCalledWith("test-spell", undefined);
    });

    it("stores spell with specific version", async () => {
      const spell = await spellbook.add("test-spell", "1.0.0");
      expect(spell.version).toBe("1.0.0");
      expect(registryClient.getSpell).toHaveBeenCalledWith("test-spell", "1.0.0");
    });

    it("rejects spells with security errors", async () => {
      vi.spyOn(registryClient, "getSpell").mockResolvedValueOnce({
        name: "bad-spell",
        version: "1.0.0",
        description: "Bad",
        author: "attacker",
        tags: [],
        requiredMcps: [],
        steps: [{
          id: "step1",
          instruction: "Use key sk-abcdefghijklmnopqrstuvwxyz1234567890 to auth",
          optional: false,
        }],
        inputs: { required: [], optional: [] },
        requires: { tools: [], resources: [] },
        outputs: [],
        metadata: {},
      });

      await expect(spellbook.add("bad-spell")).rejects.toThrow("Security scan");
    });
  });

  describe("list", () => {
    it("returns empty array when no spells installed", async () => {
      const result = await spellbook.list();
      expect(result).toHaveLength(0);
    });

    it("lists installed spells", async () => {
      await spellbook.add("test-spell");
      const result = await spellbook.list();
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].name).toBe("test-spell");
    });
  });

  describe("get", () => {
    it("returns null for non-existent spell", async () => {
      const result = await spellbook.get("nonexistent");
      expect(result).toBeNull();
    });

    it("returns spell definition for installed spell", async () => {
      await spellbook.add("test-spell");
      const result = await spellbook.get("test-spell");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("test-spell");
    });
  });

  describe("remove", () => {
    it("removes an installed spell", async () => {
      await spellbook.add("test-spell");

      // Verify it exists
      let spell = await spellbook.get("test-spell");
      expect(spell).not.toBeNull();

      // Remove
      await spellbook.remove("test-spell");

      // Verify gone
      spell = await spellbook.get("test-spell");
      expect(spell).toBeNull();
    });

    it("does not throw when removing non-existent spell", async () => {
      await expect(spellbook.remove("nonexistent")).resolves.not.toThrow();
    });
  });

  describe("checkDependencies", () => {
    it("identifies missing MCP dependencies", async () => {
      const spell = await spellbook.add("test-spell");
      const deps = await spellbook.checkDependencies(spell);
      expect(deps.missing).toContain("filesystem");
    });
  });

  describe("sync", () => {
    it("returns empty result when no lockfile", async () => {
      const result = await spellbook.sync();
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it("supports dry-run mode", async () => {
      const result = await spellbook.sync(true);
      expect(result.added).toHaveLength(0);
    });
  });
});
