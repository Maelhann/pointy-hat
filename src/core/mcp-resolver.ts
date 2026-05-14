import type { McpInstallSpec } from "../types/mcp-package.js";
import type { PlatformId } from "../types/platform.js";
import type { RegistryClient } from "./registry-client.js";
import { satisfiesRange, compareVersions } from "../utils/semver.js";
import { E_MCP_NOT_FOUND, E_VERSION_NOT_FOUND } from "./error-handler.js";

export interface ResolvedPackage {
  name: string;
  version: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  transport: string;
  integrity: string;
}

export async function resolvePackage(
  name: string,
  registryClient: RegistryClient,
  platform?: PlatformId,
): Promise<ResolvedPackage> {
  // 1. Query registry for package metadata
  const pkg = await registryClient.getPackage(name);
  if (!pkg) throw E_MCP_NOT_FOUND(name);

  // 2. Check platform compatibility if specified
  if (platform && pkg.platforms.length > 0 && !pkg.platforms.includes(platform)) {
    // Package declares platforms but doesn't list the target — still allow but warn
  }

  // 3. Build resolved package
  return {
    name: pkg.name,
    version: pkg.version,
    command: pkg.command || "npx",
    args: pkg.args.length > 0 ? pkg.args : [`-y`, pkg.name],
    env: pkg.env,
    transport: pkg.transport,
    integrity: findIntegrity(pkg.versions, pkg.version),
  };
}

export async function resolveVersion(
  name: string,
  range: string,
  registryClient: RegistryClient,
): Promise<string> {
  const versionsInfo = await registryClient.getPackageVersions(name);

  // Find the latest version satisfying the semver range
  const matching = versionsInfo.versions
    .filter((v) => satisfiesRange(v.version, range))
    .sort((a, b) => compareVersions(b.version, a.version)); // descending

  if (matching.length === 0) {
    throw E_VERSION_NOT_FOUND(name, range);
  }

  return matching[0].version;
}

export function buildInstallSpec(
  resolved: ResolvedPackage,
  platform: PlatformId,
  configPath: string,
): McpInstallSpec {
  return {
    command: resolved.command,
    args: resolved.args,
    env: resolved.env,
    configPath,
    platform,
  };
}

function findIntegrity(
  versions: Array<{ version: string; integrity?: string }>,
  targetVersion: string,
): string {
  const entry = versions.find((v) => v.version === targetVersion);
  return entry?.integrity || "";
}
