import { DEFAULT_REGISTRY_URL } from "../types/config.js";

export async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs: number = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function isOnline(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${DEFAULT_REGISTRY_URL}/health`,
      { method: "HEAD" },
      5000,
    );
    return response.ok;
  } catch {
    // Fallback: try a well-known endpoint
    try {
      await fetchWithTimeout("https://httpbin.org/status/200", { method: "HEAD" }, 3000);
      return true;
    } catch {
      return false;
    }
  }
}
