/**
 * Agent runtime abstraction.
 *
 * Instead of calling LLM APIs directly, spell execution delegates to an
 * autonomous agent (sub-process) that runs until outcomes are satisfied.
 */

// ── Mission ─────────────────────────────────────────────────────────────────

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentMission {
  /** Full prompt / instructions for the agent */
  prompt: string;
  /** Working directory for agent execution */
  workingDirectory: string;
  /** MCP servers the agent should have access to (name → spawn config) */
  mcpServers: Record<string, McpServerConfig>;
  /** Maximum execution time in seconds (0 = no limit) */
  timeout: number;
  /** Stream agent output to the terminal in real-time */
  streamOutput: boolean;
}

// ── Result ──────────────────────────────────────────────────────────────────

export interface AgentResult {
  /** Whether the agent ran to completion (vs timeout / error) */
  completed: boolean;
  /** Full text output captured from the agent */
  output: string;
  /** Process exit code */
  exitCode: number;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
}

// ── Runtime interface ───────────────────────────────────────────────────────

export interface AgentRuntime {
  /** Unique identifier (e.g. "claude-code") */
  readonly id: string;
  /** Human-readable display name */
  readonly name: string;
  /** Check whether this runtime is available on the current system */
  isAvailable(): Promise<boolean>;
  /** Execute a mission and return the result */
  execute(mission: AgentMission): Promise<AgentResult>;
  /** Abort a running agent (for Ctrl+C / timeout handling) */
  abort(): Promise<void>;
}
