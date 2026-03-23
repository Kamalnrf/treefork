# treefork

Workspace isolation for AI agents using git worktrees. Give each agent its own branch and directory — no conflicts, no coordination overhead.

Treefork is a small TypeScript library and CLI. It wraps `git worktree` with a clean API for creating, listing, snapshotting, and removing isolated workspaces. Works with local repos and remote git URLs.

## Install

```bash
bun add treefork
```

## CLI

```bash
# Create a workspace (prints its path)
treefork create my-feature

# Create from a specific ref
treefork create my-feature --base main

# Create from a remote git URL
treefork create my-feature --repo git@github.com:acme/service.git

# List all workspaces
treefork list

# Get the path of a workspace
treefork resolve my-feature

# Remove a workspace
treefork remove my-feature
treefork remove my-feature --force
```

### Checkpoints

Snapshot and restore workspace state:

```bash
# Save a checkpoint
treefork checkpoint create my-feature before-refactor

# List checkpoints
treefork checkpoint list my-feature

# Restore a checkpoint
treefork checkpoint restore my-feature before-refactor

# Restore and clean untracked files
treefork checkpoint restore my-feature before-refactor --clean
```

## Library

```typescript
import { createTreefork } from "treefork";

// From a local repo
const treefork = await createTreefork();

// From a remote git URL
const remote = await createTreefork({
  repo: "git@github.com:acme/service.git",
});
```

### Workspaces

```typescript
// Create a workspace — returns { name, path, branch, head }
const ws = await treefork.workspaces.create({ name: "agent-1" });
console.log(ws.path); // /Users/you/code/../.myrepo-treefork/agent-1

// List all workspaces
const all = await treefork.workspaces.list();

// Resolve a single workspace (returns null if not found)
const found = await treefork.workspaces.resolve({ name: "agent-1" });

// Remove a workspace
await treefork.workspaces.remove({ name: "agent-1" });
await treefork.workspaces.remove({ name: "agent-1", force: true });
```

### Checkpoints

```typescript
// Snapshot the current state
const cp = await treefork.checkpoints.create({
  workspace: "agent-1",
  name: "before-refactor",
});

// List checkpoints for a workspace
const checkpoints = await treefork.checkpoints.list({ workspace: "agent-1" });

// Restore a checkpoint
await treefork.checkpoints.restore({
  workspace: "agent-1",
  name: "before-refactor",
  clean: true, // optional: remove untracked files
});
```

### Configuration

Pass options to `createTreefork` to override defaults:

```typescript
const treefork = await createTreefork({
  cwd: "/path/to/repo",
  storageDir: "../custom-storage",
  defaultBaseRef: "main",
  branchPrefix: "treefork/",
  checkpointRefPrefix: "refs/treefork/checkpoints",
});
```

Or use a `treefork.config.json` file (searched upward from cwd, then `~/.config/treefork/config.json`):

```json
{
  "storageDir": "../.my-workspaces",
  "defaultBaseRef": "main"
}
```

## How it works

**Local mode** — each workspace is a git worktree stored in a sibling directory (`../.{repoName}-treefork/`). Branches are namespaced under `treefork/` and checkpoints are stored as git refs under `refs/treefork/checkpoints/`.

**Remote mode** — when `repo` is set, treefork creates a bare clone of the remote URL under the storage directory (`.treefork/.mirrors/`), then creates worktrees from it. The bare clone is fetched on initialization to stay current. Branches and checkpoint refs live in the bare clone, not on the remote.

## Alternatives

[**gtr (git-worktree-runner)**](https://github.com/coderabbitai/git-worktree-runner) — a batteries-included Bash CLI for managing git worktrees. It has editor launching, AI tool integration, shell completions, file copying, hooks, and team config via `.gtrconfig`. If you want a full-featured interactive tool for your terminal, gtr is excellent.

Treefork is different in intent: it's a **headless library first** with a minimal CLI second. There's no editor/AI integration, no shell hooks — just programmatic primitives for tools that manage workspaces on behalf of the user. If you're building an AI coding tool or orchestrator and need to embed worktree management, treefork gives you a typed API with checkpointing. If you're a developer who wants a better `git worktree` experience in your shell, use gtr.

## License

MIT
