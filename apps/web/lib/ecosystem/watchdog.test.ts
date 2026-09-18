import { describe, expect, it } from "vitest";

import { buildWatchdogDigest, isClosure, type WatchdogInput } from "./watchdog";
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
