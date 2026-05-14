import { createHash } from "node:crypto";

export function computeSha512(content: string): string {
  const hash = createHash("sha512").update(content).digest("base64");
  return `sha512-${hash}`;
}

export function verifyIntegrity(content: string, expected: string): boolean {
  const computed = computeSha512(content);
  return computed === expected;
}
