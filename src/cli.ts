#!/usr/bin/env node

import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";

import { defineCommand, runMain } from "citty";
import pc from "picocolors";

import { loadConfig } from "./config";
import {
  TreeforkGitError,
  WorkspaceExistsError,
  WorkspaceNotFoundError,
  createTreefork,
} from "./index";
import {
  claimSetupHint,
  installShellIntegration,
  shellInit,
  shellName,
  shellProfile,
} from "./shell";
import { openWorkspaceInTmux } from "./tmux";
import type { TreeforkConfig } from "./types";

const HUMAN_OUTPUT = process.stdout.isTTY === true;

function displayPath(path: string): string {
  const home = homedir();
  return path === home ? "~" : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cdCommand(path: string): string {
  const displayed = displayPath(path);
  if (/^[A-Za-z0-9_./~-]+$/.test(displayed)) return `cd ${displayed}`;
  return displayed.startsWith("~/")
    ? `cd ~/${shellQuote(displayed.slice(2))}`
    : `cd ${shellQuote(path)}`;
}

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
      record.details.reduce(
        (detailWidth, detail) => Math.max(detailWidth, detail.label.length),
        width,
      ),
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

async function createOrReuseWorkspace(
  treefork: Awaited<ReturnType<typeof createCliTreefork>>,
  options: { name: string; baseRef?: string },
) {
  try {
    return {
      workspace: await treefork.workspaces.create(options),
      created: true,
    };
  } catch (error) {
    if (!(error instanceof WorkspaceExistsError) && !(error instanceof TreeforkGitError)) {
      throw error;
    }

    const workspace = await treefork.workspaces.resolve({ name: options.name });

    if (workspace === null) {
      throw error;
    }

    return {
      workspace,
      created: false,
    };
  }
}

const createCommand = defineCommand({
  meta: { name: "create", description: "Create a new workspace" },
  args: {
    name: { type: "positional", description: "Workspace name", required: true },
    base: { type: "string", description: "Base ref to create workspace from" },
    repo: { type: "string", description: "Remote git URL to clone from" },
    "tmux-window": {
      type: "boolean",
      description: "Open or reuse a tmux window for the workspace",
    },
    "tmux-session": {
      type: "string",
      description: "Open or reuse a tmux session for the workspace",
    },
  },
  async run({ args }) {
    const treefork = await createCliTreefork({ repo: args.repo });
    const { workspace, created } = await createOrReuseWorkspace(treefork, {
      name: args.name,
      baseRef: args.base,
    });
    const tmuxWindow = args.tmuxWindow === true;
    const tmuxSession =
      args.tmuxSession === true
        ? args.name
        : typeof args.tmuxSession === "string"
          ? args.tmuxSession
          : undefined;
    const tmuxEnabled = tmuxWindow || tmuxSession !== undefined;

    await openWorkspaceInTmux({
      workspace,
      window: tmuxWindow,
      session: tmuxSession,
    });

    const entering = process.env.TREEFORK_ENTER === "1";
    const summary = `${created ? "Created" : "Reused"} workspace ${pc.bold(workspace.name)}`;
    if (!HUMAN_OUTPUT || entering) {
      if (entering && process.stderr.isTTY) {
        console.error(`${pc.green("✓")} ${summary}\n  ${pc.gray("branch")}  ${workspace.branch}`);
      }
      console.log(workspace.path);
      return;
    }

    console.log(`${pc.green("✓")} ${summary}\n  ${pc.gray("branch")}  ${workspace.branch}`);
    if (tmuxEnabled) {
      console.log(`  ${pc.gray("path")}    ${displayPath(workspace.path)}`);
      console.log(
        `  ${pc.gray("tmux")}    ${tmuxSession ? `session ${tmuxSession} · ` : ""}window ${workspace.name}`,
      );
      if (tmuxSession) {
        const action = process.env.TMUX ? "switch-client" : "attach";
        console.log(`\n  ${pc.cyan(`tmux ${action} -t ${shellQuote(tmuxSession)}`)}`);
      }
    } else {
      console.log(`\n  ${pc.cyan(cdCommand(workspace.path))}`);
      if (await claimSetupHint()) {
        console.log(
          `\n${pc.gray("Tip: run treefork setup to create and enter workspaces with tf <name>.")}`,
        );
      }
    }
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
          { label: "path", value: HUMAN_OUTPUT ? displayPath(workspace.path) : workspace.path },
          ...(!HUMAN_OUTPUT ? [{ label: "head", value: workspace.head }] : []),
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

    console.log(displayPath(workspace.path));
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

const initCommand = defineCommand({
  meta: { name: "init", description: "Print bash/zsh integration for create-and-enter with tf" },
  args: {
    shell: { type: "positional", description: "bash or zsh", required: true },
  },
  run({ args }) {
    shellName(args.shell);
    console.log(shellInit());
  },
});

const setupCommand = defineCommand({
  meta: {
    name: "setup",
    description: "Install the tf shell function (creates and enters a workspace)",
  },
  args: {
    shell: { type: "string", description: "Shell to configure: bash or zsh (defaults to $SHELL)" },
    yes: { type: "boolean", description: "Approve adding integration to your shell profile" },
  },
  async run({ args }) {
    const shell = shellName(args.shell ?? process.env.SHELL);
    const profile = shellProfile(shell);
    if (!args.yes) {
      if (!process.stdin.isTTY || !process.stderr.isTTY) {
        throw new Error(
          "Setup needs an interactive terminal. Use --yes to approve the profile edit.",
        );
      }
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = await prompt.question(
          `Add tf (create and enter a workspace) to ${displayPath(profile)}? [y/N] `,
        );
        if (!/^y(es)?$/i.test(answer.trim())) {
          console.log("Setup cancelled. No files changed.");
          return;
        }
      } finally {
        prompt.close();
      }
    }
    const installed = await installShellIntegration(shell, profile);
    console.log(
      `${installed ? "Added" : "Already configured"} shell integration in ${displayPath(profile)}.`,
    );
    console.log(
      `\nTo enable tf in this terminal, run:\n\n  eval "$(treefork init ${shell})"\n\nThen use: tf <name>`,
    );
  },
});

const main = defineCommand({
  meta: { name: "treefork", description: "AI agent workspace isolation using git worktrees" },
  subCommands: {
    setup: setupCommand,
    init: initCommand,
    create: createCommand,
    list: listCommand,
    resolve: resolveCommand,
    remove: removeCommand,
    checkpoint: checkpointCommand,
  },
});

void runMain(main);
