export type CopseConfig = {
  cwd?: string;
  repo?: string;
  storageDir?: string;
  defaultBaseRef?: string;
  branchPrefix?: string;
  checkpointRefPrefix?: string;
};

export type ResolvedConfig = Required<Omit<CopseConfig, "repo">> & {
  mode: "local" | "remote";
  repoRoot: string;
  gitDir: string;
};

export type WorkspaceInfo = {
  name: string;
  path: string;
  branch: string;
  head: string;
};

export type CheckpointInfo = {
  workspace: string;
  name: string;
  ref: string;
  commit: string;
};

export type CreateWorkspaceOptions = {
  name: string;
  baseRef?: string;
};

export type ResolveWorkspaceOptions = {
  name: string;
};

export type RemoveWorkspaceOptions = {
  name: string;
  force?: boolean;
};

export type CreateCheckpointOptions = {
  workspace: string;
  name: string;
};

export type ListCheckpointsOptions = {
  workspace: string;
};

export type RestoreCheckpointOptions = {
  workspace: string;
  name: string;
  clean?: boolean;
};

export type WorkspaceMethods = {
  create: (options: CreateWorkspaceOptions) => Promise<WorkspaceInfo>;
  list: () => Promise<WorkspaceInfo[]>;
  resolve: (options: ResolveWorkspaceOptions) => Promise<WorkspaceInfo | null>;
  remove: (options: RemoveWorkspaceOptions) => Promise<void>;
};

export type CheckpointMethods = {
  create: (options: CreateCheckpointOptions) => Promise<CheckpointInfo>;
  list: (options: ListCheckpointsOptions) => Promise<CheckpointInfo[]>;
  restore: (options: RestoreCheckpointOptions) => Promise<void>;
};

export type Copse = {
  config: ResolvedConfig;
  workspaces: WorkspaceMethods;
  checkpoints: CheckpointMethods;
};
