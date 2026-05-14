import { join } from "node:path";
import { readdir, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileExists, readFile, writeFile, ensureDir, getCacheDir } from "../utils/fs.js";

export class Cache {
  private dir: string;

  constructor(cacheDir?: string) {
    this.dir = cacheDir || getCacheDir();
  }

  async get(key: string): Promise<string | null> {
    const path = this.keyPath(key);
    const metaPath = path + ".meta";

    if (!(await fileExists(path))) return null;

    // Check expiry
    if (await fileExists(metaPath)) {
      try {
        const meta = JSON.parse(await readFile(metaPath)) as { expiresAt: number };
        if (Date.now() > meta.expiresAt) {
          return null; // Expired
        }
      } catch {
        // Invalid meta, treat as no cache
        return null;
      }
    }

    return readFile(path);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const path = this.keyPath(key);
    await ensureDir(this.dir);
    await writeFile(path, value);

    if (ttlSeconds) {
      const metaPath = path + ".meta";
      await writeFile(
        metaPath,
        JSON.stringify({ expiresAt: Date.now() + ttlSeconds * 1000 }),
      );
    }
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async delete(key: string): Promise<void> {
    const path = this.keyPath(key);
    const metaPath = path + ".meta";
    try {
      await unlink(path);
    } catch {}
    try {
      await unlink(metaPath);
    } catch {}
  }

  async clear(): Promise<void> {
    try {
      const entries = await readdir(this.dir);
      await Promise.all(
        entries.map((entry) => unlink(join(this.dir, entry)).catch(() => {})),
      );
    } catch {
      // Directory may not exist
    }
  }

  async clearExpired(): Promise<void> {
    try {
      const entries = await readdir(this.dir);
      const metaFiles = entries.filter((e) => e.endsWith(".meta"));

      for (const metaFile of metaFiles) {
        const metaPath = join(this.dir, metaFile);
        try {
          const meta = JSON.parse(await readFile(metaPath)) as { expiresAt: number };
          if (Date.now() > meta.expiresAt) {
            const dataPath = metaPath.replace(/\.meta$/, "");
            await unlink(metaPath).catch(() => {});
            await unlink(dataPath).catch(() => {});
          }
        } catch {
          // Invalid meta file, remove it
          await unlink(metaPath).catch(() => {});
        }
      }
    } catch {
      // Directory may not exist
    }
  }

  async getSize(): Promise<number> {
    let totalBytes = 0;
    try {
      const entries = await readdir(this.dir);
      for (const entry of entries) {
        try {
          const s = await stat(join(this.dir, entry));
          totalBytes += s.size;
        } catch {}
      }
    } catch {
      // Directory may not exist
    }
    return totalBytes;
  }

  getCacheKey(url: string): string {
    return createHash("sha256").update(url).digest("hex");
  }

  private keyPath(key: string): string {
    // Sanitize key for filesystem
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.dir, safe);
  }
}
