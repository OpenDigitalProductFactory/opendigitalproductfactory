// One worktree base, or none (BI-541156EE).
//
// The guard exists because seven bases were found on a single host, all
// produced by the SAME formula handed different roots. These tests pin the two
// things that make it useful: it groups by parent directory, and it does not
// count the main worktree as living in a base.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { parseWorktreePaths, groupByBase } from "./check-single-worktree-base.mjs";

const PORCELAIN = [
  "worktree D:/DPF-source-root",
  "HEAD 1111111111111111111111111111111111111111",
  "branch refs/heads/main",
  "",
  "worktree D:/DPF-worktrees/alpha",
  "HEAD 2222222222222222222222222222222222222222",
  "branch refs/heads/fix/alpha",
  "",
  "worktree D:/DPF-worktrees/beta",
  "HEAD 3333333333333333333333333333333333333333",
  "",
  "worktree D:/DPF-source-root-worktrees/gamma",
  "HEAD 4444444444444444444444444444444444444444",
  "",
].join("\n");

describe("parseWorktreePaths", () => {
  it("takes only the worktree lines, not HEAD or branch", () => {
    assert.deepEqual(parseWorktreePaths(PORCELAIN), [
      "D:/DPF-source-root",
      "D:/DPF-worktrees/alpha",
      "D:/DPF-worktrees/beta",
      "D:/DPF-source-root-worktrees/gamma",
    ]);
  });

  it("survives empty or absent input rather than throwing", () => {
    assert.deepEqual(parseWorktreePaths(""), []);
    assert.deepEqual(parseWorktreePaths(undefined), []);
  });
});

describe("groupByBase", () => {
  it("groups linked worktrees by parent and excludes the main worktree", () => {
    // The clone is not IN a base — it OWNS one. Counting it would report a
    // phantom extra base on every healthy repository.
    const { bases, mainWorktree } = groupByBase(parseWorktreePaths(PORCELAIN));
    assert.equal(mainWorktree, resolve("D:/DPF-source-root"));
    assert.equal(bases.size, 2);
    assert.equal(bases.get(resolve("D:/DPF-worktrees")).length, 2);
    assert.equal(bases.get(resolve("D:/DPF-source-root-worktrees")).length, 1);
  });

  it("reports a single base when everything is converged", () => {
    const converged = [
      "worktree D:/DPF-source-root",
      "",
      "worktree D:/DPF-source-root-worktrees/one",
      "",
      "worktree D:/DPF-source-root-worktrees/two",
      "",
    ].join("\n");
    const { bases } = groupByBase(parseWorktreePaths(converged));
    assert.equal(bases.size, 1);
  });

  it("reports no bases for a clone with no linked worktrees", () => {
    const { bases } = groupByBase(parseWorktreePaths("worktree D:/DPF-source-root\n"));
    assert.equal(bases.size, 0);
  });

  it("catches a worktree nested inside another worktree", () => {
    // Four of the seven bases found on the real host were this: a worktree
    // created while standing inside a scratch copy, so the formula produced a
    // base there. The guard must see it as a distinct base, not fold it in.
    const nested = [
      "worktree D:/DPF-source-root",
      "",
      "worktree D:/DPF-worktrees/alpha",
      "",
      "worktree D:/DPF-scratch/copy-a/nested",
      "",
    ].join("\n");
    const { bases } = groupByBase(parseWorktreePaths(nested));
    assert.equal(bases.size, 2);
    assert.ok(bases.has(resolve("D:/DPF-scratch/copy-a")));
  });
});
