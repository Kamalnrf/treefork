#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import pc from "picocolors";

import { loadConfig } from "./config";
import { WorkspaceNotFoundError, createTreefork } from "./index";
import type { TreeforkConfig } from "./types";

const HUMAN_OUTPUT = process.stdout.isTTY === true;

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

type Detail = {
  label: string;
  value: string;
  tone?: "default" | "accent" | "muted";
};

type StackedRecord = {
  title: string;
  details: readonly Detail[];
  tone?: "default" | "accent" | "success";
};

function colorTitle(value: string, tone: StackedRecord["tone"] = "default"): string {
  if (!HUMAN_OUTPUT) {
    return value;
  }

  if (tone === "success") {
    return pc.bold(pc.green(value));
  }

  if (tone === "accent") {
    return pc.bold(pc.cyan(value));
  }

  return pc.bold(value);
}

function colorLabel(value: string): string {
  return HUMAN_OUTPUT ? pc.dim(value) : value;
}

function colorValue(value: string, tone: Detail["tone"] = "default"): string {
  if (!HUMAN_OUTPUT) {
    return value;
  }

  if (tone === "accent") {
    return pc.cyan(value);
  }

  if (tone === "muted") {
    return pc.dim(value);
  }

  return value;
}

function formatStackedRecords(records: readonly StackedRecord[]): string {
  if (records.length === 0) {
    return "";
  }

  const labelWidth = records.reduce(
    (width, record) =>
      record.details.reduce((detailWidth, detail) => Math.max(detailWidth, detail.label.length), width),
    0,
  );

  return records
    .map((record) => {
      const lines = [colorTitle(record.title, record.tone)];

      for (const detail of record.details) {
        const label = colorLabel(detail.label.padEnd(labelWidth));
        const value = colorValue(detail.value, detail.tone);

        lines.push(`  ${label}  ${value}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function printOutput(output: string): void {
  if (output !== "") {
    console.log(output);
  }
}

function printEmptyState(message: string): void {
  if (HUMAN_OUTPUT) {
    console.log(pc.dim(message));
  }
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

    if (!HUMAN_OUTPUT) {
      console.log(workspace.path);
      return;
    }

    printOutput(
      formatStackedRecords([
        {
          title: `Created workspace ${workspace.name}`,
          tone: "success",
          details: [
            { label: "branch", value: workspace.branch, tone: "accent" },
            { label: "path", value: workspace.path },
            { label: "head", value: workspace.head, tone: "accent" },
            { label: "next", value: `cd ${workspace.path}`, tone: "muted" },
          ],
        },
      ]),
    );
  },
});

const listCommand = defineCommand({
  meta: { name: "list", description: "List all workspaces" },
  async run() {
    const treefork = await createCliTreefork();
    const workspaces = await treefork.workspaces.list();
    const output = formatStackedRecords(
      workspaces.map((workspace) => ({
        title: workspace.name,
        tone: "accent",
        details: [
          { label: "branch", value: workspace.branch, tone: "accent" },
          { label: "path", value: workspace.path },
          { label: "head", value: workspace.head, tone: "muted" },
        ],
      })),
    );

    if (output === "") {
      printEmptyState("No workspaces found.");
      return;
    }

    printOutput(output);
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

    if (!HUMAN_OUTPUT) {
      console.log(workspace.path);
      return;
    }

    printOutput(
      formatStackedRecords([
        {
          title: `Resolved workspace ${workspace.name}`,
          tone: "accent",
          details: [
            { label: "branch", value: workspace.branch, tone: "accent" },
            { label: "path", value: workspace.path },
            { label: "head", value: workspace.head, tone: "muted" },
          ],
        },
      ]),
    );
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

    printOutput(
      formatStackedRecords([
        {
          title: `Removed workspace ${args.name}`,
          tone: "success",
          details: args.force ? [{ label: "force", value: "true", tone: "muted" }] : [],
        },
      ]),
    );
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

    if (!HUMAN_OUTPUT) {
      console.log(checkpoint.ref);
      return;
    }

    printOutput(
      formatStackedRecords([
        {
          title: `Created checkpoint ${checkpoint.name}`,
          tone: "success",
          details: [
            { label: "workspace", value: checkpoint.workspace, tone: "accent" },
            { label: "ref", value: checkpoint.ref },
            { label: "commit", value: checkpoint.commit, tone: "muted" },
          ],
        },
      ]),
    );
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
    const output = formatStackedRecords(
      checkpoints.map((checkpoint) => ({
        title: checkpoint.name,
        tone: "accent",
        details: [
          { label: "workspace", value: checkpoint.workspace, tone: "accent" },
          { label: "commit", value: checkpoint.commit, tone: "muted" },
        ],
      })),
    );

    if (output === "") {
      printEmptyState(`No checkpoints found for workspace "${args.workspace}".`);
      return;
    }

    printOutput(output);
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

    printOutput(
      formatStackedRecords([
        {
          title: `Restored checkpoint ${args.name}`,
          tone: "success",
          details: [
            { label: "workspace", value: args.workspace, tone: "accent" },
            { label: "clean", value: String(args.clean === true), tone: "muted" },
          ],
        },
      ]),
    );
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
