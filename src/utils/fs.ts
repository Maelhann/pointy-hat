import { readFile as nodeReadFile, writeFile as nodeWriteFile, mkdir, access, readdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseJsonc } from "jsonc-parser";

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readFile(path: string): Promise<string> {
  return nodeReadFile(path, "utf-8");
}

export async function writeFile(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await nodeWriteFile(path, content, "utf-8");
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  const content = await readFile(path);
  return JSON.parse(content) as T;
}

export async function writeJsonFile(
  path: string,
  data: unknown,
  indent: number = 2,
): Promise<void> {
  const content = JSON.stringify(data, null, indent) + "\n";
  await writeFile(path, content);
}

export async function readJsoncFile<T = unknown>(path: string): Promise<T> {
  const content = await readFile(path);
  return parseJsonc(content) as T;
}

export function getConfigDir(): string {
  return join(homedir(), ".pointyhat");
}

export function getCacheDir(): string {
  return join(getConfigDir(), "cache");
}

export function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return join(homedir(), p.slice(1));
  }
  // Handle %APPDATA% and similar Windows env vars
  return p.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] || "");
}

export async function findUpward(
  filename: string,
  startDir?: string,
): Promise<string | null> {
  let dir = resolve(startDir || process.cwd());
  const root = dirname(dir) === dir ? dir : undefined;

  while (true) {
    const candidate = join(dir, filename);
    if (await fileExists(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir || parent === root) {
      return null;
    }
    dir = parent;
  }
}

export async function listFiles(dir: string, extension?: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (extension) {
      files = files.filter((f) => f.endsWith(extension));
    }
    return files;
  } catch {
    return [];
  }
}
