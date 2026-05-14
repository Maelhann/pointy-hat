import { formatError } from "../ui/format.js";
import chalk from "chalk";

export class PointyHatError extends Error {
  code: string;
  suggestions: string[];
  cause?: Error;

  constructor(
    code: string,
    message: string,
    suggestions: string[] = [],
    cause?: Error,
  ) {
    super(message);
    this.name = "PointyHatError";
    this.code = code;
    this.suggestions = suggestions;
    this.cause = cause;
  }
}

export function isPointyHatError(err: unknown): err is PointyHatError {
  return err instanceof PointyHatError;
}

// Error factories

export function E_PROVIDER_NOT_CONFIGURED(): PointyHatError {
  return new PointyHatError(
    "E_PROVIDER_NOT_CONFIGURED",
    "No LLM provider configured.",
    [
      "Run `pointyhat provider setup` to configure a provider.",
      "Or set ANTHROPIC_API_KEY / OPENAI_API_KEY environment variable.",
    ],
  );
}

export function E_PROVIDER_AUTH_FAILED(provider: string): PointyHatError {
  return new PointyHatError(
    "E_PROVIDER_AUTH_FAILED",
    `API key for ${provider} is invalid or expired.`,
    [
      `Check your API key with \`pointyhat provider test ${provider}\`.`,
      `Update it with \`pointyhat provider set ${provider} --api-key <key>\`.`,
    ],
  );
}

export function E_PROVIDER_RATE_LIMITED(provider: string): PointyHatError {
  return new PointyHatError(
    "E_PROVIDER_RATE_LIMITED",
    `Rate limited by ${provider}. Please wait and try again.`,
    ["Wait a few seconds and retry.", "Consider using a different model or provider."],
  );
}

export function E_REGISTRY_UNREACHABLE(): PointyHatError {
  return new PointyHatError(
    "E_REGISTRY_UNREACHABLE",
    "Cannot reach api.pointyhat.org.",
    [
      "Check your internet connection.",
      "The registry may be temporarily unavailable.",
      "Run `pointyhat doctor` to diagnose.",
    ],
  );
}

export function E_AUTH_EXPIRED(): PointyHatError {
  return new PointyHatError(
    "E_AUTH_EXPIRED",
    "Authentication token has expired.",
    ["Run `pointyhat auth login` to re-authenticate."],
  );
}

export function E_SPELL_INVALID(detail: string): PointyHatError {
  return new PointyHatError(
    "E_SPELL_INVALID",
    `Spell validation failed: ${detail}`,
    ["Fix the issues and run `pointyhat validate` again."],
  );
}

export function E_PLATFORM_NOT_DETECTED(): PointyHatError {
  return new PointyHatError(
    "E_PLATFORM_NOT_DETECTED",
    "No agent platform detected.",
    [
      "Install an agent platform (Claude Code, Cursor, etc.).",
      "Or use `--platform <name>` to specify manually.",
      "Run `pointyhat doctor` to see what's detected.",
    ],
  );
}

export function E_SCAN_FAILED(errorCount: number): PointyHatError {
  return new PointyHatError(
    "E_SCAN_FAILED",
    `Security scan found ${errorCount} error(s).`,
    [
      "Review the findings and fix the issues.",
      "Run `pointyhat scan --severity warn` for details.",
    ],
  );
}

export function E_MCP_SUBPROCESS_FAILED(name: string, detail: string): PointyHatError {
  return new PointyHatError(
    "E_MCP_SUBPROCESS_FAILED",
    `MCP server "${name}" failed to start: ${detail}`,
    [
      "Check that the MCP server is installed correctly.",
      "Verify the command and args in the lockfile.",
      "Run `pointyhat mcp test ${name}` to diagnose.",
    ],
  );
}

export function E_MCP_NOT_FOUND(name: string): PointyHatError {
  return new PointyHatError(
    "E_MCP_NOT_FOUND",
    `MCP package "${name}" not found in registry.`,
    [
      `Check the spelling: \`pointyhat search ${name}\`.`,
      "Browse available packages at https://pointyhat.org",
    ],
  );
}

export function E_COVERAGE_INSUFFICIENT(score: number): PointyHatError {
  return new PointyHatError(
    "E_COVERAGE_INSUFFICIENT",
    `Coverage score is ${score.toFixed(0)}% — required inputs or tools are missing.`,
    [
      "Provide the missing inputs with `--input` or `--input-file`.",
      "Install missing MCP tools with `pointyhat mcp install`.",
      "Run with `--dry-run` to see detailed coverage analysis.",
    ],
  );
}

export function E_QUALITY_CHECK_FAILED(stepId: string, feedback: string): PointyHatError {
  return new PointyHatError(
    "E_QUALITY_CHECK_FAILED",
    `Quality check failed for step "${stepId}": ${feedback}`,
    [
      "The output did not meet the quality criteria.",
      "Try running again or adjust the spell's quality_check.min_score.",
    ],
  );
}

export function E_INSTALL_FAILED(name: string, detail: string): PointyHatError {
  return new PointyHatError(
    "E_INSTALL_FAILED",
    `Failed to install "${name}": ${detail}`,
    [
      "Check the package name and try again.",
      "Run `pointyhat doctor` to diagnose environment issues.",
    ],
  );
}

export function E_UNINSTALL_FAILED(name: string, detail: string): PointyHatError {
  return new PointyHatError(
    "E_UNINSTALL_FAILED",
    `Failed to uninstall "${name}": ${detail}`,
    [
      "Check that the package is installed with `pointyhat mcp list`.",
      "Try specifying the platform: `pointyhat mcp uninstall ${name} --platform <p>`.",
    ],
  );
}

export function E_VERSION_NOT_FOUND(name: string, version: string): PointyHatError {
  return new PointyHatError(
    "E_VERSION_NOT_FOUND",
    `Version "${version}" of "${name}" not found.`,
    [
      `Check available versions: \`pointyhat info ${name} --versions\`.`,
      "Use a valid semver range or exact version.",
    ],
  );
}

export function E_AUTH_REQUIRED(): PointyHatError {
  return new PointyHatError(
    "E_AUTH_REQUIRED",
    "Authentication required for this action.",
    [
      "Run `pointyhat auth login --token <token>` to authenticate.",
      "Get a token from https://pointyhat.org/settings/tokens.",
    ],
  );
}

export function E_CONFIG_MALFORMED(file: string, detail: string): PointyHatError {
  return new PointyHatError(
    "E_CONFIG_MALFORMED",
    `Config file "${file}" is malformed: ${detail}`,
    [
      "Check the file for syntax errors.",
      "Run `pointyhat doctor --fix` to attempt auto-repair.",
    ],
  );
}

export function E_SPELLBOOK_SYNC_FAILED(detail: string): PointyHatError {
  return new PointyHatError(
    "E_SPELLBOOK_SYNC_FAILED",
    `Spellbook sync failed: ${detail}`,
    [
      "Check your internet connection.",
      "Run `pointyhat sync --dry-run` to see what would change.",
      "Run `pointyhat doctor` to diagnose.",
    ],
  );
}

export function E_PUBLISH_FAILED(name: string, detail: string): PointyHatError {
  return new PointyHatError(
    "E_PUBLISH_FAILED",
    `Failed to publish "${name}": ${detail}`,
    [
      "Check that you are authenticated: `pointyhat auth login`.",
      "Ensure the spell passes validation: `pointyhat validate`.",
      "Verify the version is not already published.",
    ],
  );
}

export function E_UNPUBLISH_FAILED(name: string, detail: string): PointyHatError {
  return new PointyHatError(
    "E_UNPUBLISH_FAILED",
    `Failed to unpublish "${name}": ${detail}`,
    [
      "Ensure you are the package owner.",
      "Check that the version exists: `pointyhat info <name>`.",
    ],
  );
}

export function E_CATALYST_NOT_FOUND(spellName: string, catalystId: string): PointyHatError {
  return new PointyHatError(
    "E_CATALYST_NOT_FOUND",
    `Catalyst "${catalystId}" not found for spell "${spellName}".`,
    [
      "Check the catalyst ID in the spell definition.",
      "Ensure the spell is published with catalysts.",
    ],
  );
}

// Top-level error handler
export function handleError(err: unknown): void {
  if (isPointyHatError(err)) {
    console.error(formatError(err.code, err.message, err.suggestions));
  } else if (err instanceof Error) {
    console.error(formatError("E_UNKNOWN", err.message));
    if (process.env.DEBUG) {
      console.error(chalk.dim(err.stack || ""));
    }
  } else {
    console.error(formatError("E_UNKNOWN", String(err)));
  }
}
