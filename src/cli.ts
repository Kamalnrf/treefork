#!/usr/bin/env bun

import { parseArgs } from "node:util";

import { loadConfig } from "./config";
import { CopseError, WorkspaceNotFoundError, createCopse } from "./index";
import type { CopseConfig } from "./types";

const HELP_TEXT = `Usage:
  copse create <name> [--base <ref>]
  copse list
  copse resolve <name>
  copse remove <name> [--force]
  copse checkpoint <command>
  copse --help`;

const CREATE_HELP_TEXT = `Usage:
  copse create <name> [--base <ref>]`;

const LIST_HELP_TEXT = `Usage:
  copse list`;

const RESOLVE_HELP_TEXT = `Usage:
  copse resolve <name>`;

const REMOVE_HELP_TEXT = `Usage:
  copse remove <name> [--force]`;

const CHECKPOINT_HELP_TEXT = `Usage:
  copse checkpoint create <workspace> <name>
  copse checkpoint list <workspace>
  copse checkpoint restore <workspace> <name> [--clean]
  copse checkpoint --help`;

const CHECKPOINT_CREATE_HELP_TEXT = `Usage:
  copse checkpoint create <workspace> <name>`;

const CHECKPOINT_LIST_HELP_TEXT = `Usage:
  copse checkpoint list <workspace>`;

const CHECKPOINT_RESTORE_HELP_TEXT = `Usage:
  copse checkpoint restore <workspace> <name> [--clean]`;

type Writer = Pick<NodeJS.WriteStream, "write">;

function writeLine(writer: Writer, line = ""): void {
  writer.write(`${line}\n`);
}

async function createCliCopse(configOverrides: Omit<CopseConfig, "cwd"> = {}) {
  const cwd = process.cwd();
  const fileConfig = await loadConfig(cwd);

  return createCopse({
    cwd,
    ...fileConfig,
    ...configOverrides,
  });
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
  label = "workspace name",
): string {
  if (positionals.length !== 1) {
    throw new CopseError(`Expected exactly one ${label}.\n${helpText}`);
  }

  return positionals[0]!;
}

function requireWorkspaceAndCheckpointNames(
  positionals: readonly string[],
  helpText: string,
): { workspace: string; name: string } {
  if (positionals.length !== 2) {
    throw new CopseError(
      `Expected exactly one workspace name and one checkpoint name.\n${helpText}`,
    );
  }

  return {
    workspace: positionals[0]!,
    name: positionals[1]!,
  };
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
  const copse = await createCliCopse();
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

  const copse = await createCliCopse();
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
  const copse = await createCliCopse();
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
  const copse = await createCliCopse();

  await copse.workspaces.remove({
    name,
    force: values.force,
  });

  writeLine(stdout, `Removed workspace "${name}".`);
}

async function runCheckpointCreate(
  args: readonly string[],
  stdout: Writer,
): Promise<void> {
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
    writeLine(stdout, CHECKPOINT_CREATE_HELP_TEXT);
    return;
  }

  const { workspace, name } = requireWorkspaceAndCheckpointNames(
    positionals,
    CHECKPOINT_CREATE_HELP_TEXT,
  );
  const copse = await createCliCopse();
  const checkpoint = await copse.checkpoints.create({
    workspace,
    name,
  });

  writeLine(stdout, checkpoint.ref);
}

async function runCheckpointList(
  args: readonly string[],
  stdout: Writer,
): Promise<void> {
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
    writeLine(stdout, CHECKPOINT_LIST_HELP_TEXT);
    return;
  }

  const workspace = requireSingleName(
    positionals,
    CHECKPOINT_LIST_HELP_TEXT,
    "workspace name",
  );
  const copse = await createCliCopse();
  const checkpoints = await copse.checkpoints.list({ workspace });
  const rows = checkpoints.map((checkpoint) => [checkpoint.name, checkpoint.commit]);

  writeLine(stdout, formatTable(["NAME", "COMMIT"], rows));
}

async function runCheckpointRestore(
  args: readonly string[],
  stdout: Writer,
): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      clean: {
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
    writeLine(stdout, CHECKPOINT_RESTORE_HELP_TEXT);
    return;
  }

  const { workspace, name } = requireWorkspaceAndCheckpointNames(
    positionals,
    CHECKPOINT_RESTORE_HELP_TEXT,
  );
  const copse = await createCliCopse();

  await copse.checkpoints.restore({
    workspace,
    name,
    clean: values.clean,
  });

  writeLine(stdout, `Restored checkpoint "${name}" for workspace "${workspace}".`);
}

async function runCheckpoint(args: readonly string[], stdout: Writer): Promise<void> {
  const [command, ...rest] = args;

  if (isHelpCommand(command)) {
    writeLine(stdout, CHECKPOINT_HELP_TEXT);
    return;
  }

  switch (command) {
    case "create":
      await runCheckpointCreate(rest, stdout);
      return;
    case "list":
      await runCheckpointList(rest, stdout);
      return;
    case "restore":
      await runCheckpointRestore(rest, stdout);
      return;
    default:
      throw new CopseError(`Unknown checkpoint command "${command}".\n${CHECKPOINT_HELP_TEXT}`);
  }
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
      case "checkpoint":
        await runCheckpoint(rest, stdout);
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
