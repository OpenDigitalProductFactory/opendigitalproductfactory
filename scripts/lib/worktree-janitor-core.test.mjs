import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyWorktree,
  isLiveReapEligible,
  summarizeDecisions,
} from "./worktree-janitor-core.mjs";

const base = {
  path: "D:/DPF-worktrees/topic",
  branch: "feat/topic",
  isRoot: false,
  pinned: false,
  hasActiveLease: false,
  hasOpenPr: false,
  merged: false,
  dirty: false,
  ageDays: 2,
};

describe("classifyWorktree", () => {
  it("skips root and detached and main", () => {
    assert.equal(classifyWorktree({ ...base, isRoot: true }).verdict, "SKIP");
    assert.equal(classifyWorktree({ ...base, branch: null }).verdict, "SKIP");
    assert.equal(classifyWorktree({ ...base, branch: "main" }).verdict, "SKIP");
  });

  it("pins and keeps open PR / lease / dirty merged", () => {
    assert.equal(classifyWorktree({ ...base, pinned: true }).verdict, "PINNED");
    assert.equal(classifyWorktree({ ...base, hasOpenPr: true }).verdict, "KEEP");
    assert.equal(classifyWorktree({ ...base, hasActiveLease: true }).verdict, "KEEP");
    assert.equal(
      classifyWorktree({ ...base, merged: true, dirty: true }).verdict,
      "KEEP",
    );
  });

  it("Tier A: merged clean no PR/lease", () => {
    const r = classifyWorktree({ ...base, merged: true, dirty: false });
    assert.equal(r.verdict, "PRUNE_TIER_A");
    assert.equal(r.tier, "A");
  });

  it("Tier B: stale unmerged clean", () => {
    const r = classifyWorktree({ ...base, ageDays: 20 }, { graceDays: 14 });
    assert.equal(r.verdict, "PRUNE_TIER_B");
    assert.equal(r.tier, "B");
  });

  it("keeps young unmerged", () => {
    const r = classifyWorktree({ ...base, ageDays: 3 }, { graceDays: 14 });
    assert.equal(r.verdict, "KEEP");
  });
});

describe("isLiveReapEligible", () => {
  it("tier-a-only never reaps Tier B", () => {
    assert.equal(isLiveReapEligible("tier-a-only", "PRUNE_TIER_A"), true);
    assert.equal(isLiveReapEligible("tier-a-only", "PRUNE_TIER_B"), false);
    assert.equal(isLiveReapEligible("all", "PRUNE_TIER_B"), true);
  });
});

describe("summarizeDecisions", () => {
  it("counts and lists paths", () => {
    const s = summarizeDecisions([
      { path: "/a", branch: "a", verdict: "PRUNE_TIER_A", reason: "", tier: "A" },
      { path: "/b", branch: "b", verdict: "PRUNE_TIER_B", reason: "", tier: "B" },
      { path: "/c", branch: "c", verdict: "KEEP", reason: "", tier: null },
    ]);
    assert.equal(s.counts.PRUNE_TIER_A, 1);
    assert.equal(s.counts.PRUNE_TIER_B, 1);
    assert.deepEqual(s.tierAPaths, ["/a"]);
    assert.deepEqual(s.tierBPaths, ["/b"]);
  });
});
