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

  it("live session KEEPS a merged+clean worktree that would otherwise be Tier-A", () => {
    // The safety fix: a live session heartbeat outranks Tier-A eligibility, so
    // the janitor never reaps a worktree out from under an active session.
    const r = classifyWorktree({ ...base, merged: true, dirty: false, hasLiveSession: true });
    assert.equal(r.verdict, "KEEP");
    assert.equal(r.tier, null);
    assert.match(r.reason, /live session/);
  });

  it("abandoned mid-merge (no live session) is FLAGGED, never reaped", () => {
    const r = classifyWorktree({ ...base, midMerge: true, hasLiveSession: false });
    assert.equal(r.verdict, "FLAG_ABANDONED_MERGE");
    assert.equal(r.tier, null);
    assert.equal(isLiveReapEligible("all", r.verdict), false);
    assert.equal(isLiveReapEligible("tier-a-only", r.verdict), false);
  });

  it("a live session's in-progress merge is KEPT, not flagged as abandoned", () => {
    const r = classifyWorktree({ ...base, midMerge: true, hasLiveSession: true });
    assert.equal(r.verdict, "KEEP");
    assert.match(r.reason, /live session/);
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
      { path: "/d", branch: "d", verdict: "FLAG_ABANDONED_MERGE", reason: "", tier: null },
    ]);
    assert.equal(s.counts.PRUNE_TIER_A, 1);
    assert.equal(s.counts.PRUNE_TIER_B, 1);
    assert.equal(s.counts.FLAG_ABANDONED_MERGE, 1);
    assert.deepEqual(s.tierAPaths, ["/a"]);
    assert.deepEqual(s.tierBPaths, ["/b"]);
    assert.deepEqual(s.flaggedPaths, ["/d"]);
  });
});

// 2026-09-02: 132 worktrees classified reapable, 24 of them owned by active
// Workrooms, because the only liveness signal was a Claude Code heartbeat that
// Codex/Grok/Build Studio never write. These pin the platform-owned gate.
describe("Workroom claims outrank a merged, clean tree", () => {
  const merged = (extra) => ({
    branch: "fix/topic",
    isRoot: false,
    pinned: false,
    hasActiveLease: false,
    hasOpenPr: false,
    merged: true,
    dirty: false,
    ageDays: 30,
    hasLiveSession: false,
    midMerge: false,
    ...extra,
  });

  it("KEEPS a merged clean worktree that an active Workroom claims", () => {
    // The exact case that was lost: merged, clean, no heartbeat because the
    // session was Codex — but the platform knew it was owned.
    const v = classifyWorktree(merged({ hasActiveClaim: true }));
    assert.equal(v.verdict, "KEEP");
    assert.match(v.reason, /active Workroom/);
  });

  it("KEEPS everything when the claim record cannot be read", () => {
    // Fail safe: no token, portal down, MCP error. "Nobody is working" is a
    // guess, and it is the guess that cost 24 worktrees.
    const v = classifyWorktree(merged({ claimSourceUnavailable: true, claimSourceReason: "no token" }));
    assert.equal(v.verdict, "KEEP");
    assert.match(v.reason, /refusing to reap on absent evidence/);
  });

  it("still reaps a merged clean worktree nobody claims", () => {
    // The gate must not seize up entirely — an unclaimed, merged, clean tree is
    // still the safe case the reaper exists for.
    const v = classifyWorktree(merged({ hasActiveClaim: false, claimSourceUnavailable: false }));
    assert.equal(v.verdict, "PRUNE_TIER_A");
  });

  it("prefers the claim over the heartbeat's absence, not the reverse", () => {
    const v = classifyWorktree(merged({ hasActiveClaim: true, hasLiveSession: false }));
    assert.equal(v.verdict, "KEEP");
  });
});
