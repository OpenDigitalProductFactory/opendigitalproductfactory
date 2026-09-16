// Behaviour tests for the SessionStart worktree-freshness hook (BI-9A46E89C).
//
// The hook had no test at all. The instruction-plane signal it now carries is
// load-bearing — it is the only thing that tells a session its RULEBOOK is
// stale, a condition the session cannot otherwise detect, because the stale
// AGENTS.md does not know it is stale.
//
// Every case drives the REAL shell script against a REAL throwaway git repo.
// A mocked git would prove nothing here: the whole contract is which refs the
// hook consults and what it concludes from them.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const HOOK = join(here, "worktree-freshness.sh");
const PRINCIPLES = "docs/founder-kernel/wiki/principles";

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e.com" },
  });
}

function runHook(cwd, env = {}) {
  const result = spawnSync("sh", [HOOK], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { out: `${result.stdout}${result.stderr}`, status: result.status };
}

/**
 * A bare origin, a main clone, and a linked worktree branched at `main`'s first
 * commit — the shape the hook is written for. `advance` then moves main.
 */
function fixture(advance) {
  const root = mkdtempSync(join(tmpdir(), "dpf-freshness-"));
  const origin = join(root, "origin.git");
  const clone = join(root, "clone");
  const wt = join(root, "wt");
  git(root, "init", "-q", "--bare", origin);
  git(root, "clone", "-q", origin, clone);
  mkdirSync(join(clone, PRINCIPLES), { recursive: true });
  writeFileSync(join(clone, "AGENTS.md"), "v1\n");
  writeFileSync(join(clone, PRINCIPLES, "a.md"), "p1\n");
  writeFileSync(join(clone, "code.txt"), "c1\n");
  git(clone, "add", "-A");
  git(clone, "commit", "-q", "-m", "base");
  git(clone, "push", "-q", "-u", "origin", "HEAD:main");
  const base = git(clone, "rev-parse", "HEAD").trim();
  advance(clone);
  git(clone, "push", "-q", "origin", "HEAD:main");
  git(clone, "worktree", "add", "-q", wt, "-b", "topic", base);
  git(wt, "fetch", "-q", "origin", "main:refs/remotes/origin/main", "--force");
  return { root, wt, clone };
}

function cleanup(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}

test("reports the instruction plane when AGENTS.md moved, even ONE commit behind", () => {
  // The commit-count threshold is 40. A rulebook change one commit away is
  // invisible to it, and is exactly as dangerous.
  const { root, wt } = fixture((clone) => {
    writeFileSync(join(clone, "AGENTS.md"), "v2 with a new commandment\n");
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "rulebook moves");
  });
  try {
    const { out, status } = runHook(wt);
    assert.equal(status, 0, "a freshness check must never block a session");
    assert.match(out, /INSTRUCTION PLANE|instruction plane/i);
    assert.match(out, /AGENTS\.md has changed/);
    assert.match(out, /FALSE NEGATIVE/);
    // It must NOT claim the base is stale: one commit is under the threshold.
    assert.doesNotMatch(out, /looks stale/);
  } finally {
    cleanup(root);
  }
});

test("counts changed kernel principles", () => {
  const { root, wt } = fixture((clone) => {
    writeFileSync(join(clone, PRINCIPLES, "b.md"), "p2\n");
    writeFileSync(join(clone, PRINCIPLES, "c.md"), "p3\n");
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "two new principles");
  });
  try {
    const { out } = runHook(wt);
    assert.match(out, /2 kernel principle file\(s\) have changed/);
  } finally {
    cleanup(root);
  }
});

test("stays silent when only non-instruction files moved under the threshold", () => {
  // The signal must be specific. Ordinary code drift is not a rulebook change,
  // and a hook that cries wolf gets silenced with DPF_SKIP_WORKTREE_FRESHNESS.
  const { root, wt } = fixture((clone) => {
    for (let i = 0; i < 3; i += 1) {
      writeFileSync(join(clone, `code${i}.txt`), `x${i}\n`);
      git(clone, "add", "-A");
      git(clone, "commit", "-q", "-m", `code ${i}`);
    }
  });
  try {
    const { out, status } = runHook(wt);
    assert.equal(status, 0);
    assert.equal(out.trim(), "", `expected silence, got:\n${out}`);
  } finally {
    cleanup(root);
  }
});

test("stays silent when the worktree is level with origin/main", () => {
  const { root, wt } = fixture((clone) => {
    writeFileSync(join(clone, "AGENTS.md"), "v2\n");
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "rulebook moves");
  });
  try {
    git(wt, "reset", "-q", "--hard", "origin/main");
    const { out } = runHook(wt);
    assert.equal(out.trim(), "", `expected silence after refresh, got:\n${out}`);
  } finally {
    cleanup(root);
  }
});

test("honours the silence switch", () => {
  const { root, wt } = fixture((clone) => {
    writeFileSync(join(clone, "AGENTS.md"), "v2\n");
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "rulebook moves");
  });
  try {
    const { out, status } = runHook(wt, { DPF_SKIP_WORKTREE_FRESHNESS: "1" });
    assert.equal(status, 0);
    assert.equal(out.trim(), "");
  } finally {
    cleanup(root);
  }
});

test("reports BOTH signals when the base is far behind and the rulebook moved", () => {
  const { root, wt } = fixture((clone) => {
    for (let i = 0; i < 45; i += 1) {
      writeFileSync(join(clone, `code${i}.txt`), `x${i}\n`);
      git(clone, "add", "-A");
      git(clone, "commit", "-q", "-m", `code ${i}`);
    }
    writeFileSync(join(clone, "AGENTS.md"), "v2\n");
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "rulebook moves");
  });
  try {
    const { out } = runHook(wt);
    assert.match(out, /looks stale/, "the original base advisory must survive");
    assert.match(out, /instruction plane/i, "and the plane advisory must also print");
  } finally {
    cleanup(root);
  }
});

test("never runs a network fetch", () => {
  // The hook judges against the LAST-known origin/main on purpose: a fetch at
  // SessionStart can hang, and a freshness check that hangs a session is worse
  // than one that is slightly behind.
  const source = readFileSync(HOOK, "utf8");
  // Match git in COMMAND position only. The hook legitimately PRINTS
  // "git fetch origin main" as its remedy, and an earlier version of this test
  // flagged that advisory text as an executed fetch — a false positive from
  // scanning raw source instead of code, the same mistake guard detectors make.
  const executed = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .filter((line) => /^\s*(git|\$\(git)\s+(-\S+\s+)*fetch\b/.test(line));
  assert.deepEqual(executed, [], `the hook must not fetch; found: ${executed.join(" | ")}`);
});
