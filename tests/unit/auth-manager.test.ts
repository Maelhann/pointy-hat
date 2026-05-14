import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthManager } from "../../src/core/auth-manager.js";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("AuthManager", () => {
  let tempDir: string;
  let authManager: AuthManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pointyhat-test-"));
    authManager = new AuthManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("login", () => {
    it("stores token via --token flag", async () => {
      await authManager.login({ token: "test-token-123" });

      const token = await authManager.getToken();
      expect(token).toBe("test-token-123");
    });

    it("stores email alongside token", async () => {
      await authManager.login({ token: "tok", email: "user@example.com" });

      const email = await authManager.getEmail();
      expect(email).toBe("user@example.com");
    });

    it("throws without --token flag", async () => {
      await expect(authManager.login()).rejects.toThrow("--token flag");
    });
  });

  describe("logout", () => {
    it("clears stored credentials", async () => {
      await authManager.login({ token: "test-token" });
      expect(await authManager.isAuthenticated()).toBe(true);

      await authManager.logout();
      expect(await authManager.isAuthenticated()).toBe(false);
    });

    it("does not throw when already logged out", async () => {
      await expect(authManager.logout()).resolves.not.toThrow();
    });
  });

  describe("getToken", () => {
    it("returns null when not authenticated", async () => {
      const token = await authManager.getToken();
      expect(token).toBeNull();
    });

    it("returns token when authenticated", async () => {
      await authManager.login({ token: "my-token" });
      const token = await authManager.getToken();
      expect(token).toBe("my-token");
    });
  });

  describe("isAuthenticated", () => {
    it("returns false initially", async () => {
      expect(await authManager.isAuthenticated()).toBe(false);
    });

    it("returns true after login", async () => {
      await authManager.login({ token: "tok" });
      expect(await authManager.isAuthenticated()).toBe(true);
    });

    it("returns false after logout", async () => {
      await authManager.login({ token: "tok" });
      await authManager.logout();
      expect(await authManager.isAuthenticated()).toBe(false);
    });
  });

  describe("getAuthHeaders", () => {
    it("returns auth headers when authenticated", async () => {
      await authManager.login({ token: "bearer-tok" });
      const headers = await authManager.getAuthHeaders();
      expect(headers).toEqual({ Authorization: "Bearer bearer-tok" });
    });

    it("throws E_AUTH_REQUIRED when not authenticated", async () => {
      await expect(authManager.getAuthHeaders()).rejects.toThrow("Authentication required");
    });
  });

  describe("refreshToken", () => {
    it("throws E_AUTH_EXPIRED (not yet implemented)", async () => {
      await expect(authManager.refreshToken()).rejects.toThrow("expired");
    });
  });
});
