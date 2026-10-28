import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyBranches, stashCensus, summarizeBranchDecisions } from "./branch-reaper-core.mjs";

const base = {
  branches: [],
  worktreeBranches: new Set(),
  currentBranch: "main",
  ancestorMerged: new Set(),
  mergedPrHeads: new Map(),
  openPrBranches: new Set(),
  liveRoomBranches: new Set(),
  ownershipAvailable: true,
  pinned: new Set(),
};
const b = (name, tip = `${name}-tip`) => ({ name, tip });

describe("classifyBranches (BI-88D75BA3)", () => {
  it("reaps exactly the merged branches nobody is using", () => {
    const decisions = classifyBranches({
      ...base,
      branches: [b("main"), b("release/2026.10"), b("feat/merged"), b("feat/squashed", "s1"), b("feat/squash-moved", "s2"),
        b("feat/in-tree"), b("feat/open-pr"), b("feat/held"), b("feat/pinned"), b("feat/unmerged")],
      worktreeBranches: new Set(["feat/in-tree"]),
      ancestorMerged: new Set(["feat/merged", "feat/in-tree", "feat/open-pr", "feat/held", "feat/pinned"]),
      mergedPrHeads: new Map([["feat/squashed", new Set(["s1"])], ["feat/squash-moved", new Set(["s1"])]]),
      openPrBranches: new Set(["feat/open-pr"]),
      liveRoomBranches: new Set(["feat/held"]),
      pinned: new Set(["feat/pinned"]),
    });
    const by = Object.fromEntries(decisions.map((d) => [d.name, `${d.action}:${d.reason}`]));
    assert.deepEqual(by, {
      "main": "keep:current",
      "release/2026.10": "keep:protected",
      "feat/merged": "reap:merged-into-main",
      "feat/squashed": "reap:squash-merged",
      // New commits after the squash: not on main, so kept.
      "feat/squash-moved": "keep:unmerged",
      "feat/in-tree": "keep:has-worktree",
      "feat/open-pr": "keep:open-pr",
      "feat/held": "keep:live-workroom",
      "feat/pinned": "keep:pinned",
      "feat/unmerged": "keep:unmerged",
    });
    assert.deepEqual(summarizeBranchDecisions(decisions).reap, 2);
  });

  it("reaps nothing when Workroom ownership could not be read", () => {
    const decisions = classifyBranches({ ...base, branches: [b("feat/merged")], ancestorMerged: new Set(["feat/merged"]), ownershipAvailable: false });
    assert.deepEqual(decisions.map((d) => d.reason), ["ownership-unreadable"]);
  });
});

describe("stashCensus", () => {
  it("counts entries and ages without touching them", () => {
    const now = new Date("2026-10-28T00:00:00Z");
    const day = 86_400;
    const at = (daysAgo) => Math.floor(now.getTime() / 1000) - daysAgo * day;
    const listing = [`stash@{0}\t${at(1)}`, `stash@{1}\t${at(10)}`, `stash@{2}\t${at(45)}`, "garbage"].join("\n");
    assert.deepEqual(stashCensus(listing, now), { count: 3, olderThan7Days: 2, olderThan30Days: 1, oldestDays: 45 });
    assert.deepEqual(stashCensus("", now), { count: 0, olderThan7Days: 0, olderThan30Days: 0, oldestDays: null });
  });
});
