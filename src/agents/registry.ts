/**
 * Agent runtime registry — discovery and selection of available runtimes.
 */

import type { AgentRuntime } from "./runtime.js";
import { ClaudeCodeRuntime } from "./claude-code.js";

// ── Registered runtimes (priority order) ────────────────────────────────────

const RUNTIMES: AgentRuntime[] = [
  new ClaudeCodeRuntime(),
];

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get all known runtimes (regardless of availability).
 */
export function getAllRuntimes(): AgentRuntime[] {
  return [...RUNTIMES];
}

/**
 * Look up a runtime by its ID.
 */
export function getRuntimeById(id: string): AgentRuntime | null {
  return RUNTIMES.find((r) => r.id === id) ?? null;
}

/**
 * Auto-select the first available runtime.
 * Checks availability in priority order.
 */
export async function autoSelectRuntime(): Promise<AgentRuntime | null> {
  for (const runtime of RUNTIMES) {
    if (await runtime.isAvailable()) {
      return runtime;
    }
  }
  return null;
}
