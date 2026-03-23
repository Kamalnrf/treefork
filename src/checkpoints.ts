import {
  CheckpointExistsError,
  CheckpointNotFoundError,
  BractGitError,
  WorkspaceNotFoundError,
} from "./errors";
import { git, gitDir as gitWithDir } from "./git";
import { sanitizeName } from "./naming";
import type {
  CheckpointInfo,
  CreateCheckpointOptions,
  ListCheckpointsOptions,
  ResolvedConfig,
  RestoreCheckpointOptions,
} from "./types";
import { resolveWorkspace } from "./workspaces";

const HEAD_REF = "HEAD";
const CLEAN_WORKTREE_ARGS = ["clean", "-fd"] as const;
const RESET_HARD_ARGS = ["reset", "--hard"] as const;

function repoGit(config: ResolvedConfig, args: readonly string[]): Promise<string> {
  if (config.mode === "remote") {
    return gitWithDir(config.gitDir, config.cwd, args);
  }

  return git(config.repoRoot, args);
}

function checkpointRefPrefix(config: ResolvedConfig): string {
  return config.checkpointRefPrefix.replace(/\/+$/, "");
}

function checkpointRef(
  config: ResolvedConfig,
  workspaceName: string,
  checkpointName: string,
): string {
  return `${checkpointRefPrefix(config)}/${sanitizeName(workspaceName)}/${sanitizeName(checkpointName)}`;
}

function checkpointRefNamespace(config: ResolvedConfig, workspaceName: string): string {
  return `${checkpointRefPrefix(config)}/${sanitizeName(workspaceName)}/`;
}

async function getWorkspaceName(config: ResolvedConfig, workspaceName: string): Promise<string> {
  const workspace = await resolveWorkspace(config, { name: workspaceName });

  if (workspace === null) {
    throw new WorkspaceNotFoundError(`Workspace "${sanitizeName(workspaceName)}" was not found.`);
  }

  return workspace.name;
}

async function getWorkspaceInfo(config: ResolvedConfig, workspaceName: string) {
  const workspace = await resolveWorkspace(config, { name: workspaceName });

  if (workspace === null) {
    throw new WorkspaceNotFoundError(`Workspace "${sanitizeName(workspaceName)}" was not found.`);
  }

  return workspace;
}

async function checkpointExists(config: ResolvedConfig, ref: string): Promise<boolean> {
  try {
    await repoGit(config, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch (error) {
    if (error instanceof BractGitError && (error.exitCode === 1 || error.exitCode === 128)) {
      return false;
    }

    throw error;
  }
}

function parseCheckpointList(
  output: string,
  workspaceName: string,
  namespace: string,
): CheckpointInfo[] {
  const checkpoints: CheckpointInfo[] = [];

  for (const line of output.split("\n")) {
    if (line === "") {
      continue;
    }

    const separatorIndex = line.indexOf(" ");

    if (separatorIndex === -1) {
      continue;
    }

    const ref = line.slice(0, separatorIndex);
    const commit = line.slice(separatorIndex + 1);

    if (!ref.startsWith(namespace)) {
      continue;
    }

    const name = ref.slice(namespace.length);

    if (name === "") {
      continue;
    }

    checkpoints.push({
      workspace: workspaceName,
      name,
      ref,
      commit,
    });
  }

  return checkpoints;
}

export async function createCheckpoint(
  config: ResolvedConfig,
  options: CreateCheckpointOptions,
): Promise<CheckpointInfo> {
  const workspace = await getWorkspaceInfo(config, options.workspace);
  const name = sanitizeName(options.name);
  const ref = checkpointRef(config, workspace.name, name);

  if (await checkpointExists(config, ref)) {
    throw new CheckpointExistsError(
      `Checkpoint "${name}" already exists for workspace "${workspace.name}".`,
    );
  }

  const commit = await git(workspace.path, ["rev-parse", HEAD_REF]);
  await repoGit(config, ["update-ref", ref, commit]);

  return {
    workspace: workspace.name,
    name,
    ref,
    commit,
  };
}

export async function listCheckpoints(
  config: ResolvedConfig,
  options: ListCheckpointsOptions,
): Promise<CheckpointInfo[]> {
  const workspaceName = await getWorkspaceName(config, options.workspace);
  const namespace = checkpointRefNamespace(config, workspaceName);
  const output = await repoGit(config, [
    "for-each-ref",
    namespace,
    "--format=%(refname) %(objectname)",
  ]);

  return parseCheckpointList(output, workspaceName, namespace);
}

export async function restoreCheckpoint(
  config: ResolvedConfig,
  options: RestoreCheckpointOptions,
): Promise<void> {
  const workspace = await getWorkspaceInfo(config, options.workspace);
  const checkpointName = sanitizeName(options.name);
  const ref = checkpointRef(config, workspace.name, checkpointName);

  if (!(await checkpointExists(config, ref))) {
    throw new CheckpointNotFoundError(
      `Checkpoint "${checkpointName}" was not found for workspace "${workspace.name}".`,
    );
  }

  await git(workspace.path, [...RESET_HARD_ARGS, ref]);

  if (options.clean === true) {
    await git(workspace.path, CLEAN_WORKTREE_ARGS);
  }
}
