import { join } from "node:path";
import { chmod } from "node:fs/promises";
import { fileExists, readFile, writeFile, getConfigDir } from "../utils/fs.js";
import { E_AUTH_EXPIRED, E_AUTH_REQUIRED } from "./error-handler.js";

interface StoredAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix timestamp ms
  email?: string;
  firebaseApiKey?: string; // Stored for token refresh
}

export class AuthManager {
  private authFilePath: string;

  constructor(configDir?: string) {
    this.authFilePath = join(configDir || getConfigDir(), "auth.json");
  }

  async login(options?: { token?: string; email?: string }): Promise<void> {
    if (!options?.token) {
      throw new Error(
        "Use loginWithBrowser() for OAuth or --token flag for token auth.",
      );
    }

    const auth: StoredAuth = {
      accessToken: options.token,
      email: options.email,
    };

    await this.writeAuthFile(auth);
  }

  /**
   * Browser-based OAuth login flow:
   * 1. Fetches Firebase client config from the registry service
   * 2. Starts a local HTTP server
   * 3. Opens a browser to the login page
   * 4. Receives the token via callback
   * 5. Stores the credentials
   */
  async loginWithBrowser(registryUrl: string): Promise<void> {
    // 1. Fetch Firebase client config from service
    const configResp = await fetch(`${registryUrl}/v1/auth/config`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!configResp.ok) {
      throw new Error(
        "Could not fetch auth config from the registry. Use --token flag instead:\n  pointyhat auth login --token <token>",
      );
    }
    const firebaseConfig = (await configResp.json()) as {
      apiKey: string;
      authDomain: string;
      projectId: string;
    };

    // 2. Start local HTTP server and wait for callback
    const { createServer } = await import("node:http");
    const { exec } = await import("node:child_process");

    return new Promise<void>((resolve, reject) => {
      let resolved = false;

      const server = createServer(async (req, res) => {
        const url = new URL(req.url!, `http://localhost`);

        if (url.pathname === "/login" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(getLoginPage(firebaseConfig));
        } else if (url.pathname === "/callback" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", async () => {
            try {
              const data = JSON.parse(body) as {
                token: string;
                refreshToken: string;
                email: string;
                expiresIn: number;
              };

              await this.writeAuthFile({
                accessToken: data.token,
                refreshToken: data.refreshToken,
                expiresAt: data.expiresIn
                  ? Date.now() + data.expiresIn * 1000
                  : undefined,
                email: data.email,
                firebaseApiKey: firebaseConfig.apiKey,
              });

              res.writeHead(200, {
                "Content-Type": "application/json",
              });
              res.end(JSON.stringify({ ok: true }));

              resolved = true;
              server.close();
              resolve();
            } catch {
              res.writeHead(500);
              res.end("Internal error");
            }
          });
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        const loginUrl = `http://127.0.0.1:${addr.port}/login`;

        // Open browser
        const platform = process.platform;
        const cmd =
          platform === "win32"
            ? `start "" "${loginUrl}"`
            : platform === "darwin"
              ? `open "${loginUrl}"`
              : `xdg-open "${loginUrl}"`;

        exec(cmd, (err) => {
          if (err) {
            // If we can't auto-open, user can still manually navigate
            // The URL is printed by the caller
          }
        });
      });

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        if (!resolved) {
          server.close();
          reject(new Error("Login timed out after 5 minutes."));
        }
      }, 5 * 60 * 1000);

      // Clean up timeout on success
      server.on("close", () => clearTimeout(timeout));
    });
  }

  /** Returns the local server port so the caller can print the URL. */
  getLoginUrl(port: number): string {
    return `http://127.0.0.1:${port}/login`;
  }

  async logout(): Promise<void> {
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(this.authFilePath);
    } catch {
      // File may not exist
    }
  }

  async getToken(): Promise<string | null> {
    const auth = await this.readAuthFile();
    if (!auth) return null;

    // Check expiry with 60-second buffer
    if (auth.expiresAt && Date.now() > auth.expiresAt - 60_000) {
      // Try auto-refresh if we have credentials
      if (auth.refreshToken && auth.firebaseApiKey) {
        try {
          await this.refreshAccessToken();
          const refreshed = await this.readAuthFile();
          return refreshed?.accessToken || null;
        } catch {
          return null;
        }
      }
      return null;
    }

    return auth.accessToken;
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }

  async getEmail(): Promise<string | null> {
    const auth = await this.readAuthFile();
    return auth?.email || null;
  }

  async getExpiresAt(): Promise<number | null> {
    const auth = await this.readAuthFile();
    return auth?.expiresAt || null;
  }

  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    if (!token) {
      throw E_AUTH_REQUIRED();
    }
    return { Authorization: `Bearer ${token}` };
  }

  async refreshToken(): Promise<void> {
    const auth = await this.readAuthFile();
    if (auth?.refreshToken && auth?.firebaseApiKey) {
      await this.refreshAccessToken();
      return;
    }
    throw E_AUTH_EXPIRED();
  }

  private async refreshAccessToken(): Promise<void> {
    const auth = await this.readAuthFile();
    if (!auth?.refreshToken || !auth?.firebaseApiKey) {
      throw new Error("Cannot refresh: missing refresh token or API key");
    }

    const resp = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(auth.firebaseApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(auth.refreshToken)}`,
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!resp.ok) throw new Error("Token refresh failed");

    const data = (await resp.json()) as {
      id_token: string;
      refresh_token: string;
      expires_in: string;
    };

    await this.writeAuthFile({
      accessToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + parseInt(data.expires_in, 10) * 1000,
      email: auth.email,
      firebaseApiKey: auth.firebaseApiKey,
    });
  }

  private async readAuthFile(): Promise<StoredAuth | null> {
    if (!(await fileExists(this.authFilePath))) return null;
    try {
      const content = await readFile(this.authFilePath);
      return JSON.parse(content) as StoredAuth;
    } catch {
      return null;
    }
  }

  private async writeAuthFile(auth: StoredAuth): Promise<void> {
    await writeFile(this.authFilePath, JSON.stringify(auth, null, 2));
    // Restrict file permissions (best-effort, may not work on Windows)
    try {
      await chmod(this.authFilePath, 0o600);
    } catch {
      // chmod may fail on Windows — acceptable
    }
  }
}

// ── Login HTML page ──

function getLoginPage(config: {
  apiKey: string;
  authDomain: string;
  projectId: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pointy Hat — Sign In</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1e293b;
      border-radius: 12px;
      padding: 40px;
      max-width: 380px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    }
    h1 { font-size: 1.5em; margin-bottom: 8px; }
    .subtitle { color: #94a3b8; margin-bottom: 32px; font-size: 0.9em; }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 12px 20px;
      margin: 10px 0;
      border: 1px solid #334155;
      border-radius: 8px;
      background: #0f172a;
      color: #e2e8f0;
      cursor: pointer;
      font-size: 0.95em;
      transition: background 0.15s;
    }
    .btn:hover { background: #1a2744; border-color: #475569; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn svg { width: 20px; height: 20px; }
    #status { margin-top: 20px; font-size: 0.9em; }
    .success { color: #4ade80; }
    .error { color: #f87171; }
    .spinner { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Pointy Hat</h1>
    <p class="subtitle">Sign in to continue to the CLI</p>
    <div id="buttons">
      <button class="btn" onclick="loginWith('github')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
        Sign in with GitHub
      </button>
      <button class="btn" onclick="loginWith('google')">
        <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        Sign in with Google
      </button>
    </div>
    <div id="status"></div>
  </div>

  <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"><\/script>
  <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"><\/script>
  <script>
    firebase.initializeApp(${JSON.stringify(config)});
    const auth = firebase.auth();

    async function loginWith(provider) {
      const statusEl = document.getElementById("status");
      const btnsEl = document.getElementById("buttons");
      try {
        btnsEl.querySelectorAll("button").forEach(b => b.disabled = true);
        statusEl.innerHTML = '<p class="spinner">Signing in...</p>';

        const p = provider === "github"
          ? new firebase.auth.GithubAuthProvider()
          : new firebase.auth.GoogleAuthProvider();

        const result = await auth.signInWithPopup(p);
        const token = await result.user.getIdToken();
        const refreshToken = result.user.refreshToken;
        const email = result.user.email;

        statusEl.innerHTML = '<p class="spinner">Sending credentials to CLI...</p>';

        await fetch("/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, refreshToken, email, expiresIn: 3600 }),
        });

        btnsEl.style.display = "none";
        statusEl.innerHTML = '<p class="success">Signed in successfully! You can close this tab.</p>';
      } catch (err) {
        btnsEl.querySelectorAll("button").forEach(b => b.disabled = false);
        statusEl.innerHTML = '<p class="error">Sign in failed: ' + err.message + '</p>';
      }
    }
  <\/script>
</body>
</html>`;
}
