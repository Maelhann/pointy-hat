import ora, { type Ora } from "ora";
import chalk from "chalk";

export interface StepProgress {
  update(step: number, label: string): void;
  complete(): void;
  fail(message: string): void;
}

export function createProgressBar(
  total: number,
  label: string,
): StepProgress {
  const spinner = ora({ text: `${label} [0/${total}]`, spinner: "dots" }).start();

  return {
    update(step: number, stepLabel: string) {
      const pct = Math.round((step / total) * 100);
      const bar = renderBar(pct);
      spinner.text = `${bar} ${chalk.dim(`[${step}/${total}]`)} ${stepLabel}`;
    },
    complete() {
      spinner.succeed(`${label} - complete`);
    },
    fail(message: string) {
      spinner.fail(`${label} - ${message}`);
    },
  };
}

function renderBar(pct: number): string {
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return chalk.magenta("█".repeat(filled)) + chalk.gray("░".repeat(empty));
}
