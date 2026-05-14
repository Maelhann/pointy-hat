import Table from "cli-table3";
import chalk from "chalk";

export function createTable(head: string[], rows: string[][]): string {
  const table = new Table({
    head: head.map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
  });
  for (const row of rows) {
    table.push(row);
  }
  return table.toString();
}

export function printTable(head: string[], rows: string[][]): void {
  console.log(createTable(head, rows));
}

export function keyValueTable(entries: Record<string, string>): string {
  const table = new Table({
    style: { head: [], border: [] },
    colWidths: [30, 50],
  });
  for (const [key, value] of Object.entries(entries)) {
    table.push([chalk.bold(key), value]);
  }
  return table.toString();
}
