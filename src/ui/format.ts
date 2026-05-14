import chalk from "chalk";
import { error as errorColor, success as successColor, warning as warningColor, dim } from "./colors.js";

export type OutputFormat = "human" | "json";

export function formatOutput(data: unknown, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }
  // Human-readable: if string, return as-is. Otherwise pretty-print key-values.
  if (typeof data === "string") return data;
  if (typeof data === "object" && data !== null) {
    return Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => `${chalk.bold(k)}: ${v}`)
      .join("\n");
  }
  return String(data);
}

export function printResult(data: unknown, format: OutputFormat): void {
  console.log(formatOutput(data, format));
}

export function formatError(
  code: string,
  message: string,
  suggestions?: string[],
): string {
  let output = `\n${errorColor("Error")} ${dim(`[${code}]`)}: ${message}\n`;
  if (suggestions && suggestions.length > 0) {
    output += `\n${chalk.bold("Suggestions:")}\n`;
    for (const s of suggestions) {
      output += `  ${dim("→")} ${s}\n`;
    }
  }
  return output;
}

export function formatSuccess(message: string): string {
  return `${successColor("✓")} ${message}`;
}

export function formatWarning(message: string): string {
  return `${warningColor("!")} ${message}`;
}
