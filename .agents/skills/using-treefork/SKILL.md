---
name: using-treefork
description: Uses treefork to create, reuse, inspect, checkpoint, and remove git worktree-based agent workspaces, including tmux window/session placement. Use when setting up parallel coding-agent work, managing treefork workspaces, documenting treefork usage, or writing code against the treefork library.
---

# Using Treefork

Treefork is a current-repo scoped worktree lifecycle tool. Run it from the repository you want to fork; do not make treefork discover projects under `~/workspace`.

## Default CLI workflow for project work

Use treefork for non-trivial project code work, especially when multiple agents or parallel experiments are involved.

```bash
cd ~/workspace/<project>
treefork create <work-name> --tmux-window
```

- `create` is CLI-idempotent: it creates the workspace if missing and reuses it if already registered.
- `--tmux-window` opens/reuses a window named `<work-name>` in the current tmux session.
- `--tmux-session <session>` opens/reuses a window named `<work-name>` inside the named session.
- If treefork is unavailable, use manual `git worktree` as a fallback and preserve the same naming/cleanup discipline.

Prefer work names that are short, descriptive, and unique within the repo/session, for example:

```bash
treefork create launch-checklist --tmux-window
treefork create auth-review --tmux-session quire
```

## Cleanup

Remove workspaces when the work is merged, abandoned, or no longer useful:

```bash
treefork remove <work-name> --force
```

Current behavior removes the git worktree, branch, and checkpoint refs. It does **not** remove tmux windows or sessions; close those separately for now and record repeated cleanup friction as dogfooding feedback.

## Inspecting and resuming work

```bash
treefork list
treefork resolve <work-name>
treefork create <work-name> --tmux-window
```

Because CLI `create` reuses existing workspaces, it is the preferred resume command when you also want tmux placement.

## Checkpoints

Use checkpoints before risky refactors or exploratory agent work:

```bash
treefork checkpoint create <work-name> before-refactor
treefork checkpoint list <work-name>
treefork checkpoint restore <work-name> before-refactor
treefork checkpoint restore <work-name> before-refactor --clean
```

Checkpoints are git refs under `refs/treefork/checkpoints/`; they are local workspace safety points, not a replacement for commits.

## Library usage

Use the library for tools and orchestrators that need typed worktree primitives.

```ts
import { createTreefork } from "treefork";

const treefork = await createTreefork({ cwd: "/path/to/repo" });

const workspace = await treefork.workspaces.create({
  name: "agent-1",
  baseRef: "main",
});

const existing = await treefork.workspaces.resolve({ name: "agent-1" });
const all = await treefork.workspaces.list();

await treefork.checkpoints.create({ workspace: "agent-1", name: "before-change" });
await treefork.workspaces.remove({ name: "agent-1", force: true });
```

Important distinction: the library `workspaces.create()` is strict and throws on duplicates. Idempotent create-or-reuse behavior is a CLI affordance, not the library primitive. Library callers that need idempotence should call `resolve()` before `create()` or catch duplicate errors and resolve the existing workspace.

## Dogfooding feedback

When using treefork in this VM, capture issues as they appear:

- tmux behavior surprises;
- stale window/session cleanup gaps;
- confusing command names or flags;
- branch/worktree naming friction;
- missing metadata or resume affordances;
- anything that makes parallel agent orchestration harder.

Record feedback in the workspace task board or project issue tracker, then turn repeated or high-impact friction into treefork follow-up work.
