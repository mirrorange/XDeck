export type SnippetExecutionMode =
  | "paste_and_run"
  | "paste_only"
  | "execute_as_script";

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
    description: "Run via the current terminal shell using its `-c` flag.",
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
  executionMode: SnippetExecutionMode
): string {
  const normalizedCommand = command.replace(/\r\n/g, "\n");
  if (!normalizedCommand) {
    return "";
  }

  switch (executionMode) {
    case "paste_only":
      return buildPasteInput(normalizedCommand, false);
    case "execute_as_script":
      return buildPasteInput(buildScriptExecutionCommand(normalizedCommand), true);
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

function buildScriptExecutionCommand(command: string): string {
  return "env sh -c 'exec \"${SHELL:-/bin/sh}\" -c \"$1\"' sh " + quoteForShellArgument(command);
}

function quoteForShellArgument(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
