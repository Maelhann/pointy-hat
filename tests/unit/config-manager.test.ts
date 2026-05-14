import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ConfigManager } from "../../src/core/config-manager.js";
import { writeYamlFile } from "../../src/utils/yaml.js";
import { ensureDir } from "../../src/utils/fs.js";

describe("ConfigManager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pointyhat-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("resolveEnvVars", () => {
    it("resolves ${env:VAR} patterns", () => {
      process.env.TEST_POINTYHAT_VAR = "resolved-value";
      const mgr = new ConfigManager();
      const result = mgr.resolveEnvVars("prefix-${env:TEST_POINTYHAT_VAR}-suffix");
      expect(result).toBe("prefix-resolved-value-suffix");
      delete process.env.TEST_POINTYHAT_VAR;
    });

    it("returns empty string for unset env vars", () => {
      const mgr = new ConfigManager();
      const result = mgr.resolveEnvVars("${env:NONEXISTENT_POINTYHAT_VAR}");
      expect(result).toBe("");
    });

    it("handles strings with no env vars", () => {
      const mgr = new ConfigManager();
      const result = mgr.resolveEnvVars("plain-string");
      expect(result).toBe("plain-string");
    });

    it("handles multiple env var references", () => {
      process.env.PH_A = "alpha";
      process.env.PH_B = "beta";
      const mgr = new ConfigManager();
      const result = mgr.resolveEnvVars("${env:PH_A}-${env:PH_B}");
      expect(result).toBe("alpha-beta");
      delete process.env.PH_A;
      delete process.env.PH_B;
    });
  });

  describe("loadProjectConfig", () => {
    it("returns null when no project config exists", async () => {
      const mgr = new ConfigManager(join(tempDir, "nonexistent", "pointyhat.yaml"));
      const config = await mgr.loadProjectConfig();
      expect(config).toBeNull();
    });

    it("loads a valid project config", async () => {
      const configPath = join(tempDir, "pointyhat.yaml");
      await writeYamlFile(configPath, {
        registry: "https://api.pointyhat.org",
        platforms: ["cursor"],
        mcps: {},
        spells: {},
      });

      const mgr = new ConfigManager(configPath);
      const config = await mgr.loadProjectConfig();
      expect(config).not.toBeNull();
      expect(config!.platforms).toEqual(["cursor"]);
    });
  });

  describe("saveProjectConfig", () => {
    it("creates and saves project config", async () => {
      const configPath = join(tempDir, "pointyhat.yaml");
      const mgr = new ConfigManager(configPath);

      await mgr.saveProjectConfig({
        registry: "https://api.pointyhat.org",
        platforms: ["claude-code"],
        mcps: {},
        spells: {},
      });

      const loaded = await mgr.loadProjectConfig();
      expect(loaded).not.toBeNull();
      expect(loaded!.platforms).toEqual(["claude-code"]);
    });
  });
});
