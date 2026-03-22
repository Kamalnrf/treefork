import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CopseGitError } from "./errors";

const execFileAsync = promisify(execFile);

type ExecFileFailure = Error & {
  code?: number | string | null;
  stderr?: string | Buffer;
};

function toExitCode(code: number | string | null | undefined): number | null {
  return typeof code === "number" ? code : null;
}

function toText(value: string | Buffer | undefined): string {
  if (value === undefined) {
    return "";
  }

  return typeof value === "string" ? value : value.toString("utf8");
}

export async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
    });

    return stdout.trim();
  } catch (error) {
    const failure = error as ExecFileFailure;

    throw new CopseGitError({
      stderr: toText(failure.stderr).trim(),
      exitCode: toExitCode(failure.code),
      command: ["git", ...args],
      cause: error,
    });
  }
}
