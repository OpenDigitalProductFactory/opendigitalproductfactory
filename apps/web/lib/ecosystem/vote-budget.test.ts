import { describe, expect, it } from "vitest";

import {
  castVote,
  creditCost,
  creditsRemaining,
  DEFAULT_CYCLE_CREDITS,
  isoWeekStart,
  ledgerFromOutboundVotes,
  tallyVotes,
  voteScoreUpdate,
  toScoreInputs,
  withdrawVote,
  type VoteLedger,
} from "./vote-budget";

const ledger = (votes: VoteLedger["votes"] = []): VoteLedger => ({
  installationId: "inst_me",
  cycle: "2026-W38",
  creditsBudget: DEFAULT_CYCLE_CREDITS,
  votes,
});

describe("creditCost", () => {
  it("is quadratic — the whole anti-capture property", () => {
    expect([1, 2, 3, 4].map(creditCost)).toEqual([1, 4, 9, 16]);
  });

  it("makes concentrating on one item cost far more than spreading", () => {
    // One item at weight 4 consumes an entire default budget; four items at
    // weight 1 each cost 4 in total. That asymmetry IS the mechanism.
    expect(creditCost(4)).toBe(DEFAULT_CYCLE_CREDITS);
    expect(creditCost(1) * 4).toBeLessThan(creditCost(4));
  });
});

describe("castVote", () => {
  it("refuses a weight outside the allowed range instead of clamping it", () => {
    expect(castVote(ledger(), { ref: "a", weight: 0 })).toMatchObject({ accepted: false, reason: "invalid-weight" });
    expect(castVote(ledger(), { ref: "a", weight: 5 })).toMatchObject({ accepted: false, reason: "invalid-weight" });
    expect(castVote(ledger(), { ref: "a", weight: 1.5 })).toMatchObject({ accepted: false, reason: "invalid-weight" });
  });

  it("REFUSES an unaffordable vote rather than silently dropping it", () => {
    // A voter who believes they voted, and did not, is worse off than one who
    // was told no.
    const spent = ledger([{ ref: "a", weight: 3 }]); // 9 of 16
    const result = castVote(spent, { ref: "b", weight: 3 }); // would be 18
    expect(result).toMatchObject({ accepted: false, reason: "budget-exhausted", creditsRemaining: 7 });
    expect(result.accepted === false && result.message).toContain("7 remain");
  });

  it("re-weighting replaces the prior vote rather than stacking on it", () => {
    const first = castVote(ledger(), { ref: "a", weight: 4 });
    expect(first.accepted).toBe(true);
    const second = first.accepted ? castVote(first.ledger, { ref: "a", weight: 1 }) : null;
    expect(second).toMatchObject({ accepted: true, creditsRemaining: 15 });
    expect(second && second.accepted && second.ledger.votes).toEqual([{ ref: "a", weight: 1 }]);
  });

  it("spends exactly the budget without refusing the last affordable vote", () => {
    const result = castVote(ledger(), { ref: "a", weight: 4 });
    expect(result).toMatchObject({ accepted: true, creditsRemaining: 0 });
  });

  it("returns credits when a vote is withdrawn", () => {
    const spent = ledger([{ ref: "a", weight: 3 }]);
    expect(creditsRemaining(withdrawVote(spent, "a"))).toBe(DEFAULT_CYCLE_CREDITS);
  });
});

describe("tallyVotes", () => {
  it("counts distinct installations, so one noisy voter cannot outrank many quiet ones", () => {
    const tally = tallyVotes([
      { ref: "a", installationId: "i1", weight: 1 },
      { ref: "a", installationId: "i1", weight: 3 }, // a re-weight, not a second voice
      { ref: "a", installationId: "i2", weight: 1 },
    ]);
    expect(tally).toEqual([{ ref: "a", distinctInstallations: 2, totalWeight: 4 }]);
  });

  it("keeps each item separate and orders deterministically", () => {
    const tally = tallyVotes([
      { ref: "b", installationId: "i1", weight: 2 },
      { ref: "a", installationId: "i1", weight: 1 },
    ]);
    expect(tally.map((t) => t.ref)).toEqual(["a", "b"]);
  });

  it("ignores a malformed weight rather than counting it as a voter", () => {
    expect(tallyVotes([{ ref: "a", installationId: "i1", weight: 0 }])).toEqual([]);
  });
});

describe("toScoreInputs", () => {
  it("maps breadth to reach and mean intensity onto the RICE impact ladder", () => {
    expect(toScoreInputs({ ref: "a", distinctInstallations: 4, totalWeight: 8 }))
      .toEqual({ reach: 4, impact: 2 });
  });

  it("never produces an impact off the ladder the platform scores on", () => {
    for (const totalWeight of [4, 6, 9, 12, 16]) {
      expect([1, 2, 3]).toContain(toScoreInputs({ ref: "a", distinctInstallations: 4, totalWeight }).impact);
    }
  });

  it("does not let breadth be double-counted into impact", () => {
    // Breadth is already carried by reach. If impact summed the weights, a
    // broadly-but-mildly wanted item would bury a narrowly-but-urgently needed one.
    const broadMild = toScoreInputs({ ref: "a", distinctInstallations: 10, totalWeight: 10 });
    const narrowUrgent = toScoreInputs({ ref: "b", distinctInstallations: 1, totalWeight: 4 });
    expect(broadMild.impact).toBe(1);
    expect(narrowUrgent.impact).toBe(3);
  });

  it("returns zero impact for an untallied item rather than dividing by zero", () => {
    expect(toScoreInputs({ ref: "a", distinctInstallations: 0, totalWeight: 0 }).impact).toBe(0);
  });
});

describe("ledgerFromOutboundVotes (BI-626A4ECA)", () => {
  const monday = new Date("2026-11-16T09:00:00Z");

  it("counts only this ISO week's votes against the budget", () => {
    const ledger = ledgerFromOutboundVotes("inst_me", [
      { ref: "a", weight: 3, createdAt: new Date("2026-11-16T08:00:00Z") },
      { ref: "b", weight: 4, createdAt: new Date("2026-11-15T23:59:00Z") }, // last week: free again
    ], monday);
    expect(ledger.votes).toEqual([{ ref: "a", weight: 3 }]);
    expect(creditsRemaining(ledger)).toBe(DEFAULT_CYCLE_CREDITS - 9);
  });

  it("feeds castVote so an unaffordable vote is refused with its cost", () => {
    const ledger = ledgerFromOutboundVotes("inst_me", [
      { ref: "a", weight: 3, createdAt: monday },
      { ref: "b", weight: 2, createdAt: monday },
    ], monday); // 9 + 4 = 13 spent, 3 left
    expect(castVote(ledger, { ref: "c", weight: 2 })).toMatchObject({
      accepted: false, reason: "budget-exhausted", creditsRemaining: 3,
    });
    expect(castVote(ledger, { ref: "c", weight: 1 })).toMatchObject({ accepted: true });
  });
});

describe("voteScoreUpdate (BI-626A4ECA)", () => {
  const tally = { ref: "BI-1", distinctInstallations: 3, totalWeight: 9 };

  it("never touches inputs a person entered or confirmed", () => {
    expect(voteScoreUpdate({ occurrenceCount: 1, reach: 2, demandInputSource: "human" }, tally)).toBeNull();
    expect(voteScoreUpdate({ occurrenceCount: 1, reach: 2, demandInputSource: "agreed" }, tally)).toBeNull();
  });

  it("counts the voters plus the installation that raised it", () => {
    expect(voteScoreUpdate({ occurrenceCount: 1, reach: null, demandInputSource: null }, tally))
      .toEqual({ reach: 4, impact: 3 });
  });

  it("never lowers reach — a vote adds breadth, it cannot take it away", () => {
    expect(voteScoreUpdate({ occurrenceCount: 12, reach: 7, demandInputSource: "ai" }, tally)?.reach).toBe(12);
  });

  it("does nothing with no voters", () => {
    expect(voteScoreUpdate({ occurrenceCount: 1, reach: null, demandInputSource: null },
      { ref: "BI-1", distinctInstallations: 0, totalWeight: 0 })).toBeNull();
  });
});

describe("isoWeekStart", () => {
  it("starts the week on Monday 00:00 UTC", () => {
    expect(isoWeekStart(new Date("2026-11-19T13:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(isoWeekStart(new Date("2026-11-22T23:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });
});
