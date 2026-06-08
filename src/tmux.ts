import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { TreeforkError } from "./errors";
import type { WorkspaceInfo } from "./types";

const execFileAsync = promisify(execFile);

type ExecFileFailure = Error & {
  stderr?: string | Buffer;
};

export type OpenWorkspaceInTmuxOptions = {
  workspace: WorkspaceInfo;
  window?: boolean;
  session?: string;
};

async function tmux(args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("tmux", [...args], {
      encoding: "utf8",
    });

    return stdout.trim();
  } catch (error) {
    const failure = error as ExecFileFailure;
    const stderr = failure.stderr === undefined ? "" : failure.stderr.toString().trim();
    const suffix = stderr === "" ? "" : `: ${stderr}`;

    throw new TreeforkError(`tmux command failed (${args.join(" ")})${suffix}`, {
      cause: error,
    });
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isShellCommand(command: string): boolean {
  return ["bash", "fish", "nu", "pwsh", "sh", "zsh"].includes(command);
}

async function tmuxSessionExists(session: string): Promise<boolean> {
  try {
    await tmux(["has-session", "-t", session]);
    return true;
  } catch {
    return false;
  }
}

async function findWindowTarget(windowName: string, session?: string): Promise<string | null> {
  const args = ["list-windows", "-F", "#{window_name}\t#{window_id}"];

  if (session !== undefined) {
    args.splice(1, 0, "-t", session);
  }

  const output = await tmux(args);

  for (const line of output.split("\n")) {
    const [name, id] = line.split("\t");

    if (name === windowName && id !== undefined && id !== "") {
      return id;
    }
  }

  return null;
}

async function cdTargetToWorkspace(target: string, workspacePath: string): Promise<void> {
  const currentCommand = await tmux([
    "display-message",
    "-p",
    "-t",
    target,
    "#{pane_current_command}",
  ]);

  if (!isShellCommand(currentCommand)) {
    return;
  }

  await tmux(["send-keys", "-t", target, `cd ${shellQuote(workspacePath)}`, "Enter"]);
}

async function openWorkspaceWindow(workspace: WorkspaceInfo): Promise<void> {
  const target = await findWindowTarget(workspace.name);

  if (target !== null) {
    await cdTargetToWorkspace(target, workspace.path);
    await tmux(["select-window", "-t", target]);
    return;
  }

  await tmux(["new-window", "-n", workspace.name, "-c", workspace.path]);
}

async function openWorkspaceSession(workspace: WorkspaceInfo, session: string): Promise<void> {
  if (!(await tmuxSessionExists(session))) {
    await tmux(["new-session", "-d", "-s", session, "-n", workspace.name, "-c", workspace.path]);
    return;
  }

  const target = await findWindowTarget(workspace.name, session);

  if (target !== null) {
    await cdTargetToWorkspace(target, workspace.path);
    await tmux(["select-window", "-t", target]);
    return;
  }

  const newTarget = await tmux([
    "new-window",
    "-d",
    "-P",
    "-F",
    "#{window_id}",
    "-t",
    session,
    "-n",
    workspace.name,
    "-c",
    workspace.path,
  ]);
  await tmux(["select-window", "-t", newTarget]);
}

export async function openWorkspaceInTmux(options: OpenWorkspaceInTmuxOptions): Promise<void> {
  if (options.session !== undefined) {
    await openWorkspaceSession(options.workspace, options.session);
    return;
  }

  if (options.window === true) {
    await openWorkspaceWindow(options.workspace);
  }
}
