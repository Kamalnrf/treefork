import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { CheckpointExistsError, CheckpointNotFoundError } from "./errors";
import { git } from "./git";
import { createCopse } from "./index";
import type { CheckpointInfo, Copse, WorkspaceInfo } from "./types";

type TestRepo = {
  repoRoot: string;
  storageDir: string;
  copse: Copse;
  workspace: WorkspaceInfo;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sortCheckpoints(checkpoints: CheckpointInfo[]): CheckpointInfo[] {
  return [...checkpoints].sort((left, right) => left.name.localeCompare(right.name));
}

async function createTestRepo(): Promise<TestRepo> {
  const repoRoot = await mkdtemp(join(tmpdir(), "copse-repo-"));
  const storageDir = await mkdtemp(join(tmpdir(), "copse-storage-"));

  try {
    await git(repoRoot, ["init"]);
    await git(repoRoot, ["config", "user.name", "Copse Tests"]);
    await git(repoRoot, ["config", "user.email", "copse@example.com"]);
    await writeFile(join(repoRoot, "README.md"), "# Copse\n");
    await git(repoRoot, ["add", "README.md"]);
    await git(repoRoot, ["commit", "-m", "Initial commit"]);

    const copse = await createCopse({ cwd: repoRoot, storageDir });
    const workspace = await copse.workspaces.create({ name: "agent" });

    return {
      repoRoot,
      storageDir,
      copse,
      workspace,
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

async function commitWorkspaceFile(
  repo: TestRepo,
  path: string,
  contents: string,
  message: string,
): Promise<string> {
  await writeFile(join(repo.workspace.path, path), contents);
  await git(repo.workspace.path, ["add", path]);
  await git(repo.workspace.path, ["commit", "-m", message]);

  return git(repo.workspace.path, ["rev-parse", "HEAD"]);
}

describe("checkpoint lifecycle integration", () => {
  test("create stores a checkpoint ref and returns checkpoint info", async () => {
    const repo = await createTestRepo();

    try {
      const commit = await git(repo.workspace.path, ["rev-parse", "HEAD"]);
      const checkpoint = await repo.copse.checkpoints.create({
        workspace: repo.workspace.name,
        name: "baseline",
      });

      expect(checkpoint).toEqual({
        workspace: "agent",
        name: "baseline",
        ref: `${repo.copse.config.checkpointRefPrefix}/agent/baseline`,
        commit,
      });
      expect(await git(repo.repoRoot, ["rev-parse", checkpoint.ref])).toBe(commit);
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("list returns an empty array and later returns created checkpoints", async () => {
    const repo = await createTestRepo();

    try {
      expect(await repo.copse.checkpoints.list({ workspace: repo.workspace.name })).toEqual([]);

      const baseline = await repo.copse.checkpoints.create({
        workspace: repo.workspace.name,
        name: "baseline",
      });
      await commitWorkspaceFile(repo, "README.md", "# Copse\n\nv2\n", "Update README");
      const updated = await repo.copse.checkpoints.create({
        workspace: repo.workspace.name,
        name: "updated",
      });

      expect(
        sortCheckpoints(await repo.copse.checkpoints.list({ workspace: repo.workspace.name })),
      ).toEqual(sortCheckpoints([baseline, updated]));
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("restore resets the workspace HEAD and tracked files to the checkpoint commit", async () => {
    const repo = await createTestRepo();

    try {
      const originalReadme = await readFile(join(repo.workspace.path, "README.md"), "utf8");
      const checkpoint = await repo.copse.checkpoints.create({
        workspace: repo.workspace.name,
        name: "baseline",
      });
      const updatedCommit = await commitWorkspaceFile(
        repo,
        "README.md",
        "# Copse\n\nchanged\n",
        "Change README",
      );

      expect(updatedCommit).not.toBe(checkpoint.commit);

      await repo.copse.checkpoints.restore({
        workspace: repo.workspace.name,
        name: "baseline",
      });

      expect(await git(repo.workspace.path, ["rev-parse", "HEAD"])).toBe(checkpoint.commit);
      expect(await readFile(join(repo.workspace.path, "README.md"), "utf8")).toBe(originalReadme);
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("restore with clean true removes untracked files", async () => {
    const repo = await createTestRepo();

    try {
      await repo.copse.checkpoints.create({
        workspace: repo.workspace.name,
        name: "baseline",
      });

      const scratchPath = join(repo.workspace.path, "scratch.txt");
      await writeFile(scratchPath, "temporary\n");

      await repo.copse.checkpoints.restore({
        workspace: repo.workspace.name,
        name: "baseline",
        clean: true,
      });

      expect(await pathExists(scratchPath)).toBe(false);
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("restore throws CheckpointNotFoundError for a missing checkpoint", async () => {
    const repo = await createTestRepo();

    try {
      await expect(
        repo.copse.checkpoints.restore({
          workspace: repo.workspace.name,
          name: "missing",
        }),
      ).rejects.toBeInstanceOf(CheckpointNotFoundError);
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("create throws CheckpointExistsError for duplicate names", async () => {
    const repo = await createTestRepo();

    try {
      await repo.copse.checkpoints.create({
        workspace: repo.workspace.name,
        name: "baseline",
      });

      await expect(
        repo.copse.checkpoints.create({
          workspace: repo.workspace.name,
          name: "baseline",
        }),
      ).rejects.toBeInstanceOf(CheckpointExistsError);
    } finally {
      await cleanupTestRepo(repo);
    }
  });

  test("removing a workspace also removes its checkpoint refs", async () => {
    const repo = await createTestRepo();

    try {
      await repo.copse.checkpoints.create({
        workspace: repo.workspace.name,
        name: "baseline",
      });
      await commitWorkspaceFile(repo, "README.md", "# Copse\n\nv2\n", "Update README");
      await repo.copse.checkpoints.create({
        workspace: repo.workspace.name,
        name: "updated",
      });

      await repo.copse.workspaces.remove({ name: repo.workspace.name });

      expect(
        await git(repo.repoRoot, [
          "for-each-ref",
          `${repo.copse.config.checkpointRefPrefix}/${repo.workspace.name}/`,
          "--format=%(refname)",
        ]),
      ).toBe("");
    } finally {
      await cleanupTestRepo(repo);
    }
  });
});
