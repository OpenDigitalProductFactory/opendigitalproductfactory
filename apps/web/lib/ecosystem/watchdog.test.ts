import { describe, expect, it, vi } from "vitest";

import { buildWatchdogDigest, isClosure, type WatchdogInput } from "./watchdog";
import { renderWatchdogMessage, runEcosystemWatchdog } from "./watchdog-runner";
import type { BallotCandidate } from "./ballot";

const candidate = (overrides: Partial<BallotCandidate> = {}): BallotCandidate => ({
  ref: "BI-1",
  title: "Dispatch board loses the second appointment",
  summary: "Two jobs in one slot drops the later one.",
  submitter: "inst_peer",
  audience: "community",
  forwarding: { permitted: true, audiences: ["community"] },
  archetypeRefs: ["category:trades-maintenance"],
  ...overrides,
});

const base = (overrides: Partial<WatchdogInput> = {}): WatchdogInput => ({
  candidates: [candidate()],
  dispositions: [],
  releases: [],
  viewer: {
    installationId: "inst_me",
    audience: "community",
    profile: { archetypeCategories: ["trades-maintenance"], archetypeIds: [] },
  },
  level: "balanced",
  ...overrides,
});

describe("isClosure", () => {
  it("accepts a scheduled outcome, which speaks for itself", () => {
    expect(isClosure({ ref: "r", title: "t", outcome: "scheduled", reason: null })).toBe(true);
  });

  it("rejects a bare decline — a verdict with no reason is not closure", () => {
    // Ubuntu Brainstorm was retired for votes that were never answered; a bare
    // "declined" reproduces that failure while looking like a response.
    expect(isClosure({ ref: "r", title: "t", outcome: "declined", reason: null })).toBe(false);
    expect(isClosure({ ref: "r", title: "t", outcome: "deferred", reason: "  " })).toBe(false);
  });

  it("accepts a decline that says why", () => {
    expect(isClosure({ ref: "r", title: "t", outcome: "declined", reason: "superseded by X" })).toBe(true);
  });
});

describe("buildWatchdogDigest", () => {
  it("carries the ballot, scoped to this install", () => {
    const digest = buildWatchdogDigest(base());
    expect(digest.ballot.applies.map((e) => e.ref)).toEqual(["BI-1"]);
    expect(digest.empty).toBe(false);
  });

  it("flags what others submitted that also affects this install, with the reason", () => {
    const digest = buildWatchdogDigest(base());
    expect(digest.alsoAffectsYou).toEqual([
      { ref: "BI-1", title: candidate().title, reason: expect.stringContaining("trades-maintenance") },
    ]);
  });

  it("does not tell an install its own submission is coming for it", () => {
    const digest = buildWatchdogDigest(base({
      candidates: [candidate({ submitter: "inst_me" })],
    }));
    expect(digest.ballot.yours).toHaveLength(1);
    expect(digest.alsoAffectsYou).toEqual([]);
  });

  it("suppresses the speculative tier on a quiet posture", () => {
    const quiet = buildWatchdogDigest(base({
      candidates: [candidate({ ref: "maybe", archetypeRefs: [] })],
      level: "quiet",
    }));
    expect(quiet.ballot.mightApply).toEqual([]);

    const balanced = buildWatchdogDigest(base({
      candidates: [candidate({ ref: "maybe", archetypeRefs: [] })],
      level: "balanced",
    }));
    expect(balanced.ballot.mightApply).toHaveLength(1);
  });

  it("announces only releases that apply to this install", () => {
    const digest = buildWatchdogDigest(base({
      releases: [
        { releaseRef: "v2", summary: "Dispatch fix", archetypeRefs: ["category:trades-maintenance"] },
        { releaseRef: "v3", summary: "Kitchen fix", archetypeRefs: ["category:hospitality"] },
        { releaseRef: "v4", summary: "Platform fix", archetypeRefs: ["scope:platform"] },
      ],
    }));
    expect(digest.releases.map((r) => r.releaseRef)).toEqual(["v2", "v4"]);
  });

  it("withholds a disposition that gives no reason rather than showing an empty verdict", () => {
    const digest = buildWatchdogDigest(base({
      dispositions: [
        { ref: "a", title: "Answered", outcome: "declined", reason: "out of scope" },
        { ref: "b", title: "Unanswered", outcome: "declined", reason: null },
      ],
    }));
    expect(digest.dispositions.map((d) => d.ref)).toEqual(["a"]);
  });

  it("reports a quiet week as quiet rather than dressing it up", () => {
    const digest = buildWatchdogDigest(base({ candidates: [], dispositions: [], releases: [] }));
    expect(digest.empty).toBe(true);
  });
});

describe("runEcosystemWatchdog (BI-784D20FD trigger path)", () => {
  const viewer = {
    installationId: "inst_me",
    audience: "community",
    profile: { archetypeCategories: ["trades-maintenance"], archetypeIds: [] },
  };
  const relevant = () => ([{
    ref: "BI-1", title: "Dispatch board loses the second appointment",
    summary: "Drops the later job.", submitter: "inst_peer", audience: "community",
    forwarding: { permitted: true, audiences: ["community"] },
    archetypeRefs: ["category:trades-maintenance"],
  }]);

  const deps = (over: Partial<Parameters<typeof runEcosystemWatchdog>[0]> = {}) => ({
    loadViewer: async () => viewer,
    loadCandidates: async () => relevant(),
    resolveRoom: async () => "room:case-1",
    deliver: vi.fn(async () => {}),
    ...over,
  });

  it("delivers the digest to the resolved room", async () => {
    const d = deps();
    const outcome = await runEcosystemWatchdog(d);
    expect(outcome).toMatchObject({ delivered: true, roomRef: "room:case-1" });
    expect(d.deliver).toHaveBeenCalledOnce();
  });

  it("does not post on a quiet week — a weekly 'nothing' is how a coworker gets muted", async () => {
    const d = deps({ loadCandidates: async () => [] });
    expect(await runEcosystemWatchdog(d)).toMatchObject({ delivered: false, reason: "quiet-week" });
    expect(d.deliver).not.toHaveBeenCalled();
  });

  it("names the missing binding rather than silently doing nothing", async () => {
    const outcome = await runEcosystemWatchdog(deps({ resolveRoom: async () => null }));
    expect(outcome).toMatchObject({ delivered: false, reason: "no-room" });
    expect(outcome.delivered === false && outcome.message).toContain("not posted anywhere");
  });

  it("reports a failed delivery instead of counting it as delivered", async () => {
    // A digest that was built and lost is worse than one never built, because
    // the counters suggest it arrived.
    const outcome = await runEcosystemWatchdog(deps({
      deliver: async () => { throw new Error("room is archived"); },
    }));
    expect(outcome).toMatchObject({ delivered: false, reason: "delivery-failed" });
    expect(outcome.delivered === false && outcome.message).toContain("archived");
  });

  it("reports no ecosystem voice when the install has no federation identity", async () => {
    expect(await runEcosystemWatchdog(deps({ loadViewer: async () => null })))
      .toMatchObject({ delivered: false, reason: "no-room" });
  });
});

describe("renderWatchdogMessage", () => {
  it("names the tiers a reader must act on and reports what was withheld as a count", () => {
    const digest = buildWatchdogDigest(base({
      candidates: [
        candidate({ ref: "v", title: "Vote me" }),
        candidate({ ref: "hidden", title: "Not yours", archetypeRefs: ["category:hospitality"] }),
      ],
    }));
    const message = renderWatchdogMessage(digest);
    expect(message).toContain("Open for your vote");
    expect(message).toContain("Vote me");
    expect(message).not.toContain("Not yours");
    expect(message).toContain("1 not relevant to this organisation");
  });
});
