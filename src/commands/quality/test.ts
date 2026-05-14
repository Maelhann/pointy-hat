import type { Command } from "commander";
import { ConfigManager } from "../../core/config-manager.js";
import { RegistryClient } from "../../core/registry-client.js";
import { Cache } from "../../core/cache.js";
import { McpSubprocess } from "../../core/mcp-subprocess.js";
import { resolvePackage } from "../../core/mcp-resolver.js";
import { handleError } from "../../core/error-handler.js";
import { withSpinner } from "../../ui/spinner.js";
import { printTable } from "../../ui/table.js";
import { formatSuccess, formatWarning, printResult } from "../../ui/format.js";
import type { TestResult, ToolTestResult, ResourceTestResult } from "../../types/quality.js";
import chalk from "chalk";

export function registerQualityTestCommand(qualityCmd: Command): void {
  qualityCmd
    .command("test <package>")
    .description("Test an MCP package by starting it and calling its tools")
    .option("--timeout <ms>", "Timeout per tool call in ms", "10000")
    .option("-v, --verbose", "Verbose output")
    .option("--json", "Output as JSON")
    .action(async (packageName: string, opts: {
      timeout: string;
      verbose?: boolean;
      json?: boolean;
    }) => {
      let subprocess: McpSubprocess | null = null;

      try {
        const configManager = new ConfigManager();
        const userConfig = await configManager.loadUserConfig();
        const cache = new Cache(userConfig.cache?.directory);
        const registryClient = new RegistryClient({
          baseUrl: userConfig.registry?.url,
          timeout: userConfig.registry?.timeout,
          cache,
        });

        const timeout = parseInt(opts.timeout, 10);

        // Resolve package
        const resolved = await withSpinner(
          `Resolving ${chalk.bold(packageName)}`,
          () => resolvePackage(packageName, registryClient),
        );

        // Start MCP server
        subprocess = new McpSubprocess(
          resolved.command,
          resolved.args,
          resolved.env,
          timeout,
        );

        await withSpinner(
          `Starting MCP server: ${resolved.command} ${resolved.args.join(" ")}`,
          () => subprocess!.start(),
        );

        const serverInfo = subprocess.getServerInfo();
        if (opts.verbose && serverInfo) {
          console.log(chalk.dim(`  Server: ${serverInfo.serverInfo.name} v${serverInfo.serverInfo.version || "?"}`));
        }

        // Test tools
        const tools = await subprocess.listTools();
        const toolResults: ToolTestResult[] = [];

        for (const tool of tools) {
          const start = Date.now();
          try {
            // Generate minimal input based on schema
            const minimalInput = generateMinimalInput(tool.inputSchema);

            if (opts.verbose) {
              console.log(chalk.dim(`  Testing tool: ${tool.name}(${JSON.stringify(minimalInput).slice(0, 60)})`));
            }

            await subprocess.callTool(tool.name, minimalInput);

            toolResults.push({
              name: tool.name,
              success: true,
              responseTimeMs: Date.now() - start,
            });
          } catch (err) {
            toolResults.push({
              name: tool.name,
              success: false,
              responseTimeMs: Date.now() - start,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Test resources
        const resourceResults: ResourceTestResult[] = [];
        try {
          const resources = await subprocess.listResources();
          for (const resource of resources) {
            try {
              await subprocess.readResource(resource.uri);
              resourceResults.push({ uri: resource.uri, accessible: true });
            } catch (err) {
              resourceResults.push({
                uri: resource.uri,
                accessible: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } catch {
          // Server may not support resources — that's OK
        }

        // Build result
        const successCount = toolResults.filter((t) => t.success).length;
        const toolCoverage = tools.length > 0 ? successCount / tools.length : 1;
        const avgResponseTime = toolResults.length > 0
          ? toolResults.reduce((sum, t) => sum + t.responseTimeMs, 0) / toolResults.length
          : 0;

        const result: TestResult = {
          packageName: resolved.name,
          toolResults,
          resourceResults,
          overallScore: toolCoverage * 100,
          duration: toolResults.reduce((sum, t) => sum + t.responseTimeMs, 0),
          testedAt: new Date().toISOString(),
        };

        // Output
        if (opts.json) {
          printResult(result, "json");
          return;
        }

        console.log(`\n${chalk.bold("Quality Test Report:")} ${chalk.magenta(resolved.name)} v${resolved.version}\n`);

        // Tools table
        if (toolResults.length > 0) {
          printTable(
            ["Tool", "Status", "Response Time", "Error"],
            toolResults.map((t) => [
              t.name,
              t.success ? chalk.green("PASS") : chalk.red("FAIL"),
              `${t.responseTimeMs}ms`,
              t.error ? chalk.dim(t.error.slice(0, 50)) : "-",
            ]),
          );
        }

        // Resources table
        if (resourceResults.length > 0) {
          console.log(chalk.bold("\nResources:"));
          printTable(
            ["URI", "Accessible"],
            resourceResults.map((r) => [
              r.uri,
              r.accessible ? chalk.green("YES") : chalk.red("NO"),
            ]),
          );
        }

        // Summary
        console.log(`\nTool coverage: ${chalk.bold(String(Math.round(toolCoverage * 100)))}%`);
        console.log(`Avg response time: ${chalk.bold(String(Math.round(avgResponseTime)))}ms`);
        console.log(`Overall score: ${chalk.bold(String(Math.round(result.overallScore)))}/100\n`);

        if (toolCoverage === 1) {
          console.log(formatSuccess("All tools passed."));
        } else {
          console.log(formatWarning(`${toolResults.length - successCount} tool(s) failed.`));
        }
      } catch (err) {
        handleError(err);
        process.exit(1);
      } finally {
        subprocess?.kill();
      }
    });
}

function generateMinimalInput(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (!schema || schema.type !== "object") return result;

  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required || []) as string[];

  for (const key of required) {
    const prop = properties[key];
    if (!prop) continue;

    switch (prop.type) {
      case "string":
        result[key] = (prop.default as string) || "test";
        break;
      case "number":
      case "integer":
        result[key] = (prop.default as number) || 0;
        break;
      case "boolean":
        result[key] = (prop.default as boolean) || false;
        break;
      case "array":
        result[key] = (prop.default as unknown[]) || [];
        break;
      case "object":
        result[key] = (prop.default as Record<string, unknown>) || {};
        break;
      default:
        result[key] = null;
    }
  }

  return result;
}
