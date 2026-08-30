// scripts/hooks/converge-git-hooks.test.mjs
//
// BI-3727106F — the pre-push gate must converge at session start, sweep sibling
// worktrees, and refuse to converge a tree that would be BROKEN by the shim.
//
// Measured before this landed: 68 of 85 worktrees on the dev install carried the
// stock git-lfs shim and pushed with no gate, because convergence ran only in
// `pnpm install` postinstall AND ran the tree's own (possibly stale) copy.
//
// Run: node --test scripts/hooks/converge-git-hooks.test.mjs

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  canConverge,
  convergeHooksDir,
  summarizeConvergence,
} from "../lib/converge-hooks-dir.mjs";
import { parseWorktreePaths, shouldSweep, SWEEP_THROTTLE_MS } from "./converge-git-hooks.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const STOCK_LFS_SHIM = `#!/bin/sh
command -v git-lfs >/dev/null 2>&1 || { printf >&2 "\n%s\n\n" "This repository is configured for Git LFS but 'git-lfs' was not found on your path."; exit 2; }
git lfs pre-push "$@"
`;

/** @param {{ withChain?: boolean, prePush?: string | null }} opts */
function makeHooksDir(opts = {}) {
  const { withChain = true, prePush = null } = opts;
  const root = mkdtempSync(join(tmpdir(), "dpf-hooks-"));
  const hooksDir = join(root, ".githooks");
  mkdirSync(join(hooksDir, "lib"), { recursive: true });
  if (withChain) writeFileSync(join(hooksDir, "lib", "pre-push-chained.sh"), "#!/bin/sh\nexit 0\n");
  if (withChain) writeFileSync(join(hooksDir, "lib", "post-checkout-chained.sh"), "#!/bin/sh\nexit 0\n");
  if (prePush != null) writeFileSync(join(hooksDir, "pre-push"), prePush);
  return { root, hooksDir };
}

// ── the safety property that matters most ────────────────────────────────────

test("refuses to converge a tree lacking the chained script (would break push, not merely leave it ungated)", () => {
  const { root, hooksDir } = makeHooksDir({ withChain: false, prePush: STOCK_LFS_SHIM });
  try {
    assert.equal(canConverge(hooksDir), false);
    const result = convergeHooksDir(hooksDir);
    assert.equal(result.prePush, "chain-absent");
    // The stock shim must survive untouched: a shim that execs a missing
    // script fails every push, which is strictly worse than not gating.
    assert.equal(readFileSync(join(hooksDir, "pre-push"), "utf8"), STOCK_LFS_SHIM);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replaces the stock git-lfs shim with the delegating shim", () => {
  const { root, hooksDir } = makeHooksDir({ prePush: STOCK_LFS_SHIM });
  try {
    const result = convergeHooksDir(hooksDir);
    assert.equal(result.prePush, "written");
    assert.match(readFileSync(join(hooksDir, "pre-push"), "utf8"), /pre-push-chained\.sh/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writes a shim when none exists, and is idempotent on a second run", () => {
  const { root, hooksDir } = makeHooksDir({ prePush: null });
  try {
    assert.equal(convergeHooksDir(hooksDir).prePush, "written");
    assert.equal(convergeHooksDir(hooksDir).prePush, "unchanged");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("never clobbers a hand-rolled hook", () => {
  const custom = "#!/bin/sh\n# my own hook\nexit 0\n";
  const { root, hooksDir } = makeHooksDir({ prePush: custom });
  try {
    assert.equal(convergeHooksDir(hooksDir).prePush, "left-custom");
    assert.equal(readFileSync(join(hooksDir, "pre-push"), "utf8"), custom);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── sweep planning ───────────────────────────────────────────────────────────

test("parseWorktreePaths reads every worktree and ignores other porcelain fields", () => {
  const porcelain = [
    "worktree D:/DPF-source-root",
    "HEAD 2468ca8ba6",
    "branch refs/heads/main",
    "",
    "worktree D:/DPF-worktrees/feature-a",
    "HEAD 9f94d810cb",
    "branch refs/heads/feat/a",
    "",
  ].join("\n");
  assert.deepEqual(parseWorktreePaths(porcelain), [
    "D:/DPF-source-root",
    "D:/DPF-worktrees/feature-a",
  ]);
});

test("parseWorktreePaths tolerates CRLF and empty input", () => {
  assert.deepEqual(parseWorktreePaths("worktree /a\r\nHEAD x\r\n\r\nworktree /b\r\n"), ["/a", "/b"]);
  assert.deepEqual(parseWorktreePaths(""), []);
  assert.deepEqual(parseWorktreePaths(null), []);
});

test("shouldSweep fails toward sweeping when the marker is unreadable", () => {
  // An extra sweep costs a few file stats; a skipped one costs an ungated push.
  assert.equal(shouldSweep(null, 1_000_000), true);
  assert.equal(shouldSweep(Number.NaN, 1_000_000), true);
});

test("shouldSweep throttles concurrent sessions but reopens after the window", () => {
  const now = 1_000_000_000;
  assert.equal(shouldSweep(now - 1_000, now), false);
  assert.equal(shouldSweep(now - SWEEP_THROTTLE_MS - 1, now), true);
});

// ── reporting ────────────────────────────────────────────────────────────────

test("summary names repairs and refusals; a fully converged estate is not news", () => {
  const summary = summarizeConvergence([
    { hooksDir: "a", prePush: "written", postCheckout: "written" },
    { hooksDir: "b", prePush: "unchanged", postCheckout: "unchanged" },
    { hooksDir: "c", prePush: "chain-absent", postCheckout: "chain-absent" },
  ]);
  assert.match(summary, /3 tree\(s\) checked/);
  assert.match(summary, /1 pre-push gate\(s\) REPAIRED/);
  assert.match(summary, /1 skipped/);

  const quiet = summarizeConvergence([{ hooksDir: "a", prePush: "unchanged", postCheckout: "unchanged" }]);
  assert.doesNotMatch(quiet, /REPAIRED|skipped|FAILED/);
});

// ── the regression that started all of this ──────────────────────────────────

test("no hook-path source re-derives a filesystem path from URL.pathname (BI-5CBDC146)", () => {
  // On Windows `new URL(import.meta.url).pathname` is "/D:/repo/..." and every
  // path built from it is unopenable, so the converger threw into a bare catch
  // and the gate silently never installed. Linux CI cannot reproduce the
  // failure, so this source-level assertion is the only thing that catches a
  // reintroduction.
  for (const file of ["converge-git-hooks.mjs", join("..", "lib", "converge-hooks-dir.mjs")]) {
    const source = readFileSync(join(here, file), "utf8");
    const offending = source
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("//"))
      .filter((line) => /URL\([^)]*\)\s*\.pathname|import\.meta\.url\s*\)\s*\.pathname/.test(line));
    assert.deepEqual(offending, [], `${file} must resolve paths with fileURLToPath, not URL.pathname`);
  }
});
