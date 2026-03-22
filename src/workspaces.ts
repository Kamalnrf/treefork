import { access, mkdir, realpath } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { WorkspaceExistsError } from "./errors";
import { git } from "./git";
import { nameFromBranch, sanitizeName, toBranchName, toWorkspacePath } from "./naming";
import type {
  CreateWorkspaceOptions,
  ResolveWorkspaceOptions,
  ResolvedConfig,
  WorkspaceInfo,
} from "./types";

const HEAD_REF = "HEAD";
const LOCAL_BRANCH_PREFIX = "refs/heads/";

type ParsedWorktree = {
  path: string;
  head: string | null;
  branch: string | null;
};

function absoluteStorageDir(config: ResolvedConfig): string {
  return resolvePath(config.repoRoot, config.storageDir);
}

function absoluteWorkspacePath(config: ResolvedConfig, name: string): string {
  return resolvePath(config.repoRoot, toWorkspacePath(config.storageDir, name));
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

function toWorkspaceInfo(
  entry: ParsedWorktree,
  branchPrefix: string,
): WorkspaceInfo | null {
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
  await git(config.repoRoot, ["worktree", "add", "-b", branch, path, baseRef]);

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
  const output = await git(config.repoRoot, ["worktree", "list", "--porcelain"]);

  for (const entry of parseWorktreeList(output)) {
    if (entry.branch !== targetBranch) {
      continue;
    }

    return toWorkspaceInfo(entry, config.branchPrefix);
  }

  return null;
}
