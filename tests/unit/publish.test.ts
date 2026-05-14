import { describe, it, expect } from "vitest";
import { computeSha512, verifyIntegrity } from "../../src/utils/hash.js";
import { bumpVersion, isValidVersion } from "../../src/utils/semver.js";

describe("publish utilities", () => {
  describe("computeSha512", () => {
    it("computes a sha512 hash", () => {
      const hash = computeSha512("hello world");
      expect(hash).toMatch(/^sha512-/);
      expect(hash.length).toBeGreaterThan(10);
    });

    it("produces consistent hashes for same content", () => {
      const hash1 = computeSha512("test content");
      const hash2 = computeSha512("test content");
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different content", () => {
      const hash1 = computeSha512("content A");
      const hash2 = computeSha512("content B");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("verifyIntegrity", () => {
    it("verifies correct integrity", () => {
      const content = "spell content here";
      const hash = computeSha512(content);
      expect(verifyIntegrity(content, hash)).toBe(true);
    });

    it("rejects incorrect integrity", () => {
      expect(verifyIntegrity("content", "sha512-wrong")).toBe(false);
    });
  });

  describe("bumpVersion", () => {
    it("bumps patch version", () => {
      expect(bumpVersion("1.0.0", "patch")).toBe("1.0.1");
    });

    it("bumps minor version", () => {
      expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    });

    it("bumps major version", () => {
      expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
    });

    it("throws on invalid version", () => {
      expect(() => bumpVersion("not-a-version", "patch")).toThrow();
    });
  });

  describe("isValidVersion", () => {
    it("accepts valid semver", () => {
      expect(isValidVersion("1.0.0")).toBe(true);
      expect(isValidVersion("0.1.0")).toBe(true);
      expect(isValidVersion("10.20.30")).toBe(true);
    });

    it("rejects invalid semver", () => {
      expect(isValidVersion("not-a-version")).toBe(false);
      expect(isValidVersion("1.0")).toBe(false);
    });
  });
});
