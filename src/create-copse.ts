import { CopseError, CopseGitError } from "./errors";
import { git } from "./git";
import { defaultStorageDir } from "./naming";
import type { CheckpointMethods, Copse, CopseConfig, ResolvedConfig, WorkspaceMethods } from "./types";
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from "./checkpoints";
import { createWorkspace, listWorkspaces, removeWorkspace, resolveWorkspace } from "./workspaces";

const DEFAULT_BASE_REF = "HEAD";
const DEFAULT_BRANCH_PREFIX = "copse/";
const DEFAULT_CHECKPOINT_REF_PREFIX = "refs/copse/checkpoints";

async function resolveRepoRoot(cwd: string): Promise<string> {
  try {
    return await git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    if (error instanceof CopseGitError) {
      throw new CopseError(`Directory "${cwd}" is not inside a git repository.`, {
        cause: error,
      });
    }

    throw error;
  }
}

function resolveConfig(options: CopseConfig | undefined, repoRoot: string): ResolvedConfig {
  const cwd = options?.cwd ?? process.cwd();

  return {
    cwd,
    repoRoot,
    storageDir: options?.storageDir ?? defaultStorageDir(repoRoot),
    defaultBaseRef: options?.defaultBaseRef ?? DEFAULT_BASE_REF,
    branchPrefix: options?.branchPrefix ?? DEFAULT_BRANCH_PREFIX,
    checkpointRefPrefix:
      options?.checkpointRefPrefix ?? DEFAULT_CHECKPOINT_REF_PREFIX,
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

export async function createCopse(options: CopseConfig = {}): Promise<Copse> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await resolveRepoRoot(cwd);
  const config = resolveConfig(options, repoRoot);

  return {
    config,
    workspaces: createWorkspaceMethods(config),
    checkpoints: createCheckpointMethods(config),
  };
}
