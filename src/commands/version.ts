import { resolve, join } from "node:path";
import type { Command } from "commander";
import { handleError, E_SPELL_INVALID } from "../core/error-handler.js";
import { formatSuccess } from "../ui/format.js";
import { bumpVersion } from "../utils/semver.js";
import { readFile, writeFile, fileExists } from "../utils/fs.js";
import { readYamlFile, writeYamlFile } from "../utils/yaml.js";
import chalk from "chalk";
import fg from "fast-glob";

export function registerVersionCommand(program: Command): void {
  program
    .command("version [level]")
    .description("Bump the spell version (major, minor, patch)")
    .action(async (level: string | undefined) => {
      try {
        const bumpLevel = (level || "patch") as "major" | "minor" | "patch";
        if (!["major", "minor", "patch"].includes(bumpLevel)) {
          throw E_SPELL_INVALID(`Invalid version level "${level}". Use major, minor, or patch.`);
        }

        // Find spell file
        const spellPath = await findSpellFile();
        if (!spellPath) {
          throw E_SPELL_INVALID("No spell file found in current directory.");
        }

        // Read and bump
        const yamlData = await readYamlFile<{ spell: { version: string; name: string } }>(spellPath);
        const oldVersion = yamlData.spell.version;
        const newVersion = bumpVersion(oldVersion, bumpLevel);

        yamlData.spell.version = newVersion;
        await writeYamlFile(spellPath, yamlData);

        console.log(formatSuccess(
          `${yamlData.spell.name}: ${chalk.dim(oldVersion)} -> ${chalk.bold(newVersion)}`,
        ));
      } catch (err) {
        handleError(err);
        process.exit(1);
      }
    });
}

async function findSpellFile(): Promise<string | null> {
  const matches = await fg("*.spell.yaml", { cwd: process.cwd(), absolute: true });
  if (matches.length >= 1) return matches[0];

  const spellYaml = join(process.cwd(), "spell.yaml");
  if (await fileExists(spellYaml)) return spellYaml;

  return null;
}
