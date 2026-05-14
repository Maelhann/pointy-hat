import type { Command } from "commander";
import { AuthManager } from "../core/auth-manager.js";
import { ConfigManager } from "../core/config-manager.js";
import { handleError } from "../core/error-handler.js";
import { formatSuccess, formatWarning } from "../ui/format.js";
import chalk from "chalk";

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage registry authentication");

  auth
    .command("login")
    .description("Authenticate with registry")
    .option("--token <token>", "Use a token directly")
    .option("--email <email>", "Associate an email with the token")
    .action(async (opts: { token?: string; email?: string }) => {
      try {
        const authManager = new AuthManager();
        const configManager = new ConfigManager();

        if (opts.token) {
          // Direct token login
          await authManager.login({ token: opts.token, email: opts.email });

          await configManager.set("auth.method", "token");
          if (opts.email) {
            await configManager.set("auth.email", opts.email);
          }

          console.log(formatSuccess("Authenticated with token."));
        } else {
          // Browser-based OAuth login
          const userConfig = await configManager.loadUserConfig();
          const registryUrl = userConfig.registry?.url || "https://api.pointyhat.org";

          console.log(chalk.dim("Opening browser for authentication..."));

          try {
            await authManager.loginWithBrowser(registryUrl);

            const email = await authManager.getEmail();
            await configManager.set("auth.method", "oauth");
            if (email) {
              await configManager.set("auth.email", email);
            }

            console.log(formatSuccess(
              email
                ? `Authenticated as ${chalk.bold(email)}.`
                : "Authenticated successfully.",
            ));
          } catch (err) {
            if (err instanceof Error && err.message.includes("auth config")) {
              // Service doesn't have Firebase client config — fall back to token instructions
              console.log(chalk.dim("Browser login not available for this registry."));
              console.log(chalk.dim("Use: pointyhat auth login --token <token>"));
              console.log(chalk.dim("Get a token from https://pointyhat.org/settings/tokens"));
            } else {
              throw err;
            }
          }
        }
      } catch (err) {
        handleError(err);
      }
    });

  auth
    .command("logout")
    .description("Clear stored credentials")
    .action(async () => {
      try {
        const authManager = new AuthManager();
        await authManager.logout();

        const configManager = new ConfigManager();
        await configManager.delete("auth");

        console.log(formatSuccess("Logged out."));
      } catch (err) {
        handleError(err);
      }
    });

  auth
    .command("status")
    .description("Show current auth state")
    .action(async () => {
      try {
        const authManager = new AuthManager();
        const isAuth = await authManager.isAuthenticated();

        if (isAuth) {
          const email = await authManager.getEmail();
          const expiresAt = await authManager.getExpiresAt();

          let status = "Authenticated";
          if (email) status += ` as ${chalk.bold(email)}`;
          if (expiresAt) {
            const expiryDate = new Date(expiresAt);
            const isExpired = Date.now() > expiresAt;
            status += isExpired
              ? chalk.red(` (expired ${expiryDate.toLocaleDateString()})`)
              : chalk.dim(` (expires ${expiryDate.toLocaleDateString()})`);
          }

          console.log(formatSuccess(status));
        } else {
          console.log(formatWarning("Not authenticated. Run `pointyhat auth login`."));
        }
      } catch (err) {
        handleError(err);
      }
    });

  auth
    .command("token")
    .description("Print current token (for CI)")
    .action(async () => {
      try {
        const authManager = new AuthManager();
        const token = await authManager.getToken();

        if (token) {
          // Print raw token to stdout for piping
          process.stdout.write(token);
        } else {
          console.error(formatWarning("No token found. Run `pointyhat auth login`."));
          process.exit(1);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
