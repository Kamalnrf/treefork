import { mkdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from "./checkpoints";
import { TreeforkError, TreeforkGitError } from "./errors";
import { git } from "./git";
import { ensureMirror, mirrorPath } from "./mirror";
import { defaultStorageDir } from "./naming";
import type {
  Treefork,
  TreeforkConfig,
  CheckpointMethods,
  ResolvedConfig,
  WorkspaceMethods,
} from "./types";
import { createWorkspace, listWorkspaces, removeWorkspace, resolveWorkspace } from "./workspaces";

const DEFAULT_BASE_REF = "HEAD";
const DEFAULT_BRANCH_PREFIX = "treefork/";
const DEFAULT_CHECKPOINT_REF_PREFIX = "refs/treefork/checkpoints";

async function resolveRepoRoot(cwd: string): Promise<string> {
  try {
    return await git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    if (error instanceof TreeforkGitError) {
      throw new TreeforkError(`Directory "${cwd}" is not inside a git repository.`, {
        cause: error,
      });
    }

    throw error;
  }
}

function resolveLocalConfig(options: TreeforkConfig | undefined, repoRoot: string): ResolvedConfig {
  const cwd = options?.cwd ?? process.cwd();

  return {
    mode: "local",
    cwd,
    repoRoot,
    gitDir: repoRoot,
    storageDir: options?.storageDir ?? defaultStorageDir(repoRoot),
    defaultBaseRef: options?.defaultBaseRef ?? DEFAULT_BASE_REF,
    branchPrefix: options?.branchPrefix ?? DEFAULT_BRANCH_PREFIX,
    checkpointRefPrefix: options?.checkpointRefPrefix ?? DEFAULT_CHECKPOINT_REF_PREFIX,
  };
}

async function resolveRemoteConfig(options: TreeforkConfig): Promise<ResolvedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const storageDir = resolvePath(cwd, options.storageDir ?? ".treefork");
  const mirror = mirrorPath(storageDir, options.repo!);

  await mkdir(storageDir, { recursive: true });
  await ensureMirror(options.repo!, mirror, cwd);

  return {
    mode: "remote",
    cwd,
    repoRoot: storageDir,
    gitDir: mirror,
    storageDir,
    defaultBaseRef: options.defaultBaseRef ?? DEFAULT_BASE_REF,
    branchPrefix: options.branchPrefix ?? DEFAULT_BRANCH_PREFIX,
    checkpointRefPrefix: options.checkpointRefPrefix ?? DEFAULT_CHECKPOINT_REF_PREFIX,
  };
}

function createWorkspaceMethods(config: ResolvedConfig): WorkspaceMethods {
  return {
    create: async (options) =>
      createWorkspace(config, {
        ...options,
        baseRef: options.baseRef ?? config.defaultBaseRef,
      }),
    list: async () => listWorkspaces(config),
    resolve: async (options) => resolveWorkspace(config, options),
    remove: async (options) => removeWorkspace(config, options),
  };
}

function createCheckpointMethods(config: ResolvedConfig): CheckpointMethods {
  return {
    create: async (options) => createCheckpoint(config, options),
    list: async (options) => listCheckpoints(config, options),
    restore: async (options) => restoreCheckpoint(config, options),
  };
}

export async function createTreefork(options: TreeforkConfig = {}): Promise<Treefork> {
  const config = options.repo
    ? await resolveRemoteConfig(options)
    : resolveLocalConfig(options, await resolveRepoRoot(options.cwd ?? process.cwd()));

  return {
    config,
    workspaces: createWorkspaceMethods(config),
    checkpoints: createCheckpointMethods(config),
  };
}
