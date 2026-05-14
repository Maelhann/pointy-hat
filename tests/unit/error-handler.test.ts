import { describe, it, expect, vi } from "vitest";
import {
  PointyHatError,
  isPointyHatError,
  handleError,
  E_PROVIDER_NOT_CONFIGURED,
  E_PROVIDER_AUTH_FAILED,
  E_SPELL_INVALID,
  E_MCP_NOT_FOUND,
  E_QUALITY_CHECK_FAILED,
  E_CONFIG_MALFORMED,
  E_COVERAGE_INSUFFICIENT,
  E_PLATFORM_NOT_DETECTED,
  E_REGISTRY_UNREACHABLE,
} from "../../src/core/error-handler.js";

describe("PointyHatError", () => {
  it("creates error with code, message, and suggestions", () => {
    const err = new PointyHatError("E_TEST", "Test error", ["Try this"]);
    expect(err.code).toBe("E_TEST");
    expect(err.message).toBe("Test error");
    expect(err.suggestions).toEqual(["Try this"]);
    expect(err.name).toBe("PointyHatError");
  });

  it("is an instance of Error", () => {
    const err = new PointyHatError("E_TEST", "Test");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("isPointyHatError", () => {
  it("returns true for PointyHatError", () => {
    expect(isPointyHatError(new PointyHatError("E_TEST", "Test"))).toBe(true);
  });

  it("returns false for plain Error", () => {
    expect(isPointyHatError(new Error("Test"))).toBe(false);
  });

  it("returns false for non-errors", () => {
    expect(isPointyHatError("string")).toBe(false);
    expect(isPointyHatError(null)).toBe(false);
    expect(isPointyHatError(undefined)).toBe(false);
  });
});

describe("error factories", () => {
  it("E_PROVIDER_NOT_CONFIGURED", () => {
    const err = E_PROVIDER_NOT_CONFIGURED();
    expect(err.code).toBe("E_PROVIDER_NOT_CONFIGURED");
    expect(err.suggestions.length).toBeGreaterThan(0);
  });

  it("E_PROVIDER_AUTH_FAILED", () => {
    const err = E_PROVIDER_AUTH_FAILED("anthropic");
    expect(err.code).toBe("E_PROVIDER_AUTH_FAILED");
    expect(err.message).toContain("anthropic");
  });

  it("E_SPELL_INVALID", () => {
    const err = E_SPELL_INVALID("missing name");
    expect(err.code).toBe("E_SPELL_INVALID");
    expect(err.message).toContain("missing name");
  });

  it("E_MCP_NOT_FOUND", () => {
    const err = E_MCP_NOT_FOUND("@mcp/test");
    expect(err.code).toBe("E_MCP_NOT_FOUND");
    expect(err.message).toContain("@mcp/test");
  });

  it("E_QUALITY_CHECK_FAILED", () => {
    const err = E_QUALITY_CHECK_FAILED("step-1", "Missing data");
    expect(err.code).toBe("E_QUALITY_CHECK_FAILED");
    expect(err.message).toContain("step-1");
  });

  it("E_CONFIG_MALFORMED", () => {
    const err = E_CONFIG_MALFORMED("config.yaml", "bad syntax");
    expect(err.code).toBe("E_CONFIG_MALFORMED");
    expect(err.message).toContain("config.yaml");
  });

  it("E_COVERAGE_INSUFFICIENT", () => {
    const err = E_COVERAGE_INSUFFICIENT(45);
    expect(err.code).toBe("E_COVERAGE_INSUFFICIENT");
    expect(err.message).toContain("45");
  });

  it("E_PLATFORM_NOT_DETECTED", () => {
    const err = E_PLATFORM_NOT_DETECTED();
    expect(err.code).toBe("E_PLATFORM_NOT_DETECTED");
  });

  it("E_REGISTRY_UNREACHABLE", () => {
    const err = E_REGISTRY_UNREACHABLE();
    expect(err.code).toBe("E_REGISTRY_UNREACHABLE");
  });
});

describe("handleError", () => {
  it("handles PointyHatError without throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handleError(new PointyHatError("E_TEST", "Test error", ["Suggestion"]));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("handles plain Error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handleError(new Error("Generic error"));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("handles non-Error values", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handleError("string error");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
