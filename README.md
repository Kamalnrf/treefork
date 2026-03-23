# bract

Workspace isolation for AI agents using git worktrees. Give each agent its own branch and directory — no conflicts, no coordination overhead.

Bract is a small TypeScript library and CLI. It wraps `git worktree` with a clean API for creating, listing, snapshotting, and removing isolated workspaces. Works with local repos and remote git URLs.

## Install

```bash
bun add bract
```

## CLI

```bash
# Create a workspace (prints its path)
bract create my-feature

# Create from a specific ref
bract create my-feature --base main

# Create from a remote git URL
bract create my-feature --repo git@github.com:acme/service.git

# List all workspaces
bract list

# Get the path of a workspace
bract resolve my-feature

# Remove a workspace
bract remove my-feature
bract remove my-feature --force
```

### Checkpoints

Snapshot and restore workspace state:

```bash
# Save a checkpoint
bract checkpoint create my-feature before-refactor

# List checkpoints
bract checkpoint list my-feature

# Restore a checkpoint
bract checkpoint restore my-feature before-refactor

# Restore and clean untracked files
bract checkpoint restore my-feature before-refactor --clean
```

## Library

```typescript
import { createBract } from "bract";

// From a local repo
const bract = await createBract();

// From a remote git URL
const remote = await createBract({
  repo: "git@github.com:acme/service.git",
});
```

### Workspaces

```typescript
// Create a workspace — returns { name, path, branch, head }
const ws = await bract.workspaces.create({ name: "agent-1" });
console.log(ws.path); // /Users/you/code/../.myrepo-bract/agent-1

// List all workspaces
const all = await bract.workspaces.list();

// Resolve a single workspace (returns null if not found)
const found = await bract.workspaces.resolve({ name: "agent-1" });

// Remove a workspace
await bract.workspaces.remove({ name: "agent-1" });
await bract.workspaces.remove({ name: "agent-1", force: true });
```

### Checkpoints

```typescript
// Snapshot the current state
const cp = await bract.checkpoints.create({
  workspace: "agent-1",
  name: "before-refactor",
});

// List checkpoints for a workspace
const checkpoints = await bract.checkpoints.list({ workspace: "agent-1" });

// Restore a checkpoint
await bract.checkpoints.restore({
  workspace: "agent-1",
  name: "before-refactor",
  clean: true, // optional: remove untracked files
});
```

### Configuration

Pass options to `createBract` to override defaults:

```typescript
const bract = await createBract({
  cwd: "/path/to/repo",
  storageDir: "../custom-storage",
  defaultBaseRef: "main",
  branchPrefix: "bract/",
  checkpointRefPrefix: "refs/bract/checkpoints",
});
```

Or use a `bract.config.json` file (searched upward from cwd, then `~/.config/bract/config.json`):

```json
{
  "storageDir": "../.my-workspaces",
  "defaultBaseRef": "main"
}
```

## How it works

**Local mode** — each workspace is a git worktree stored in a sibling directory (`../.{repoName}-bract/`). Branches are namespaced under `bract/` and checkpoints are stored as git refs under `refs/bract/checkpoints/`.

**Remote mode** — when `repo` is set, bract creates a bare clone of the remote URL under the storage directory (`.bract/.mirrors/`), then creates worktrees from it. The bare clone is fetched on initialization to stay current. Branches and checkpoint refs live in the bare clone, not on the remote.

## Alternatives

[**gtr (git-worktree-runner)**](https://github.com/coderabbitai/git-worktree-runner) — a batteries-included Bash CLI for managing git worktrees. It has editor launching, AI tool integration, shell completions, file copying, hooks, and team config via `.gtrconfig`. If you want a full-featured interactive tool for your terminal, gtr is excellent.

Bract is different in intent: it's a **headless library first** with a minimal CLI second. There's no editor/AI integration, no shell hooks — just programmatic primitives for tools that manage workspaces on behalf of the user. If you're building an AI coding tool or orchestrator and need to embed worktree management, bract gives you a typed API with checkpointing. If you're a developer who wants a better `git worktree` experience in your shell, use gtr.

## License

MIT
