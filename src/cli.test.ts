import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "treefork-cli-"));
  const home = join(root, "home");
  const repo = join(home, "Client work", "repo");
  const bin = join(root, "bin");
  await mkdir(repo, { recursive: true });
  await mkdir(bin);
  await writeFile(join(bin, "treefork"), `#!/bin/sh\nexec '${process.execPath}' '${cli}' "$@"\n`, {
    mode: 0o755,
  });
  const env = {
    ...process.env,
    HOME: home,
    ZDOTDIR: join(home, "zsh config"),
    SHELL: "/bin/bash",
    PATH: `${bin}:${process.env.PATH}`,
    TREEFORK_SHELL_INTEGRATION: "",
    TREEFORK_ENTER: "",
  };
  const run = (args: string[]) =>
    spawnSync(join(bin, "treefork"), args, { cwd: repo, env, encoding: "utf8" });
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git(["init", "-q"]);
  git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "initial",
  ]);
  await writeFile(
    join(repo, "treefork.config.json"),
    JSON.stringify({ storageDir: "../work trees/it's $safe", branchPrefix: "agent/" }),
  );
  return { root, home, repo, env, run };
}

test("setup requires approval, preserves profiles, and is repeat-safe", async () => {
  const f = await fixture();
  try {
    const profile = join(f.home, process.platform === "darwin" ? ".bash_profile" : ".bashrc");
    await writeFile(profile, "# existing settings without a final newline");
    expect(f.run(["setup", "--shell", "bash"]).status).toBe(1);
    expect(await readFile(profile, "utf8")).toBe("# existing settings without a final newline");
    expect(f.run(["setup", "--shell", "fish", "--yes"]).status).toBe(1);
    expect(f.run(["setup", "--shell", "bash", "--yes"]).status).toBe(0);
    const installed = await readFile(profile, "utf8");
    expect(installed).toStartWith("# existing settings without a final newline\n");
    expect(f.run(["setup", "--shell", "bash", "--yes"]).status).toBe(0);
    expect(await readFile(profile, "utf8")).toBe(installed);
    expect(f.run(["setup", "--shell", "zsh", "--yes"]).status).toBe(0);
    expect(await readFile(join(f.env.ZDOTDIR, ".zshrc"), "utf8")).toContain("treefork init zsh");
    expect(f.run(["init", "fish"]).status).toBe(1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

for (const shell of ["bash", "zsh"]) {
  test.skipIf(!Bun.which(shell))(
    `${shell}: tf creates/reuses and enters, but does not navigate on help or failure`,
    async () => {
      const f = await fixture();
      try {
        const expected = join(dirname(f.repo), "work trees", "it's $safe", "feature");
        const result = spawnSync(
          shell,
          [
            "-c",
            `
        eval "$(treefork init ${shell})"
        eval "$(treefork init ${shell})"
        tf feature --base HEAD || exit 10
        printf 'created:%s\\n' "$PWD"
        cd "$REPO" || exit 11
        tf feature || exit 12
        printf 'reused:%s\\n' "$PWD"
        tf --help >/dev/null || exit 13
        printf 'help:%s\\n' "$PWD"
        tf >/dev/null || exit 14
        cd "$REPO" || exit 15
        if tf missing --base does-not-exist 2>/dev/null; then exit 16; fi
        printf 'failed:%s\\n' "$PWD"
        treefork resolve feature
      `,
          ],
          { cwd: f.repo, env: { ...f.env, REPO: f.repo }, encoding: "utf8" },
        );
        expect(result.status).toBe(0);
        expect(result.stdout.trim().split("\n")).toEqual([
          `created:${expected}`,
          `reused:${expected}`,
          `help:${expected}`,
          `failed:${f.repo}`,
          expected,
        ]);
        expect(f.run(["create", "feature"]).stdout).toBe(`${expected}\n`);
        expect(f.run(["resolve", "feature"]).stdout).toBe(`${expected}\n`);
        expect(f.run(["create", "feature"]).stderr).toBe("");

        for (const definition of ["tf() { printf existing; }", "alias tf='printf existing'"]) {
          const collision = spawnSync(
            shell,
            [
              "-c",
              `${shell === "bash" ? "shopt -s expand_aliases\n" : ""}${definition}\neval "$(treefork init ${shell})"\neval tf`,
            ],
            { cwd: f.repo, env: f.env, encoding: "utf8" },
          );
          expect(collision.status).toBe(0);
          expect(collision.stdout).toBe("existing");
          expect(collision.stderr).toContain("tf already exists");
        }
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    },
  );
}
