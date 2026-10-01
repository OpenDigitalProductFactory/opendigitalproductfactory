import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BASH_COMMAND,
  BASH_OK,
  GIT_OK,
  PROMOTE_TEST_TIMEOUT_MS,
  REPO_ROOT,
  SCRIPT,
  makeScratch,
  runPromote,
} from "./promote-script-functional.test-support";

// BI-249EEA02: an unguarded `git config --global --add safe.directory '*'` in
// promote.sh appended one more `*` on every run. The functional suites ran the
// real script with the developer's real HOME, so a contributor's global
// gitconfig reached 18,495 duplicate lines, and concurrent rewrites of that
// file made unrelated git calls fail with "unable to access .gitconfig".

const WILDCARD_LINE = /^\s*directory\s*=\s*\*\s*$/gm;

function countWildcards(configPath: string): number {
  if (!existsSync(configPath)) return 0;
  return (readFileSync(configPath, "utf8").match(WILDCARD_LINE) ?? []).length;
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`${name}() {`);
  if (start < 0) return "";
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 3);
}

describe.skipIf(!BASH_OK || !GIT_OK)("promote.sh global safe.directory writes", () => {
  it("adds the wildcard at most once, however many times the step runs", () => {
    const body = functionBody(readFileSync(SCRIPT, "utf8"), "ensure_promote_safe_directory");
    expect(body, "promote.sh must route its safe.directory write through ensure_promote_safe_directory").not.toBe("");

    const dir = mkdtempSync(join(tmpdir(), "dpf-safe-dir-"));
    const configPath = join(dir, "gitconfig");
    try {
      const script = `${body}\nensure_promote_safe_directory\nensure_promote_safe_directory\nensure_promote_safe_directory\n`;
      const r = spawnSync(BASH_COMMAND, ["-c", script], {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: configPath, GIT_CONFIG_NOSYSTEM: "1" },
      });
      expect(r.status, r.stderr).toBe(0);
      expect(countWildcards(configPath)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the functional harness confines promote.sh to a scratch global gitconfig", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      const r = runPromote({ source, backup, targetSha: head, fakeBin, dockerLog: join(root, "docker.log") });
      expect(r.status, r.stderr).toBe(0);
      // The script's write landed in the harness's isolated file — proof it
      // never reached the developer's real ~/.gitconfig.
      expect(countWildcards(join(backup, "gitconfig"))).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);
});

describe.skipIf(!GIT_OK)("shipped global safe.directory writers", () => {
  it("every `git config --global --add safe.directory` is guarded by a presence check", () => {
    const tracked = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "--", "*.sh", "*.ts", "*.mjs", "*.ps1"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((path) => path && !/\.test(-support)?\.[cm]?[jt]s$/.test(path) && !path.startsWith("docs/"));

    const unguarded: string[] = [];
    for (const path of tracked) {
      const full = join(REPO_ROOT, path);
      if (!existsSync(full)) continue;
      const lines = readFileSync(full, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!line.includes("--global --add safe.directory")) return;
        // The guard sits on the same line or on the continuation lines just above it.
        const statement = lines.slice(Math.max(0, index - 2), index + 1).join("\n");
        if (!statement.includes("--get-all safe.directory")) unguarded.push(`${path}:${index + 1}`);
      });
    }
    expect(unguarded, "each --add appends a duplicate on every run; guard it with --get-all | grep -qxF").toEqual([]);
  });
});
