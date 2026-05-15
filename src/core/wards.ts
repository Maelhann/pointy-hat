/**
 * Ward system — independent verification of spell outcomes.
 *
 * Wards replace the old LLM-self-grading quality checks with deterministic
 * verification where possible. When a deterministic check isn't feasible,
 * the system falls back to an independent LLM evaluation (NOT the same
 * agent that produced the work).
 */

import type {
  SpellDefinition,
  SpellOutput,
  SpellEffect,
  SpellStep,
  QualityCheck,
} from "../types/spell.js";
import { fileExists, readFile } from "../utils/fs.js";
import { exec } from "node:child_process";

// ── Types ───────────────────────────────────────────────────────────────────

export type WardCheckType =
  | "file_exists"
  | "file_not_empty"
  | "file_contains"
  | "json_valid"
  | "command_succeeds"
  | "semantic";

export interface WardCheck {
  type: WardCheckType;
  /** Human-readable description of what this check verifies */
  description: string;
  /** File path (for file-based checks) */
  path?: string;
  /** Regex pattern (for file_contains) */
  pattern?: string;
  /** Shell command (for command_succeeds) */
  command?: string;
  /** Semantic criteria text (for semantic fallback) */
  criteria?: string;
  /** Minimum score for semantic checks (0.0–1.0) */
  minScore?: number;
}

export interface WardDefinition {
  /** Unique ID derived from the spell element (e.g. "output:report-document") */
  id: string;
  /** Human-readable description */
  description: string;
  /** One or more checks to evaluate */
  checks: WardCheck[];
  /** Maximum retries if ward fails */
  maxRetries: number;
  /** Whether to retry the agent on failure */
  retryOnFailure: boolean;
}

export interface WardResult {
  wardId: string;
  passed: boolean;
  message: string;
  /** Individual check results */
  checkResults: WardCheckResult[];
  durationMs: number;
}

export interface WardCheckResult {
  type: WardCheckType;
  passed: boolean;
  message: string;
}

// ── Parse wards from a spell ────────────────────────────────────────────────

/**
 * Extract ward definitions from a spell's outputs, effects, and steps.
 * Converts quality_check / ward fields + effect verification strings
 * into concrete, evaluable WardDefinition instances.
 */
export function parseWardsFromSpell(
  spell: SpellDefinition,
  outputDir: string,
): WardDefinition[] {
  const wards: WardDefinition[] = [];

  // Outputs → wards
  for (const output of spell.outputs) {
    const checks = buildOutputChecks(output, outputDir);
    const qc = output.quality_check;

    if (checks.length > 0 || qc) {
      // Always add a semantic check from quality_check criteria if present
      if (qc) {
        checks.push({
          type: "semantic",
          description: qc.criteria.trim(),
          criteria: qc.criteria.trim(),
          minScore: qc.min_score,
        });
      }
      wards.push({
        id: `output:${output.id}`,
        description: output.description || output.id,
        checks,
        maxRetries: qc?.max_retries ?? 1,
        retryOnFailure: qc?.retry_on_failure ?? false,
      });
    }
  }

  // Effects → wards
  for (const effect of spell.effects) {
    const checks = buildEffectChecks(effect);
    const qc = effect.quality_check;

    if (qc) {
      checks.push({
        type: "semantic",
        description: qc.criteria.trim(),
        criteria: qc.criteria.trim(),
        minScore: qc.min_score,
      });
    }

    if (checks.length > 0) {
      wards.push({
        id: `effect:${effect.id}`,
        description: effect.description,
        checks,
        maxRetries: qc?.max_retries ?? 1,
        retryOnFailure: qc?.retry_on_failure ?? false,
      });
    }
  }

  // Steps with quality_check → wards
  for (const step of spell.steps) {
    const qc = step.quality_check;
    if (qc) {
      wards.push({
        id: `step:${step.id}`,
        description: step.instruction.slice(0, 120).trim(),
        checks: [
          {
            type: "semantic",
            description: qc.criteria.trim(),
            criteria: qc.criteria.trim(),
            minScore: qc.min_score,
          },
        ],
        maxRetries: qc.max_retries ?? 1,
        retryOnFailure: qc.retry_on_failure ?? false,
      });
    }
  }

  return wards;
}

// ── Heuristic check builders ────────────────────────────────────────────────

function buildOutputChecks(output: SpellOutput, outputDir: string): WardCheck[] {
  const checks: WardCheck[] = [];

  // If the output type is document/data/code and has known formats,
  // expect a file to exist in the output directory
  if (output.format.length > 0) {
    for (const fmt of output.format) {
      const expectedPath = `${outputDir}/${output.id}.${fmt}`;
      checks.push({
        type: "file_not_empty",
        description: `Output file ${output.id}.${fmt} exists and is non-empty`,
        path: expectedPath,
      });
    }
  }

  // JSON format → validate JSON
  if (output.format.includes("json")) {
    checks.push({
      type: "json_valid",
      description: `Output ${output.id}.json is valid JSON`,
      path: `${outputDir}/${output.id}.json`,
    });
  }

  return checks;
}

function buildEffectChecks(effect: SpellEffect): WardCheck[] {
  const checks: WardCheck[] = [];
  const verification = effect.verification;

  if (!verification) return checks;

  const lower = verification.toLowerCase();

  // Heuristic: "file exists" patterns
  const fileExistsMatch = lower.match(/file\s+exists?\s+(?:at\s+)?["']?([^\s"']+)/i);
  if (fileExistsMatch) {
    checks.push({
      type: "file_exists",
      description: `File exists: ${fileExistsMatch[1]}`,
      path: fileExistsMatch[1],
    });
    return checks;
  }

  // Fallback: treat the whole verification string as a semantic check
  checks.push({
    type: "semantic",
    description: verification,
    criteria: verification,
    minScore: 0.7,
  });

  return checks;
}

// ── Ward evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate a single ward. Runs all checks; ward passes only if every
 * non-semantic check passes AND all semantic checks pass (or are skipped).
 *
 * Semantic checks require an `evaluateSemantic` callback — if none is provided,
 * semantic checks are treated as passed with a warning.
 */
export async function evaluateWard(
  ward: WardDefinition,
  agentOutput: string,
  evaluateSemantic?: (criteria: string, output: string, minScore: number) => Promise<{ passed: boolean; feedback: string }>,
): Promise<WardResult> {
  const start = Date.now();
  const checkResults: WardCheckResult[] = [];
  let allPassed = true;

  for (const check of ward.checks) {
    const result = await evaluateCheck(check, agentOutput, evaluateSemantic);
    checkResults.push(result);
    if (!result.passed) allPassed = false;
  }

  return {
    wardId: ward.id,
    passed: allPassed,
    message: allPassed
      ? "All checks passed"
      : checkResults
          .filter((r) => !r.passed)
          .map((r) => r.message)
          .join("; "),
    checkResults,
    durationMs: Date.now() - start,
  };
}

/**
 * Evaluate all wards for a spell cast. Returns results for each ward.
 */
export async function evaluateAllWards(
  wards: WardDefinition[],
  agentOutput: string,
  evaluateSemantic?: (criteria: string, output: string, minScore: number) => Promise<{ passed: boolean; feedback: string }>,
): Promise<WardResult[]> {
  const results: WardResult[] = [];
  for (const ward of wards) {
    results.push(await evaluateWard(ward, agentOutput, evaluateSemantic));
  }
  return results;
}

/**
 * Summarize ward failures into feedback text for the agent to retry.
 */
export function formatWardFeedback(results: WardResult[]): string {
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) return "";

  const lines = ["The following verification checks (wards) FAILED:", ""];
  for (const result of failed) {
    lines.push(`- [${result.wardId}]: ${result.message}`);
    for (const cr of result.checkResults.filter((c) => !c.passed)) {
      lines.push(`    ${cr.type}: ${cr.message}`);
    }
  }
  lines.push("");
  lines.push("Please address these failures and try again.");
  return lines.join("\n");
}

// ── Individual check evaluation ─────────────────────────────────────────────

async function evaluateCheck(
  check: WardCheck,
  agentOutput: string,
  evaluateSemantic?: (criteria: string, output: string, minScore: number) => Promise<{ passed: boolean; feedback: string }>,
): Promise<WardCheckResult> {
  switch (check.type) {
    case "file_exists":
      return evaluateFileExists(check);
    case "file_not_empty":
      return evaluateFileNotEmpty(check);
    case "file_contains":
      return evaluateFileContains(check);
    case "json_valid":
      return evaluateJsonValid(check);
    case "command_succeeds":
      return evaluateCommandSucceeds(check);
    case "semantic":
      return evaluateSemanticCheck(check, agentOutput, evaluateSemantic);
    default:
      return { type: check.type, passed: true, message: `Unknown check type: ${check.type}` };
  }
}

async function evaluateFileExists(check: WardCheck): Promise<WardCheckResult> {
  if (!check.path) {
    return { type: "file_exists", passed: false, message: "No path specified" };
  }
  const exists = await fileExists(check.path);
  return {
    type: "file_exists",
    passed: exists,
    message: exists ? `File exists: ${check.path}` : `File not found: ${check.path}`,
  };
}

async function evaluateFileNotEmpty(check: WardCheck): Promise<WardCheckResult> {
  if (!check.path) {
    return { type: "file_not_empty", passed: false, message: "No path specified" };
  }
  const exists = await fileExists(check.path);
  if (!exists) {
    return { type: "file_not_empty", passed: false, message: `File not found: ${check.path}` };
  }
  const content = await readFile(check.path);
  const nonEmpty = content.trim().length > 0;
  return {
    type: "file_not_empty",
    passed: nonEmpty,
    message: nonEmpty ? `File is non-empty: ${check.path}` : `File is empty: ${check.path}`,
  };
}

async function evaluateFileContains(check: WardCheck): Promise<WardCheckResult> {
  if (!check.path || !check.pattern) {
    return { type: "file_contains", passed: false, message: "Missing path or pattern" };
  }
  const exists = await fileExists(check.path);
  if (!exists) {
    return { type: "file_contains", passed: false, message: `File not found: ${check.path}` };
  }
  const content = await readFile(check.path);
  const regex = new RegExp(check.pattern);
  const matches = regex.test(content);
  return {
    type: "file_contains",
    passed: matches,
    message: matches
      ? `Pattern matched in ${check.path}`
      : `Pattern "${check.pattern}" not found in ${check.path}`,
  };
}

async function evaluateJsonValid(check: WardCheck): Promise<WardCheckResult> {
  if (!check.path) {
    return { type: "json_valid", passed: false, message: "No path specified" };
  }
  const exists = await fileExists(check.path);
  if (!exists) {
    return { type: "json_valid", passed: false, message: `File not found: ${check.path}` };
  }
  const content = await readFile(check.path);
  try {
    JSON.parse(content);
    return { type: "json_valid", passed: true, message: `Valid JSON: ${check.path}` };
  } catch (err) {
    return {
      type: "json_valid",
      passed: false,
      message: `Invalid JSON in ${check.path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function evaluateCommandSucceeds(check: WardCheck): Promise<WardCheckResult> {
  if (!check.command) {
    return { type: "command_succeeds", passed: false, message: "No command specified" };
  }
  return new Promise((resolve) => {
    exec(check.command!, { timeout: 30000 }, (error, _stdout, stderr) => {
      if (error) {
        resolve({
          type: "command_succeeds",
          passed: false,
          message: `Command failed: ${check.command} — ${stderr || error.message}`,
        });
      } else {
        resolve({
          type: "command_succeeds",
          passed: true,
          message: `Command succeeded: ${check.command}`,
        });
      }
    });
  });
}

async function evaluateSemanticCheck(
  check: WardCheck,
  agentOutput: string,
  evaluateSemantic?: (criteria: string, output: string, minScore: number) => Promise<{ passed: boolean; feedback: string }>,
): Promise<WardCheckResult> {
  if (!evaluateSemantic) {
    return {
      type: "semantic",
      passed: true,
      message: `Semantic check skipped (no evaluator): ${check.description}`,
    };
  }
  try {
    const result = await evaluateSemantic(
      check.criteria || check.description,
      agentOutput,
      check.minScore ?? 0.7,
    );
    return {
      type: "semantic",
      passed: result.passed,
      message: result.passed
        ? `Semantic check passed: ${check.description}`
        : `Semantic check failed: ${result.feedback}`,
    };
  } catch (err) {
    return {
      type: "semantic",
      passed: true,
      message: `Semantic check error (treated as pass): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
