import {
  confirm as inquirerConfirm,
  input as inquirerInput,
  password as inquirerPassword,
  select as inquirerSelect,
  checkbox as inquirerCheckbox,
} from "@inquirer/prompts";

export async function confirm(
  message: string,
  defaultValue: boolean = false,
): Promise<boolean> {
  return inquirerConfirm({ message, default: defaultValue });
}

export async function input(
  message: string,
  defaultValue?: string,
): Promise<string> {
  return inquirerInput({ message, default: defaultValue });
}

export async function password(message: string): Promise<string> {
  return inquirerPassword({ message, mask: "*" });
}

export async function select<T extends string>(
  message: string,
  choices: { name: string; value: T; description?: string }[],
): Promise<T> {
  return inquirerSelect({ message, choices });
}

export async function multiSelect<T extends string>(
  message: string,
  choices: { name: string; value: T }[],
): Promise<T[]> {
  return inquirerCheckbox({ message, choices });
}
