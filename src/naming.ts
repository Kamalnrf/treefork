import { basename, dirname, join } from "node:path";

import { InvalidNameError } from "./errors";

const DEFAULT_BRANCH_PREFIX = "treefork/";
const CHECKPOINT_REF_PREFIX = "refs/treefork/checkpoints";
const INVALID_NAME_PATTERN = /[^A-Za-z0-9._-]+/g;
const EDGE_SEPARATOR_PATTERN = /^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g;

function invalidName(message: string): InvalidNameError {
  return new InvalidNameError(message);
}

export function sanitizeName(input: string): string {
  const trimmed = input.trim();

  if (trimmed === "") {
    throw invalidName("Name cannot be empty.");
  }

  if (trimmed === "." || trimmed === "..") {
    throw invalidName(`Name "${input}" is not valid.`);
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw invalidName(`Name "${input}" cannot contain path separators.`);
  }

  if (trimmed.includes("..")) {
    throw invalidName(`Name "${input}" cannot contain path traversal sequences.`);
  }

  const sanitized = trimmed.replace(INVALID_NAME_PATTERN, "-").replace(EDGE_SEPARATOR_PATTERN, "");

  if (sanitized === "") {
    throw invalidName(`Name "${input}" is not valid.`);
  }

  return sanitized;
}

export function toBranchName(name: string, prefix = DEFAULT_BRANCH_PREFIX): string {
  return `${prefix}${sanitizeName(name)}`;
}

export function toCheckpointRef(workspace: string, checkpoint: string): string {
  return `${CHECKPOINT_REF_PREFIX}/${sanitizeName(workspace)}/${sanitizeName(checkpoint)}`;
}

export function toWorkspacePath(storageDir: string, name: string): string {
  return join(storageDir, sanitizeName(name));
}

export function defaultStorageDir(repoRoot: string): string {
  return join(dirname(repoRoot), `.${basename(repoRoot)}-treefork`);
}

export function nameFromBranch(branch: string, prefix = DEFAULT_BRANCH_PREFIX): string | null {
  if (!branch.startsWith(prefix)) {
    return null;
  }

  const extractedName = branch.slice(prefix.length);

  if (extractedName === "") {
    return null;
  }

  try {
    return sanitizeName(extractedName) === extractedName ? extractedName : null;
  } catch {
    return null;
  }
}
