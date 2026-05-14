import type { SpellDefinition } from "../types/spell.js";
import type { McpPackage } from "../types/mcp-package.js";
import type { ScanFinding, ScanResult } from "../types/quality.js";

// ── Secret Patterns ──

const SECRET_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/, name: "OpenAI/Anthropic API key" },
  { pattern: /ghp_[a-zA-Z0-9]{36,}/, name: "GitHub personal access token" },
  { pattern: /gho_[a-zA-Z0-9]{36,}/, name: "GitHub OAuth token" },
  { pattern: /github_pat_[a-zA-Z0-9_]{20,}/, name: "GitHub fine-grained token" },
  { pattern: /xoxb-[0-9]{10,}-[a-zA-Z0-9]{20,}/, name: "Slack bot token" },
  { pattern: /xoxp-[0-9]{10,}-[a-zA-Z0-9]{20,}/, name: "Slack user token" },
  { pattern: /AKIA[0-9A-Z]{16}/, name: "AWS access key" },
  { pattern: /AIzaSy[a-zA-Z0-9_-]{33}/, name: "Google API key" },
  { pattern: /-----BEGIN (?:RSA |DSA |EC )?PRIVATE KEY-----/, name: "Private key" },
  { pattern: /password\s*[:=]\s*["'][^"']{3,}["']/, name: "Hardcoded password" },
  { pattern: /secret\s*[:=]\s*["'][^"']{3,}["']/, name: "Hardcoded secret" },
  { pattern: /token\s*[:=]\s*["'][a-zA-Z0-9_.-]{20,}["']/, name: "Hardcoded token" },
];

// ── Shell Metacharacters ──

const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>!\\]/;
const SUSPICIOUS_COMMANDS = /\b(curl|wget|nc|ncat|bash\s+-c|sh\s+-c|eval|exec)\b/i;

// ── Instruction Injection Patterns ──

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /disregard\s+(the\s+)?(above|previous)/i,
  /override\s+(your\s+)?system\s+prompt/i,
  /forget\s+(everything|all)\s+(you|about)/i,
  /new\s+system\s+prompt/i,
];

// ── Main Scanner Functions ──

export function scanSpell(spell: SpellDefinition): ScanFinding[] {
  const findings: ScanFinding[] = [];

  // Check steps for issues
  for (let i = 0; i < spell.steps.length; i++) {
    const step = spell.steps[i];
    const loc = `spell.steps[${i}]`;

    // Hardcoded secrets in instructions
    for (const sp of SECRET_PATTERNS) {
      if (sp.pattern.test(step.instruction)) {
        findings.push({
          severity: "error",
          rule: "hardcoded-secret",
          location: `${loc}.instruction`,
          message: `Possible ${sp.name} found in step instruction.`,
        });
      }
    }

    // Instruction injection in step instructions
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(step.instruction)) {
        findings.push({
          severity: "warn",
          rule: "instruction-injection",
          location: `${loc}.instruction`,
          message: "Step instruction contains prompt injection-like patterns.",
        });
        break; // One finding per step for injection
      }
    }

    // Data exfiltration: suspicious outbound URLs in instructions
    const urlMatches = step.instruction.match(/https?:\/\/[^\s"']+/g);
    if (urlMatches) {
      for (const url of urlMatches) {
        // Allow common documentation/known-safe domains
        if (!isSafeDomain(url)) {
          findings.push({
            severity: "warn",
            rule: "data-exfiltration",
            location: `${loc}.instruction`,
            message: `Outbound URL detected in instruction: ${url}`,
          });
        }
      }
    }
  }

  // Check effects for issues
  for (let i = 0; i < (spell.effects?.length ?? 0); i++) {
    const effect = spell.effects[i];
    const loc = `spell.effects[${i}]`;

    // Scan effect description
    for (const sp of SECRET_PATTERNS) {
      if (sp.pattern.test(effect.description)) {
        findings.push({
          severity: "error",
          rule: "hardcoded-secret",
          location: `${loc}.description`,
          message: `Possible ${sp.name} found in effect description.`,
        });
      }
    }

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(effect.description)) {
        findings.push({
          severity: "warn",
          rule: "instruction-injection",
          location: `${loc}.description`,
          message: "Effect description contains prompt injection-like patterns.",
        });
        break;
      }
    }

    const descUrlMatches = effect.description.match(/https?:\/\/[^\s"']+/g);
    if (descUrlMatches) {
      for (const url of descUrlMatches) {
        if (!isSafeDomain(url)) {
          findings.push({
            severity: "warn",
            rule: "data-exfiltration",
            location: `${loc}.description`,
            message: `Outbound URL detected in effect description: ${url}`,
          });
        }
      }
    }

    // Scan effect verification (optional)
    if (effect.verification) {
      for (const sp of SECRET_PATTERNS) {
        if (sp.pattern.test(effect.verification)) {
          findings.push({
            severity: "error",
            rule: "hardcoded-secret",
            location: `${loc}.verification`,
            message: `Possible ${sp.name} found in effect verification.`,
          });
        }
      }

      for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(effect.verification)) {
          findings.push({
            severity: "warn",
            rule: "instruction-injection",
            location: `${loc}.verification`,
            message: "Effect verification contains prompt injection-like patterns.",
          });
          break;
        }
      }

      const verifUrlMatches = effect.verification.match(/https?:\/\/[^\s"']+/g);
      if (verifUrlMatches) {
        for (const url of verifUrlMatches) {
          if (!isSafeDomain(url)) {
            findings.push({
              severity: "warn",
              rule: "data-exfiltration",
              location: `${loc}.verification`,
              message: `Outbound URL detected in effect verification: ${url}`,
            });
          }
        }
      }
    }
  }

  // Check outputs for issues
  for (let i = 0; i < spell.outputs.length; i++) {
    const output = spell.outputs[i];
    const loc = `spell.outputs[${i}]`;

    // Scan output description (optional)
    if (output.description) {
      for (const sp of SECRET_PATTERNS) {
        if (sp.pattern.test(output.description)) {
          findings.push({
            severity: "error",
            rule: "hardcoded-secret",
            location: `${loc}.description`,
            message: `Possible ${sp.name} found in output description.`,
          });
        }
      }

      for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(output.description)) {
          findings.push({
            severity: "warn",
            rule: "instruction-injection",
            location: `${loc}.description`,
            message: "Output description contains prompt injection-like patterns.",
          });
          break;
        }
      }

      const outDescUrlMatches = output.description.match(/https?:\/\/[^\s"']+/g);
      if (outDescUrlMatches) {
        for (const url of outDescUrlMatches) {
          if (!isSafeDomain(url)) {
            findings.push({
              severity: "warn",
              rule: "data-exfiltration",
              location: `${loc}.description`,
              message: `Outbound URL detected in output description: ${url}`,
            });
          }
        }
      }
    }

    // Scan output acceptance_criteria (optional)
    if (output.acceptance_criteria) {
      for (const sp of SECRET_PATTERNS) {
        if (sp.pattern.test(output.acceptance_criteria)) {
          findings.push({
            severity: "error",
            rule: "hardcoded-secret",
            location: `${loc}.acceptance_criteria`,
            message: `Possible ${sp.name} found in output acceptance criteria.`,
          });
        }
      }

      for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(output.acceptance_criteria)) {
          findings.push({
            severity: "warn",
            rule: "instruction-injection",
            location: `${loc}.acceptance_criteria`,
            message: "Output acceptance criteria contains prompt injection-like patterns.",
          });
          break;
        }
      }

      const acUrlMatches = output.acceptance_criteria.match(/https?:\/\/[^\s"']+/g);
      if (acUrlMatches) {
        for (const url of acUrlMatches) {
          if (!isSafeDomain(url)) {
            findings.push({
              severity: "warn",
              rule: "data-exfiltration",
              location: `${loc}.acceptance_criteria`,
              message: `Outbound URL detected in output acceptance criteria: ${url}`,
            });
          }
        }
      }
    }

    // Scan output artifact URI
    if (output.artifact) {
      for (const sp of SECRET_PATTERNS) {
        if (sp.pattern.test(output.artifact)) {
          findings.push({
            severity: "error",
            rule: "hardcoded-secret",
            location: `${loc}.artifact`,
            message: `Possible ${sp.name} found in artifact URI.`,
          });
        }
      }
    }
  }

  // Check for overprivileged tool access
  const toolsUsedInSteps = new Set<string>();
  for (const step of spell.steps) {
    if (step.tools_needed) {
      for (const tool of step.tools_needed) {
        toolsUsedInSteps.add(tool);
      }
    }
  }

  for (const tool of spell.requires.tools) {
    if (tool.optional) continue;
    // Extract tool name from URI: "mcp://server/tool_name" -> "server/tool_name" or "tool_name"
    const toolName = tool.uri.replace(/^mcp:\/\//, "");
    const shortName = toolName.split("/").pop() || toolName;

    const isUsed = toolsUsedInSteps.has(toolName) ||
      toolsUsedInSteps.has(shortName) ||
      [...toolsUsedInSteps].some((t) => t.endsWith(`/${shortName}`));

    if (!isUsed && toolsUsedInSteps.size > 0) {
      findings.push({
        severity: "info",
        rule: "overprivileged-tools",
        location: `spell.requires.tools`,
        message: `Tool "${tool.uri}" is required but not referenced in any step's tools_needed.`,
      });
    }
  }

  // Check inputs/description for secrets
  for (const input of [...spell.inputs.required, ...spell.inputs.optional]) {
    for (const sp of SECRET_PATTERNS) {
      if (sp.pattern.test(input.description)) {
        findings.push({
          severity: "error",
          rule: "hardcoded-secret",
          location: `spell.inputs.${input.id}.description`,
          message: `Possible ${sp.name} found in input description.`,
        });
      }
    }
  }

  // Check card for secrets
  if (spell.card) {
    for (const sp of SECRET_PATTERNS) {
      if (sp.pattern.test(spell.card)) {
        findings.push({
          severity: "error",
          rule: "hardcoded-secret",
          location: "spell.card",
          message: `Possible ${sp.name} found in spell card.`,
        });
      }
    }
  }

  return findings;
}

export function scanMcpPackage(pkg: McpPackage): ScanFinding[] {
  const findings: ScanFinding[] = [];

  // Check command for shell injection
  if (pkg.command) {
    if (SHELL_METACHARACTERS.test(pkg.command)) {
      findings.push({
        severity: "error",
        rule: "command-injection",
        location: "package.command",
        message: `Shell metacharacters found in command: "${pkg.command}"`,
      });
    }

    if (SUSPICIOUS_COMMANDS.test(pkg.command)) {
      findings.push({
        severity: "warn",
        rule: "command-injection",
        location: "package.command",
        message: `Suspicious command detected: "${pkg.command}"`,
      });
    }
  }

  // Check args for shell injection
  for (let i = 0; i < pkg.args.length; i++) {
    const arg = pkg.args[i];
    if (SHELL_METACHARACTERS.test(arg)) {
      findings.push({
        severity: "warn",
        rule: "command-injection",
        location: `package.args[${i}]`,
        message: `Shell metacharacters found in argument: "${arg}"`,
      });
    }
  }

  // Check env values for secrets and sensitive paths
  for (const [key, value] of Object.entries(pkg.env)) {
    // Secrets in env values
    for (const sp of SECRET_PATTERNS) {
      if (sp.pattern.test(value)) {
        findings.push({
          severity: "error",
          rule: "hardcoded-secret",
          location: `package.env.${key}`,
          message: `Possible ${sp.name} found in env value.`,
        });
      }
    }

    // Sensitive path references
    if (/\/(etc\/passwd|etc\/shadow|\.ssh|\.aws|\.gnupg)/i.test(value)) {
      findings.push({
        severity: "warn",
        rule: "unsafe-env-var",
        location: `package.env.${key}`,
        message: `Env var references a sensitive system path: "${value}"`,
      });
    }
  }

  // Check description for secrets
  if (pkg.description) {
    for (const sp of SECRET_PATTERNS) {
      if (sp.pattern.test(pkg.description)) {
        findings.push({
          severity: "error",
          rule: "hardcoded-secret",
          location: "package.description",
          message: `Possible ${sp.name} found in description.`,
        });
      }
    }
  }

  return findings;
}

export function buildScanResult(findings: ScanFinding[]): ScanResult {
  return {
    findings,
    summary: {
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warn").length,
      info: findings.filter((f) => f.severity === "info").length,
    },
    scannedAt: new Date().toISOString(),
  };
}

// ── Helpers ──

const SAFE_DOMAINS = [
  "github.com",
  "npmjs.com",
  "pypi.org",
  "docs.anthropic.com",
  "platform.openai.com",
  "pointyhat.org",
  "api.pointyhat.org",
  "wikipedia.org",
  "stackoverflow.com",
  "developer.mozilla.org",
];

function isSafeDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return SAFE_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
