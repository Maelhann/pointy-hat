import semver from "semver";

export function isValidVersion(v: string): boolean {
  return semver.valid(v) !== null;
}

export function satisfiesRange(version: string, range: string): boolean {
  return semver.satisfies(version, range);
}

export function bumpVersion(
  version: string,
  level: "major" | "minor" | "patch",
): string {
  const result = semver.inc(version, level);
  if (!result) {
    throw new Error(`Cannot bump version "${version}" by "${level}"`);
  }
  return result;
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  return semver.compare(a, b) as -1 | 0 | 1;
}
