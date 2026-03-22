#!/usr/bin/env bun

import { parseArgs } from "node:util";

import { CopseError, WorkspaceNotFoundError, createCopse } from "./index";

const HELP_TEXT = `Usage:
  copse create <name> [--base <ref>]
  copse list
  copse resolve <name>
  copse remove <name> [--force]
  copse --help`;

const CREATE_HELP_TEXT = `Usage:
  copse create <name> [--base <ref>]`;

const LIST_HELP_TEXT = `Usage:
  copse list`;

const RESOLVE_HELP_TEXT = `Usage:
  copse resolve <name>`;

const REMOVE_HELP_TEXT = `Usage:
  copse remove <name> [--force]`;

type Writer = Pick<NodeJS.WriteStream, "write">;

function writeLine(writer: Writer, line = ""): void {
  writer.write(`${line}\n`);
}

function formatTable(headers: readonly string[], rows: readonly string[][]): string {
  const widths = headers.map((header, columnIndex) =>
    rows.reduce(
      (width, row) => Math.max(width, row[columnIndex]?.length ?? 0),
      header.length,
    ),
  );

  const formatRow = (row: readonly string[]) =>
    row
      .map((value, columnIndex) => value.padEnd(widths[columnIndex] ?? value.length))
      .join("  ");

  const separator = widths.map((width) => "-".repeat(width));

  return [formatRow(headers), formatRow(separator), ...rows.map(formatRow)].join("\n");
}

function ensureNoExtraPositionals(
  positionals: readonly string[],
  helpText: string,
): void {
  if (positionals.length > 0) {
    throw new CopseError(`Unexpected argument "${positionals[0]}".\n${helpText}`);
  }
}

function requireSingleName(
  positionals: readonly string[],
  helpText: string,
): string {
  if (positionals.length !== 1) {
    throw new CopseError(`Expected exactly one workspace name.\n${helpText}`);
  }

  return positionals[0]!;
}

async function runCreate(args: readonly string[], stdout: Writer): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      base: {
        type: "string",
      },
      help: {
        type: "boolean",
        short: "h",
      },
    },
    strict: true,
  });

  if (values.help) {
    writeLine(stdout, CREATE_HELP_TEXT);
    return;
  }

  const name = requireSingleName(positionals, CREATE_HELP_TEXT);
  const copse = await createCopse();
  const workspace = await copse.workspaces.create({
    name,
    baseRef: values.base,
  });

  writeLine(stdout, workspace.path);
}

async function runList(args: readonly string[], stdout: Writer): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: {
        type: "boolean",
        short: "h",
      },
    },
    strict: true,
  });

  if (values.help) {
    writeLine(stdout, LIST_HELP_TEXT);
    return;
  }

  ensureNoExtraPositionals(positionals, LIST_HELP_TEXT);

  const copse = await createCopse();
  const workspaces = await copse.workspaces.list();
  const rows = workspaces.map((workspace) => [
    workspace.name,
    workspace.branch,
    workspace.path,
    workspace.head,
  ]);

  writeLine(stdout, formatTable(["NAME", "BRANCH", "PATH", "HEAD"], rows));
}

async function runResolve(args: readonly string[], stdout: Writer): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: {
        type: "boolean",
        short: "h",
      },
    },
    strict: true,
  });

  if (values.help) {
    writeLine(stdout, RESOLVE_HELP_TEXT);
    return;
  }

  const name = requireSingleName(positionals, RESOLVE_HELP_TEXT);
  const copse = await createCopse();
  const workspace = await copse.workspaces.resolve({ name });

  if (workspace === null) {
    throw new WorkspaceNotFoundError(`Workspace "${name}" was not found.`);
  }

  writeLine(stdout, workspace.path);
}

async function runRemove(args: readonly string[], stdout: Writer): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      force: {
        type: "boolean",
      },
      help: {
        type: "boolean",
        short: "h",
      },
    },
    strict: true,
  });

  if (values.help) {
    writeLine(stdout, REMOVE_HELP_TEXT);
    return;
  }

  const name = requireSingleName(positionals, REMOVE_HELP_TEXT);
  const copse = await createCopse();

  await copse.workspaces.remove({
    name,
    force: values.force,
  });

  writeLine(stdout, `Removed workspace "${name}".`);
}

function isHelpCommand(command: string | undefined): boolean {
  return command === undefined || command === "--help" || command === "-h" || command === "help";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function runCli(
  argv: readonly string[],
  stdout: Writer = process.stdout,
  stderr: Writer = process.stderr,
): Promise<number> {
  try {
    const [command, ...rest] = argv;

    if (isHelpCommand(command)) {
      writeLine(stdout, HELP_TEXT);
      return 0;
    }

    switch (command) {
      case "create":
        await runCreate(rest, stdout);
        return 0;
      case "list":
        await runList(rest, stdout);
        return 0;
      case "resolve":
        await runResolve(rest, stdout);
        return 0;
      case "remove":
        await runRemove(rest, stdout);
        return 0;
      default:
        throw new CopseError(`Unknown command "${command}".\n${HELP_TEXT}`);
    }
  } catch (error) {
    writeLine(stderr, toErrorMessage(error));
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
