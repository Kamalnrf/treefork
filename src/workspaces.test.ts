import { access, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { InvalidNameError, WorkspaceExistsError } from "./errors";
import { git } from "./git";
import { createTreefork } from "./index";
import type { Treefork, WorkspaceInfo } from "./types";

type TestRepo = {
  repoRoot: string;
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

async function createTestRepo(): Promise<TestRepo> {
  const repoRoot = await mkdtemp(join(tmpdir(), "treefork-repo-"));
  const storageDir = await mkdtemp(join(tmpdir(), "treefork-storage-"));

  try {
    await git(repoRoot, ["init"]);
    await git(repoRoot, ["config", "user.name", "Treefork Tests"]);
    await git(repoRoot, ["config", "user.email", "treefork@example.com"]);
    await writeFile(join(repoRoot, "README.md"), "# Treefork\n");
    await git(repoRoot, ["add", "README.md"]);
    await git(repoRoot, ["commit", "-m", "Initial commit"]);

    return {
      repoRoot,
      storageDir,
      treefork: await createTreefork({ cwd: repoRoot, storageDir }),
    };
  } catch (error) {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
    throw error;
  }
}

async function cleanupTestRepo(repo: TestRepo): Promise<void> {
  await rm(repo.repoRoot, { recursive: true, force: true });
  await rm(repo.storageDir, { recursive: true, force: true });
}

describe("workspace lifecycle integration", () => {
  test("create returns workspace info and creates a worktree directory", async () => {
    const repo = await createTestRepo();

    try {
      const head = await git(repo.repoRoot, ["rev-parse", "HEAD"]);
      const workspace = await repo.treefork.workspaces.create({ name: "agent" });
      const expectedPath = await realpath(join(repo.storageDir, "agent"));

      expect(workspace).toEqual({
        name: "agent",
        path: expectedPath,
        branch: "treefork/agent",
        head,
      });
      expect(await pathExists(workspace.path)).toBe(true);
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("list returns an empty array and later returns created workspaces", async () => {
    const repo = await createTestRepo();

    try {
      expect(await repo.treefork.workspaces.list()).toEqual([]);

      const alpha = await repo.treefork.workspaces.create({ name: "alpha" });
      const beta = await repo.treefork.workspaces.create({ name: "beta" });

      expect(sortWorkspaces(await repo.treefork.workspaces.list())).toEqual(
        sortWorkspaces([alpha, beta]),
      );
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("resolve returns workspace info for existing workspaces and null for missing workspaces", async () => {
    const repo = await createTestRepo();

    try {
      const workspace = await repo.treefork.workspaces.create({ name: "agent" });

      await expect(repo.treefork.workspaces.resolve({ name: "agent" })).resolves.toEqual(workspace);
      await expect(repo.treefork.workspaces.resolve({ name: "missing" })).resolves.toBeNull();
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("remove deletes the worktree directory and branch", async () => {
    const repo = await createTestRepo();

    try {
      const workspace = await repo.treefork.workspaces.create({ name: "agent" });

      await repo.treefork.workspaces.remove({ name: "agent" });

      expect(await pathExists(workspace.path)).toBe(false);
      expect(await repo.treefork.workspaces.resolve({ name: "agent" })).toBeNull();
      expect(await git(repo.repoRoot, ["branch", "--list", "treefork/agent"])).toBe("");
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("create throws WorkspaceExistsError for duplicate names", async () => {
    const repo = await createTestRepo();

    try {
      await repo.treefork.workspaces.create({ name: "agent" });

      await expect(repo.treefork.workspaces.create({ name: "agent" })).rejects.toBeInstanceOf(
        WorkspaceExistsError,
      );
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("remove with force works on dirty worktrees", async () => {
    const repo = await createTestRepo();

    try {
      const workspace = await repo.treefork.workspaces.create({ name: "agent" });

      await writeFile(join(workspace.path, "scratch.txt"), "dirty\n");
      await repo.treefork.workspaces.remove({ name: "agent", force: true });

      expect(await pathExists(workspace.path)).toBe(false);
      expect(await git(repo.repoRoot, ["branch", "--list", "treefork/agent"])).toBe("");
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("create throws InvalidNameError for invalid names", async () => {
    const repo = await createTestRepo();

    try {
      for (const name of ["", ".", ".."]) {
        await expect(repo.treefork.workspaces.create({ name })).rejects.toBeInstanceOf(
          InvalidNameError,
        );
      }
    } finally {
      await cleanupTestRepo(repo);
    }
  });
});
