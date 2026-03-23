import { describe, expect, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git } from "./git";
import { createTreefork } from "./index";
import type { Treefork, WorkspaceInfo } from "./types";

type TestRemoteRepo = {
  originDir: string;
  storageDir: string;
  treefork: Treefork;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sortWorkspaces(workspaces: WorkspaceInfo[]): WorkspaceInfo[] {
  return [...workspaces].sort((left, right) => left.name.localeCompare(right.name));
}

async function createTestRemoteRepo(): Promise<TestRemoteRepo> {
  const originDir = await mkdtemp(join(tmpdir(), "treefork-origin-"));
  const storageDir = await mkdtemp(join(tmpdir(), "treefork-remote-storage-"));

  await git(originDir, ["init"]);
  await git(originDir, ["config", "user.name", "Treefork Tests"]);
  await git(originDir, ["config", "user.email", "treefork@example.com"]);
  await writeFile(join(originDir, "README.md"), "# Remote\n");
  await git(originDir, ["add", "README.md"]);
  await git(originDir, ["commit", "-m", "Initial commit"]);

  const treefork = await createTreefork({
    repo: originDir,
    storageDir,
  });

  return { originDir, storageDir, treefork };
}

async function cleanupTestRemoteRepo(repo: TestRemoteRepo): Promise<void> {
  await rm(repo.originDir, { recursive: true, force: true });
  await rm(repo.storageDir, { recursive: true, force: true });
}

describe("remote repo workspace lifecycle", () => {
  test("create returns workspace info from a remote repo", async () => {
    const repo = await createTestRemoteRepo();

    try {
      const head = await git(repo.originDir, ["rev-parse", "HEAD"]);
      const workspace = await repo.treefork.workspaces.create({ name: "agent" });

      expect(workspace.name).toBe("agent");
      expect(workspace.branch).toBe("treefork/agent");
      expect(workspace.head).toBe(head);
      expect(await pathExists(workspace.path)).toBe(true);

      const worktreeReadme = await Bun.file(join(workspace.path, "README.md")).text();
      expect(worktreeReadme).toBe("# Remote\n");
    } finally {
      await cleanupTestRemoteRepo(repo);
    }
  });

  test("list returns created workspaces", async () => {
    const repo = await createTestRemoteRepo();

    try {
      expect(await repo.treefork.workspaces.list()).toEqual([]);

      const alpha = await repo.treefork.workspaces.create({ name: "alpha" });
      const beta = await repo.treefork.workspaces.create({ name: "beta" });

      expect(sortWorkspaces(await repo.treefork.workspaces.list())).toEqual(
        sortWorkspaces([alpha, beta]),
      );
    } finally {
      await cleanupTestRemoteRepo(repo);
    }
  });

  test("resolve and remove work for remote workspaces", async () => {
    const repo = await createTestRemoteRepo();

    try {
      const workspace = await repo.treefork.workspaces.create({ name: "agent" });

      await expect(repo.treefork.workspaces.resolve({ name: "agent" })).resolves.toEqual(workspace);

      await repo.treefork.workspaces.remove({ name: "agent" });

      expect(await pathExists(workspace.path)).toBe(false);
      expect(await repo.treefork.workspaces.resolve({ name: "agent" })).toBeNull();
    } finally {
      await cleanupTestRemoteRepo(repo);
    }
  });

  test("checkpoints work with remote workspaces", async () => {
    const repo = await createTestRemoteRepo();

    try {
      const workspace = await repo.treefork.workspaces.create({ name: "agent" });

      await writeFile(join(workspace.path, "file.txt"), "v1\n");
      await git(workspace.path, ["add", "file.txt"]);
      await git(workspace.path, ["commit", "-m", "Add file"]);

      await repo.treefork.checkpoints.create({ workspace: "agent", name: "snap" });

      await writeFile(join(workspace.path, "file.txt"), "v2\n");
      await git(workspace.path, ["add", "file.txt"]);
      await git(workspace.path, ["commit", "-m", "Update file"]);

      await repo.treefork.checkpoints.restore({
        workspace: "agent",
        name: "snap",
      });

      const content = await Bun.file(join(workspace.path, "file.txt")).text();
      expect(content).toBe("v1\n");
    } finally {
      await cleanupTestRemoteRepo(repo);
    }
  });

  test("config mode is remote", async () => {
    const repo = await createTestRemoteRepo();

    try {
      expect(repo.treefork.config.mode).toBe("remote");
    } finally {
      await cleanupTestRemoteRepo(repo);
    }
  });
});
