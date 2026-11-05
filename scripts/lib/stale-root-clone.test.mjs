// scripts/lib/stale-root-clone.test.mjs — BI-A900EA3F
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkStaleRootClone,
  measureRootBehindOriginMain,
  resolveRootClonePath,
} from "./stale-root-clone.mjs";

test("resolveRootClonePath returns a path for this repo checkout", () => {
  const root = resolveRootClonePath(process.cwd());
  assert.ok(root, "expected a root clone path");
  assert.match(root.replace(/\\/g, "/"), /DPF/i);
});

test("measureRootBehindOriginMain returns a finite behind count", () => {
  const root = resolveRootClonePath(process.cwd());
  assert.ok(root);
  const m = measureRootBehindOriginMain(root);
  assert.ok(m);
  assert.equal(typeof m.behind, "number");
  assert.ok(Number.isFinite(m.behind));
  assert.ok(m.rootSha);
  assert.ok(m.originMainSha);
});

test("checkStaleRootClone is ok when root is current or junctions absent", () => {
  const result = checkStaleRootClone({
    worktreeRoot: process.cwd(),
    requireJunction: true,
  });
  // Either not a linked worktree, no junctions, or current — must not throw.
  assert.equal(typeof result.ok, "boolean");
  if (!result.ok) {
    assert.equal(result.cause, "stale-root-clone");
    assert.match(result.message ?? "", /Stale root clone detected/);
    assert.match(result.message ?? "", /merge --ff-only origin\/main/);
    assert.match(result.message ?? "", /base-drift/);
  }
});

test("checkStaleRootClone can force-fail when behind with requireJunction false", () => {
  // Inject a fake git that reports behind=3.
  const spawnSyncImpl = (_cmd, args, opts) => {
    const joined = args.join(" ");
    if (joined.includes("rev-parse --git-common-dir")) {
      return { status: 0, stdout: "D:/DPF/.git\n", error: null };
    }
    if (joined.includes("rev-parse HEAD") && !joined.includes("origin")) {
      const head = opts?.cwd === "D:/DPF-worktrees/example" ? "c" : "a";
      return { status: 0, stdout: `${head.repeat(40)}\n`, error: null };
    }
    if (joined.includes("rev-parse origin/main")) {
      return { status: 0, stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n", error: null };
    }
    if (joined.includes("rev-list --count")) {
      return { status: 0, stdout: "3\n", error: null };
    }
    return { status: 0, stdout: "", error: null };
  };

  const result = checkStaleRootClone({
    worktreeRoot: "D:/DPF-worktrees/example",
    spawnSyncImpl,
    requireJunction: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.behind, 3);
  assert.match(result.message ?? "", /3 commit/);
  assert.match(result.message ?? "", /stale-root-clone/);
});

// BI-4F89896B: the Build Studio grader is a detached worktree of the build tree
// at the build's own HEAD, with node_modules linked into that tree. The "root"
// is then the build's topic branch, behind origin/main by ordinary base drift.
// Junctioned packages resolve to the same commit being graded, so no phantom
// error is possible, and the check must not refuse the whole gauntlet.
test("checkStaleRootClone passes when the root clone sits on the worktree's own commit", () => {
  const spawnSyncImpl = (_cmd, args) => {
    const joined = args.join(" ");
    if (joined.includes("rev-parse --git-common-dir")) {
      return { status: 0, stdout: "/workspace/.builds/FB-1/.git\n", error: null };
    }
    if (joined.includes("rev-parse HEAD") && !joined.includes("origin")) {
      return { status: 0, stdout: `${"a".repeat(40)}\n`, error: null };
    }
    if (joined.includes("rev-parse origin/main")) {
      return { status: 0, stdout: `${"b".repeat(40)}\n`, error: null };
    }
    if (joined.includes("rev-list --count")) {
      return { status: 0, stdout: "1\n", error: null };
    }
    return { status: 0, stdout: "", error: null };
  };

  const result = checkStaleRootClone({
    worktreeRoot: "/workspace/.builds/FB-1.grader",
    spawnSyncImpl,
    requireJunction: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, "root-at-worktree-head");
});
