#!/usr/bin/env bun

const targets = [
  { target: "bun-darwin-arm64", output: "pointyhat-darwin-arm64" },
  { target: "bun-darwin-x64", output: "pointyhat-darwin-x64" },
  { target: "bun-linux-x64", output: "pointyhat-linux-x64" },
  { target: "bun-linux-arm64", output: "pointyhat-linux-arm64" },
  { target: "bun-windows-x64", output: "pointyhat-win-x64.exe" },
] as const;

const args = process.argv.slice(2);
const targetFlag = args.find((a) => a.startsWith("--target="));
const selectedTarget = targetFlag?.split("=")[1];

const toBuild = selectedTarget
  ? targets.filter((t) => t.target === selectedTarget)
  : targets;

if (toBuild.length === 0) {
  console.error(`Unknown target: ${selectedTarget}`);
  console.error(`Valid targets: ${targets.map((t) => t.target).join(", ")}`);
  process.exit(1);
}

console.log(`Building ${toBuild.length} target(s)...\n`);

for (const { target, output } of toBuild) {
  console.log(`  Building ${target} -> dist/${output}`);
  const proc = Bun.spawnSync([
    "bun",
    "build",
    "src/index.ts",
    "--compile",
    `--target=${target}`,
    `--outfile=dist/${output}`,
  ]);

  if (proc.exitCode !== 0) {
    console.error(`  Failed to build ${target}:`);
    console.error(proc.stderr.toString());
    process.exit(1);
  }

  const file = Bun.file(`dist/${output}`);
  const size = await file.exists()
    ? `${(file.size! / 1024 / 1024).toFixed(1)} MB`
    : "unknown size";
  console.log(`  Done: ${size}\n`);
}

console.log("Build complete.");
