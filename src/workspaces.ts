import { access, mkdir, realpath } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { BractError, BractGitError, WorkspaceExistsError, WorkspaceNotFoundError } from "./errors";
import { git, gitDir as gitWithDir } from "./git";
import { nameFromBranch, sanitizeName, toBranchName, toWorkspacePath } from "./naming";
import type {
  CreateWorkspaceOptions,
  ResolveWorkspaceOptions,
  RemoveWorkspaceOptions,
  ResolvedConfig,
  WorkspaceInfo,
} from "./types";

const HEAD_REF = "HEAD";
const LOCAL_BRANCH_PREFIX = "refs/heads/";
const DIRTY_WORKTREE_PATTERN = /contains modified or untracked files/i;
const MISSING_BRANCH_PATTERN = /branch ['"].+['"] not found/i;

type ParsedWorktree = {
  path: string;
  head: string | null;
  branch: string | null;
};

function repoGit(config: ResolvedConfig, args: readonly string[]): Promise<string> {
  if (config.mode === "remote") {
    return gitWithDir(config.gitDir, config.cwd, args);
  }

  return git(config.repoRoot, args);
}

function absoluteStorageDir(config: ResolvedConfig): string {
  return resolvePath(config.repoRoot, config.storageDir);
}

function absoluteWorkspacePath(config: ResolvedConfig, name: string): string {
  return resolvePath(config.repoRoot, toWorkspacePath(config.storageDir, name));
}

function checkpointRefNamespace(config: ResolvedConfig, workspaceName: string): string {
  const prefix = config.checkpointRefPrefix.replace(/\/+$/, "");

  return `${prefix}/${sanitizeName(workspaceName)}/`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseWorktreeList(output: string): ParsedWorktree[] {
  return output
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const entry: ParsedWorktree = {
        path: "",
        head: null,
        branch: null,
      };

      for (const line of block.split("\n")) {
        const separatorIndex = line.indexOf(" ");

        if (separatorIndex === -1) {
          continue;
        }

        const key = line.slice(0, separatorIndex);
        const value = line.slice(separatorIndex + 1);

        if (key === "worktree") {
          entry.path = value;
          continue;
        }

        if (key === "HEAD") {
          entry.head = value;
          continue;
        }

        if (key === "branch") {
          entry.branch = value.startsWith(LOCAL_BRANCH_PREFIX)
            ? value.slice(LOCAL_BRANCH_PREFIX.length)
            : value;
        }
      }

      return entry;
    })
    .filter((entry) => entry.path !== "");
}

function toWorkspaceInfo(entry: ParsedWorktree, branchPrefix: string): WorkspaceInfo | null {
  if (entry.branch === null || entry.head === null) {
    return null;
  }

  const name = nameFromBranch(entry.branch, branchPrefix);

  if (name === null) {
    return null;
  }

  return {
    name,
    path: entry.path,
    branch: entry.branch,
    head: entry.head,
  };
}

function isDirtyWorktreeError(error: unknown): error is BractGitError {
  return error instanceof BractGitError && DIRTY_WORKTREE_PATTERN.test(error.stderr);
}

function isMissingBranchError(error: unknown): error is BractGitError {
  return error instanceof BractGitError && MISSING_BRANCH_PATTERN.test(error.stderr);
}

async function deleteCheckpointRefs(config: ResolvedConfig, workspaceName: string): Promise<void> {
  const refNamespace = checkpointRefNamespace(config, workspaceName);
  const output = await repoGit(config, ["for-each-ref", refNamespace, "--format=%(refname)"]);

  for (const ref of output.split("\n")) {
    if (ref === "") {
      continue;
    }

    await repoGit(config, ["update-ref", "-d", ref]);
  }
}

async function deleteWorkspaceBranch(
  config: ResolvedConfig,
  branch: string,
  force: boolean,
): Promise<void> {
  try {
    await repoGit(config, ["branch", "-D", branch]);
  } catch (error) {
    if (force && isMissingBranchError(error)) {
      return;
    }

    throw error;
  }
}

export async function createWorkspace(
  config: ResolvedConfig,
  options: CreateWorkspaceOptions,
): Promise<WorkspaceInfo> {
  const name = sanitizeName(options.name);
  const branch = toBranchName(name, config.branchPrefix);
  const path = absoluteWorkspacePath(config, name);
  const baseRef = options.baseRef ?? HEAD_REF;

  if (await pathExists(path)) {
    throw new WorkspaceExistsError(`Workspace "${name}" already exists at ${path}.`);
  }

  await mkdir(absoluteStorageDir(config), { recursive: true });
  await repoGit(config, ["worktree", "add", "-b", branch, path, baseRef]);

  const head = await git(path, ["rev-parse", HEAD_REF]);
  const canonicalPath = await realpath(path);

  return {
    name,
    path: canonicalPath,
    branch,
    head,
  };
}

export async function resolveWorkspace(
  config: ResolvedConfig,
  options: ResolveWorkspaceOptions,
): Promise<WorkspaceInfo | null> {
  const targetBranch = toBranchName(options.name, config.branchPrefix);
  const output = await repoGit(config, ["worktree", "list", "--porcelain"]);

  for (const entry of parseWorktreeList(output)) {
    if (entry.branch !== targetBranch) {
      continue;
    }

    return toWorkspaceInfo(entry, config.branchPrefix);
  }

  return null;
}

export async function listWorkspaces(config: ResolvedConfig): Promise<WorkspaceInfo[]> {
  const output = await repoGit(config, ["worktree", "list", "--porcelain"]);
  const workspaces: WorkspaceInfo[] = [];

  for (const entry of parseWorktreeList(output)) {
    const workspace = toWorkspaceInfo(entry, config.branchPrefix);

    if (workspace !== null) {
      workspaces.push(workspace);
    }
  }

  return workspaces;
}

export async function removeWorkspace(
  config: ResolvedConfig,
  options: RemoveWorkspaceOptions,
): Promise<void> {
  const name = sanitizeName(options.name);
  const force = options.force === true;
  const branch = toBranchName(name, config.branchPrefix);
  const workspace = await resolveWorkspace(config, { name });

  if (workspace === null) {
    if (!force) {
      throw new WorkspaceNotFoundError(`Workspace "${name}" was not found.`);
    }

    await deleteCheckpointRefs(config, name);
    await deleteWorkspaceBranch(config, branch, true);
    return;
  }

  const args = ["worktree", "remove"];

  if (force) {
    args.push("--force");
  }

  args.push(workspace.path);

  try {
    await repoGit(config, args);
  } catch (error) {
    if (!force && isDirtyWorktreeError(error)) {
      throw new BractError(
        `Workspace "${name}" has uncommitted changes. Re-run with force: true to remove it.`,
        { cause: error },
      );
    }

    throw error;
  }

  await deleteCheckpointRefs(config, name);
  await deleteWorkspaceBranch(config, branch, force);
}
