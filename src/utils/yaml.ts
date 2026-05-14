import YAML from "yaml";
import { readFile, writeFile } from "./fs.js";

export function parseYaml<T = unknown>(content: string): T {
  return YAML.parse(content) as T;
}

export function stringifyYaml(data: unknown): string {
  return YAML.stringify(data, {
    indent: 2,
    lineWidth: 0, // no wrapping
  });
}

export async function readYamlFile<T = unknown>(path: string): Promise<T> {
  const content = await readFile(path);
  return parseYaml<T>(content);
}

export async function writeYamlFile(
  path: string,
  data: unknown,
): Promise<void> {
  const content = stringifyYaml(data);
  await writeFile(path, content);
}
