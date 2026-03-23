#!/usr/bin/env node

import { defineCommand, runMain } from "citty";

import { loadConfig } from "./config";
import { WorkspaceNotFoundError, createTreefork } from "./index";
import type { TreeforkConfig } from "./types";

async function createCliTreefork(configOverrides: Omit<TreeforkConfig, "cwd"> = {}) {
  const cwd = process.cwd();
  const fileConfig = await loadConfig(cwd);

  return createTreefork({
    cwd,
    ...fileConfig,
    ...configOverrides,
    repo: configOverrides.repo ?? fileConfig.repo,
  });
}

function formatTable(headers: readonly string[], rows: readonly string[][]): string {
  const widths = headers.map((header, columnIndex) =>
    rows.reduce((width, row) => Math.max(width, row[columnIndex]?.length ?? 0), header.length),
  );

  const formatRow = (row: readonly string[]) =>
    row.map((value, columnIndex) => value.padEnd(widths[columnIndex] ?? value.length)).join("  ");

  const separator = widths.map((width) => "-".repeat(width));

  return [formatRow(headers), formatRow(separator), ...rows.map(formatRow)].join("\n");
}

const createCommand = defineCommand({
  meta: { name: "create", description: "Create a new workspace" },
  args: {
    name: { type: "positional", description: "Workspace name", required: true },
    base: { type: "string", description: "Base ref to create workspace from" },
    repo: { type: "string", description: "Remote git URL to clone from" },
  },
  async run({ args }) {
    const treefork = await createCliTreefork({ repo: args.repo });
    const workspace = await treefork.workspaces.create({
      name: args.name,
      baseRef: args.base,
    });

    console.log(workspace.path);
  },
});

const listCommand = defineCommand({
  meta: { name: "list", description: "List all workspaces" },
  async run() {
    const treefork = await createCliTreefork();
    const workspaces = await treefork.workspaces.list();
    const rows = workspaces.map((workspace) => [
      workspace.name,
      workspace.branch,
      workspace.path,
      workspace.head,
    ]);

    console.log(formatTable(["NAME", "BRANCH", "PATH", "HEAD"], rows));
  },
});

const resolveCommand = defineCommand({
  meta: { name: "resolve", description: "Resolve a workspace path by name" },
  args: {
    name: { type: "positional", description: "Workspace name", required: true },
  },
  async run({ args }) {
    const treefork = await createCliTreefork();
    const workspace = await treefork.workspaces.resolve({ name: args.name });

    if (workspace === null) {
      throw new WorkspaceNotFoundError(`Workspace "${args.name}" was not found.`);
    }

    console.log(workspace.path);
  },
});

const removeCommand = defineCommand({
  meta: { name: "remove", description: "Remove a workspace" },
  args: {
    name: { type: "positional", description: "Workspace name", required: true },
    force: { type: "boolean", description: "Force removal even with uncommitted changes" },
  },
  async run({ args }) {
    const treefork = await createCliTreefork();

    await treefork.workspaces.remove({
      name: args.name,
      force: args.force,
    });

    console.log(`Removed workspace "${args.name}".`);
  },
});

const checkpointCreateCommand = defineCommand({
  meta: { name: "create", description: "Create a checkpoint" },
  args: {
    workspace: { type: "positional", description: "Workspace name", required: true },
    name: { type: "positional", description: "Checkpoint name", required: true },
  },
  async run({ args }) {
    const treefork = await createCliTreefork();
    const checkpoint = await treefork.checkpoints.create({
      workspace: args.workspace,
      name: args.name,
    });

    console.log(checkpoint.ref);
  },
});

const checkpointListCommand = defineCommand({
  meta: { name: "list", description: "List checkpoints for a workspace" },
  args: {
    workspace: { type: "positional", description: "Workspace name", required: true },
  },
  async run({ args }) {
    const treefork = await createCliTreefork();
    const checkpoints = await treefork.checkpoints.list({ workspace: args.workspace });
    const rows = checkpoints.map((checkpoint) => [checkpoint.name, checkpoint.commit]);

    console.log(formatTable(["NAME", "COMMIT"], rows));
  },
});

const checkpointRestoreCommand = defineCommand({
  meta: { name: "restore", description: "Restore a checkpoint" },
  args: {
    workspace: { type: "positional", description: "Workspace name", required: true },
    name: { type: "positional", description: "Checkpoint name", required: true },
    clean: { type: "boolean", description: "Clean untracked files after restore" },
  },
  async run({ args }) {
    const treefork = await createCliTreefork();

    await treefork.checkpoints.restore({
      workspace: args.workspace,
      name: args.name,
      clean: args.clean,
    });

    console.log(`Restored checkpoint "${args.name}" for workspace "${args.workspace}".`);
  },
});

const checkpointCommand = defineCommand({
  meta: { name: "checkpoint", description: "Manage workspace checkpoints" },
  subCommands: {
    create: checkpointCreateCommand,
    list: checkpointListCommand,
    restore: checkpointRestoreCommand,
  },
});

const main = defineCommand({
  meta: { name: "treefork", description: "AI agent workspace isolation using git worktrees" },
  subCommands: {
    create: createCommand,
    list: listCommand,
    resolve: resolveCommand,
    remove: removeCommand,
    checkpoint: checkpointCommand,
  },
});

runMain(main);
