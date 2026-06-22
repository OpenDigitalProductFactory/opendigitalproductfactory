import assert from "node:assert/strict";
import { test } from "node:test";

import { planWorktree, safeWorktreeName } from "./worktree-create.mjs";

// ── planWorktree: canonical sibling base, per-OS ──────────────────────────────

test("Windows root -> sibling D:/DPF-worktrees/<name> off the same drive", () => {
  const p = planWorktree({ mainRoot: "D:/DPF", worktreeName: "quizzical-fermat-04968d" });
  assert.deepEqual(p, {
    base: "D:/DPF-worktrees",
    target: "D:/DPF-worktrees/quizzical-fermat-04968d",
    branch: "quizzical-fermat-04968d",
  });
});

test("backslash root is normalized to forward slashes", () => {
  const p = planWorktree({ mainRoot: "D:\\DPF", worktreeName: "fix-thing" });
  assert.equal(p.target, "D:/DPF-worktrees/fix-thing");
});

test("POSIX root -> ~/dpf-worktrees-style sibling", () => {
  const p = planWorktree({ mainRoot: "/home/dev/dpf", worktreeName: "feat-x" });
  assert.deepEqual(p, {
    base: "/home/dev/dpf-worktrees",
    target: "/home/dev/dpf-worktrees/feat-x",
    branch: "feat-x",
  });
});

test("trailing slash on the root is ignored", () => {
  const p = planWorktree({ mainRoot: "D:/DPF/", worktreeName: "x" });
  assert.equal(p.base, "D:/DPF-worktrees");
});

test("returns null when the name is empty or the root has no parent dir", () => {
  assert.equal(planWorktree({ mainRoot: "D:/DPF", worktreeName: "" }), null);
  assert.equal(planWorktree({ mainRoot: "D:/DPF", worktreeName: "../.." }), null);
  assert.equal(planWorktree({ mainRoot: "noslash", worktreeName: "x" }), null);
  assert.equal(planWorktree({ mainRoot: "", worktreeName: "x" }), null);
});

// ── safeWorktreeName: single safe segment + branch ────────────────────────────

test("safeWorktreeName collapses path separators and strips traversal", () => {
  assert.equal(safeWorktreeName("feat/foo"), "feat-foo");
  assert.equal(safeWorktreeName("a/../b"), "a-b");
  assert.equal(safeWorktreeName("..\\..\\evil"), "evil");
  assert.equal(safeWorktreeName("/abs/path"), "abs-path");
});

test("safeWorktreeName keeps safe chars and trims edge dashes", () => {
  assert.equal(safeWorktreeName("good_name.1"), "good_name.1");
  assert.equal(safeWorktreeName("we!rd@chars"), "we-rd-chars");
  assert.equal(safeWorktreeName("--x--"), "x");
  assert.equal(safeWorktreeName(""), "");
  assert.equal(safeWorktreeName(null), "");
});
