import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { TreeforkError } from "./errors";

export function shellName(value: string | undefined): "bash" | "zsh" {
  const shell = basename(value ?? "");
  if (shell !== "bash" && shell !== "zsh") {
    throw new TreeforkError(
      "Shell integration supports bash and zsh. Use --shell bash or --shell zsh.",
    );
  }
  return shell;
}

export function shellInit(): string {
  return `# treefork shell integration
if ! command -v tf >/dev/null 2>&1 && ! alias tf >/dev/null 2>&1; then
  function tf {
    local dir arg
    if [ "$#" -eq 0 ]; then
      command treefork create --help
      return
    fi
    for arg in "$@"; do
      case "$arg" in
        --help|-h|--tmux-window|--tmux-window=*|--tmux-session|--tmux-session=*)
          command treefork create "$@"
          return
          ;;
      esac
    done
    dir="$(TREEFORK_ENTER=1 command treefork create "$@")" || return
    [ -n "$dir" ] || return 1
    cd -- "$dir"
  }
  export TREEFORK_SHELL_INTEGRATION=1
else
  if [ "\${TREEFORK_SHELL_INTEGRATION:-}" != 1 ]; then
    printf '%s\\n' 'treefork: tf already exists; shell integration was not loaded.' >&2
  fi
fi`;
}

export function shellProfile(shell: "bash" | "zsh"): string {
  if (shell === "zsh") return join(process.env.ZDOTDIR || homedir(), ".zshrc");
  if (process.platform === "darwin") {
    const profiles = [".bash_profile", ".bash_login", ".profile"].map((name) =>
      join(homedir(), name),
    );
    return profiles.find((profile) => existsSync(profile)) ?? join(homedir(), ".bash_profile");
  }
  return join(homedir(), ".bashrc");
}

export async function installShellIntegration(
  shell: "bash" | "zsh",
  profile: string,
): Promise<boolean> {
  const line = `eval "$(treefork init ${shell})" # treefork shell integration`;
  let contents: string;
  try {
    contents = await readFile(profile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    contents = "";
  }
  if (contents.split(/\r?\n/).some((existing) => existing.trim() === line)) return false;
  await mkdir(dirname(profile), { recursive: true });
  await appendFile(profile, `${contents !== "" && !contents.endsWith("\n") ? "\n" : ""}${line}\n`);
  return true;
}

export async function claimSetupHint(): Promise<boolean> {
  if (process.env.TREEFORK_SHELL_INTEGRATION === "1") return false;
  try {
    const directory = join(homedir(), ".config", "treefork");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, ".setup-hint-shown"), "", { flag: "wx" });
    return true;
  } catch {
    // A hint must never turn a successful create into an error.
    return false;
  }
}
