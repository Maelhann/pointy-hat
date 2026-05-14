import chalk from "chalk";

export const primary = chalk.blue;
export const success = chalk.green;
export const warning = chalk.yellow;
export const error = chalk.red;
export const dim = chalk.gray;
export const bold = chalk.bold;
export const accent = chalk.magenta;

export function highlight(text: string): string {
  return chalk.bold.blue(text);
}

export function code(text: string): string {
  return chalk.gray(`\`${text}\``);
}

export function brand(): string {
  return chalk.bold.magenta("Pointy Hat");
}

export function statusIcon(status: "ok" | "warn" | "fail" | "info"): string {
  switch (status) {
    case "ok":
      return chalk.green("✓");
    case "warn":
      return chalk.yellow("!");
    case "fail":
      return chalk.red("✗");
    case "info":
      return chalk.blue("i");
  }
}
