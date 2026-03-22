import {
  CheckpointExistsError,
  CopseGitError,
  WorkspaceNotFoundError,
} from "./errors";
import { git } from "./git";
import { sanitizeName } from "./naming";
import type {
  CheckpointInfo,
  CreateCheckpointOptions,
  ListCheckpointsOptions,
  ResolvedConfig,
} from "./types";
import { resolveWorkspace } from "./workspaces";

const HEAD_REF = "HEAD";

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

function checkpointRefNamespace(
  config: ResolvedConfig,
  workspaceName: string,
): string {
  return `${checkpointRefPrefix(config)}/${sanitizeName(workspaceName)}/`;
}

async function getWorkspaceName(
  config: ResolvedConfig,
  workspaceName: string,
): Promise<string> {
  const workspace = await resolveWorkspace(config, { name: workspaceName });

  if (workspace === null) {
    throw new WorkspaceNotFoundError(`Workspace "${sanitizeName(workspaceName)}" was not found.`);
  }

  return workspace.name;
}

async function getWorkspaceInfo(
  config: ResolvedConfig,
  workspaceName: string,
) {
  const workspace = await resolveWorkspace(config, { name: workspaceName });

  if (workspace === null) {
    throw new WorkspaceNotFoundError(`Workspace "${sanitizeName(workspaceName)}" was not found.`);
  }

  return workspace;
}

async function checkpointExists(
  config: ResolvedConfig,
  ref: string,
): Promise<boolean> {
  try {
    await git(config.repoRoot, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch (error) {
    if (
      error instanceof CopseGitError &&
      (error.exitCode === 1 || error.exitCode === 128)
    ) {
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
  await git(config.repoRoot, ["update-ref", ref, commit]);

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
  const output = await git(config.repoRoot, [
    "for-each-ref",
    namespace,
    "--format=%(refname) %(objectname)",
  ]);

  return parseCheckpointList(output, workspaceName, namespace);
}
