import { describe, expect, it } from "vitest";

import {
  castVote,
  creditCost,
  creditsRemaining,
  DEFAULT_CYCLE_CREDITS,
  tallyVotes,
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
    expect(castVote(ledger(), { ref: "a", weight: 0 })).toMatchObject({ ok: false, reason: "invalid-weight" });
    expect(castVote(ledger(), { ref: "a", weight: 5 })).toMatchObject({ ok: false, reason: "invalid-weight" });
    expect(castVote(ledger(), { ref: "a", weight: 1.5 })).toMatchObject({ ok: false, reason: "invalid-weight" });
  });

  it("REFUSES an unaffordable vote rather than silently dropping it", () => {
    // A voter who believes they voted, and did not, is worse off than one who
    // was told no.
    const spent = ledger([{ ref: "a", weight: 3 }]); // 9 of 16
    const result = castVote(spent, { ref: "b", weight: 3 }); // would be 18
    expect(result).toMatchObject({ ok: false, reason: "budget-exhausted", creditsRemaining: 7 });
    expect(result.ok === false && result.message).toContain("7 remain");
  });

  it("re-weighting replaces the prior vote rather than stacking on it", () => {
    const first = castVote(ledger(), { ref: "a", weight: 4 });
    expect(first.ok).toBe(true);
    const second = first.ok ? castVote(first.ledger, { ref: "a", weight: 1 }) : null;
    expect(second).toMatchObject({ ok: true, creditsRemaining: 15 });
    expect(second && second.ok && second.ledger.votes).toEqual([{ ref: "a", weight: 1 }]);
  });

  it("spends exactly the budget without refusing the last affordable vote", () => {
    const result = castVote(ledger(), { ref: "a", weight: 4 });
    expect(result).toMatchObject({ ok: true, creditsRemaining: 0 });
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
  it("maps breadth to reach and mean intensity to impact", () => {
    expect(toScoreInputs({ ref: "a", distinctInstallations: 4, totalWeight: 8 }))
      .toEqual({ reach: 4, impact: 2 });
  });

  it("does not let breadth be double-counted into impact", () => {
    // Breadth is already carried by reach. If impact summed the weights, a
    // broadly-but-mildly wanted item would bury a narrowly-but-urgently needed one.
    const broadMild = toScoreInputs({ ref: "a", distinctInstallations: 10, totalWeight: 10 });
    const narrowUrgent = toScoreInputs({ ref: "b", distinctInstallations: 1, totalWeight: 4 });
    expect(broadMild.impact).toBe(1);
    expect(narrowUrgent.impact).toBe(4);
  });

  it("returns zero impact for an untallied item rather than dividing by zero", () => {
    expect(toScoreInputs({ ref: "a", distinctInstallations: 0, totalWeight: 0 }).impact).toBe(0);
  });
});
