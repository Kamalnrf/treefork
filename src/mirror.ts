import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { basename, join } from "node:path";

import { TreeforkError } from "./errors";
import { git, gitDir } from "./git";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function mirrorDirName(repoUrl: string): string {
  const hash = createHash("sha256").update(repoUrl).digest("hex").slice(0, 12);
  const base = basename(repoUrl, ".git")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const readable = base || "repo";

  return `${readable}-${hash}.git`;
}

export function mirrorPath(storageDir: string, repoUrl: string): string {
  return join(storageDir, ".mirrors", mirrorDirName(repoUrl));
}

export async function ensureMirror(repoUrl: string, mirrorDir: string, cwd: string): Promise<void> {
  if (await pathExists(mirrorDir)) {
    await fetchMirror(mirrorDir, cwd);
    return;
  }

  try {
    await git(cwd, ["clone", "--bare", repoUrl, mirrorDir]);
  } catch (error) {
    throw new TreeforkError(`Failed to clone "${repoUrl}".`, { cause: error });
  }
}

async function fetchMirror(mirrorDir: string, cwd: string): Promise<void> {
  try {
    await gitDir(mirrorDir, cwd, ["fetch", "--prune", "origin"]);
  } catch (error) {
    throw new TreeforkError(`Failed to fetch updates for mirror at "${mirrorDir}".`, {
      cause: error,
    });
  }
}
