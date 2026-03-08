export type SnippetExecutionMode =
  | "paste_and_run"
  | "paste_only"
  | "execute_as_script";

interface SnippetExecutionContext {
  isWindows?: boolean;
}

export const SNIPPET_EXECUTION_MODE_OPTIONS = [
  {
    value: "paste_and_run",
    label: "Paste and run",
    description: "Paste into the terminal and submit immediately.",
  },
  {
    value: "paste_only",
    label: "Paste only",
    description: "Paste into the terminal without pressing Enter.",
  },
  {
    value: "execute_as_script",
    label: "Execute as script",
    description:
      "Run as a script in the terminal environment.",
  },
] as const satisfies ReadonlyArray<{
  value: SnippetExecutionMode;
  label: string;
  description: string;
}>;

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

export function getSnippetExecutionModeLabel(mode: SnippetExecutionMode): string {
  return (
    SNIPPET_EXECUTION_MODE_OPTIONS.find((option) => option.value === mode)?.label ??
    "Paste and run"
  );
}

export function buildSnippetTerminalInput(
  command: string,
  executionMode: SnippetExecutionMode,
  context: SnippetExecutionContext = {}
): string {
  const normalizedCommand = command.replace(/\r\n/g, "\n");
  if (!normalizedCommand) {
    return "";
  }

  switch (executionMode) {
    case "paste_only":
      return buildPasteInput(normalizedCommand, false);
    case "execute_as_script":
      return buildPasteInput(buildScriptExecutionCommand(normalizedCommand, context), true);
    case "paste_and_run":
    default:
      return buildPasteInput(normalizedCommand, true);
  }
}

function buildPasteInput(command: string, shouldSubmit: boolean): string {
  if (command.includes("\n")) {
    return `${BRACKETED_PASTE_START}${command}${BRACKETED_PASTE_END}${shouldSubmit ? "\r" : ""}`;
  }

  return shouldSubmit ? `${command}\r` : command;
}

function buildScriptExecutionCommand(
  command: string,
  context: SnippetExecutionContext
): string {
  if (context.isWindows) {
    return buildPowerShellExecutionCommand(command);
  }

  return "env sh -c 'exec \"${SHELL:-/bin/sh}\" -c \"$1\"' sh " + quoteForShellArgument(command);
}

function buildPowerShellExecutionCommand(command: string): string {
  return `powershell.exe -NoProfile -EncodedCommand ${encodePowerShellCommand(command)}`;
}

function encodePowerShellCommand(command: string): string {
  const bytes: number[] = [];

  for (let index = 0; index < command.length; index += 1) {
    const codeUnit = command.charCodeAt(index);
    bytes.push(codeUnit & 0xff, codeUnit >> 8);
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  return Buffer.from(binary, "binary").toString("base64");
}

function quoteForShellArgument(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
