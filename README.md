# copse

Workspace isolation for AI agents using git worktrees. Give each agent its own branch and directory — no conflicts, no coordination overhead.

Copse is a small TypeScript library and CLI. It wraps `git worktree` with a clean API for creating, listing, snapshotting, and removing isolated workspaces.

## Install

```bash
bun add copse
```

## CLI

```bash
# Create a workspace (prints its path)
copse create my-feature

# Create from a specific ref
copse create my-feature --base main

# List all workspaces
copse list

# Get the path of a workspace
copse resolve my-feature

# Remove a workspace
copse remove my-feature
copse remove my-feature --force
```

### Checkpoints

Snapshot and restore workspace state:

```bash
# Save a checkpoint
copse checkpoint create my-feature before-refactor

# List checkpoints
copse checkpoint list my-feature

# Restore a checkpoint
copse checkpoint restore my-feature before-refactor

# Restore and clean untracked files
copse checkpoint restore my-feature before-refactor --clean
```

## Library

```typescript
import { createCopse } from "copse";

const copse = await createCopse();
```

### Workspaces

```typescript
// Create a workspace — returns { name, path, branch, head }
const ws = await copse.workspaces.create({ name: "agent-1" });
console.log(ws.path); // /Users/you/code/../.myrepo-copse/agent-1

// List all workspaces
const all = await copse.workspaces.list();

// Resolve a single workspace (returns null if not found)
const found = await copse.workspaces.resolve({ name: "agent-1" });

// Remove a workspace
await copse.workspaces.remove({ name: "agent-1" });
await copse.workspaces.remove({ name: "agent-1", force: true });
```

### Checkpoints

```typescript
// Snapshot the current state
const cp = await copse.checkpoints.create({
  workspace: "agent-1",
  name: "before-refactor",
});

// List checkpoints for a workspace
const checkpoints = await copse.checkpoints.list({ workspace: "agent-1" });

// Restore a checkpoint
await copse.checkpoints.restore({
  workspace: "agent-1",
  name: "before-refactor",
  clean: true, // optional: remove untracked files
});
```

### Configuration

Pass options to `createCopse` to override defaults:

```typescript
const copse = await createCopse({
  cwd: "/path/to/repo",
  storageDir: "../custom-storage",
  defaultBaseRef: "main",
  branchPrefix: "copse/",
  checkpointRefPrefix: "refs/copse/checkpoints",
});
```

Or use a `copse.config.json` file (searched upward from cwd, then `~/.config/copse/config.json`):

```json
{
  "storageDir": "../.my-workspaces",
  "defaultBaseRef": "main"
}
```

## How it works

Each workspace is a git worktree stored in a sibling directory (`../.{repoName}-copse/`). Branches are namespaced under `copse/` and checkpoints are stored as git refs under `refs/copse/checkpoints/`. Nothing leaves your local repo.

## Alternatives

[**gtr (git-worktree-runner)**](https://github.com/coderabbitai/git-worktree-runner) — a batteries-included Bash CLI for managing git worktrees. It has editor launching, AI tool integration, shell completions, file copying, hooks, and team config via `.gtrconfig`. If you want a full-featured interactive tool for your terminal, gtr is excellent.

Copse is different in intent: it's a **headless library first** with a minimal CLI second. There's no editor/AI integration, no shell hooks — just programmatic primitives for tools that manage workspaces on behalf of the user. If you're building an AI coding tool or orchestrator and need to embed worktree management, copse gives you a typed API with checkpointing. If you're a developer who wants a better `git worktree` experience in your shell, use gtr.

## License

MIT
