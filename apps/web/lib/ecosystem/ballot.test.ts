import { describe, expect, it } from "vitest";

import { assembleBallot, type BallotCandidate } from "./ballot";
import { classifyBallotItem, mayAppearOnBallot } from "./ballot-applicability";

const consented = { permitted: true, audiences: ["community"] };

const candidate = (overrides: Partial<BallotCandidate> = {}): BallotCandidate => ({
  ref: "BI-1",
  title: "Dispatch board loses the second appointment",
  summary: "Booking two jobs in one slot drops the later one.",
  submitter: "inst_peer",
  audience: "community",
  forwarding: consented,
  archetypeRefs: ["scope:archetype-category", "category:trades-maintenance"],
  ...overrides,
});

const viewer = {
  installationId: "inst_me",
  audience: "community",
  profile: { archetypeCategories: ["trades-maintenance"], archetypeIds: [] },
};

describe("classifyBallotItem", () => {
  it("treats platform-scoped work as applying to every install", () => {
    const result = classifyBallotItem({ archetypeRefs: ["scope:platform"] }, {
      archetypeCategories: ["hospitality"], archetypeIds: [],
    });
    expect(result.scope).toBe("applies");
    expect(result.reason).toContain("every installation");
  });

  it("applies on a category match and says which", () => {
    expect(classifyBallotItem({ archetypeRefs: ["category:logistics"] }, {
      archetypeCategories: ["logistics"], archetypeIds: [],
    })).toMatchObject({ scope: "applies", reason: expect.stringContaining("logistics") });
  });

  it("applies on a specific archetype match", () => {
    expect(classifyBallotItem({ archetypeRefs: ["archetype:cold-storage"] }, {
      archetypeCategories: [], archetypeIds: ["cold-storage"],
    }).scope).toBe("applies");
  });

  it("is reference — definitively out of scope — only when BOTH sides declared and they disagree", () => {
    const result = classifyBallotItem({ archetypeRefs: ["category:logistics"] }, {
      archetypeCategories: ["hospitality"], archetypeIds: [],
    });
    expect(result.scope).toBe("reference");
    expect(result.reason).toContain("logistics");
  });

  it("is review when the SUBMISSION declared no scope, never reference", () => {
    // "We cannot tell" must not be silently downgraded to "not yours".
    expect(classifyBallotItem({ archetypeRefs: [] }, {
      archetypeCategories: ["logistics"], archetypeIds: [],
    }).scope).toBe("review");
  });

  it("is review when the RECEIVER declared no archetype", () => {
    // Hiding an item because this install forgot to declare its archetype
    // would silence a submission for the wrong reason.
    expect(classifyBallotItem({ archetypeRefs: ["category:logistics"] }, {
      archetypeCategories: [], archetypeIds: [],
    }).scope).toBe("review");
  });
});

describe("mayAppearOnBallot", () => {
  it("refuses when no forwarding consent was granted — absence means forbidden", () => {
    expect(mayAppearOnBallot({ audience: "community" }, { audience: "community" }).permitted).toBe(false);
    expect(mayAppearOnBallot({ audience: "community", forwarding: null }, { audience: "community" }).permitted).toBe(false);
  });

  it("refuses when consent does not cover the reader's audience", () => {
    const decision = mayAppearOnBallot(
      { audience: "partner", forwarding: { permitted: true, audiences: ["founder"] } },
      { audience: "community" },
    );
    expect(decision.permitted).toBe(false);
    expect(decision.reason).toContain("community");
  });

  it("refuses expired consent", () => {
    expect(mayAppearOnBallot(
      { audience: "community", forwarding: { ...consented, expiresAt: "2026-01-01T00:00:00Z" } },
      { audience: "community", now: new Date("2026-09-16T00:00:00Z") },
    ).permitted).toBe(false);
  });

  it("permits consent that covers the audience and has not expired", () => {
    expect(mayAppearOnBallot(
      { audience: "community", forwarding: { ...consented, expiresAt: "2027-01-01T00:00:00Z" } },
      { audience: "community", now: new Date("2026-09-16T00:00:00Z") },
    ).permitted).toBe(true);
  });
});

describe("assembleBallot", () => {
  it("puts this install's own submissions in their own tier, whatever the verdict", () => {
    const ballot = assembleBallot({
      candidates: [candidate({ submitter: "inst_me", archetypeRefs: ["category:hospitality"] })],
      viewer,
    });
    expect(ballot.yours).toHaveLength(1);
    expect(ballot.applies).toHaveLength(0);
  });

  it("shows an install its own submission even with no forwarding consent", () => {
    // An install may always see what it itself submitted.
    const ballot = assembleBallot({
      candidates: [candidate({ submitter: "inst_me", forwarding: null })],
      viewer,
    });
    expect(ballot.yours).toHaveLength(1);
    expect(ballot.withheld.noConsent).toBe(0);
  });

  it("applies the consent gate BEFORE relevance, so an unreleased item never surfaces", () => {
    // Relevant AND unconsented must be withheld — the leak this ordering prevents.
    const ballot = assembleBallot({
      candidates: [candidate({ forwarding: null })],
      viewer,
    });
    expect(ballot.applies).toHaveLength(0);
    expect(ballot.withheld).toEqual({ notRelevant: 0, noConsent: 1 });
  });

  it("separates relevant from possibly-relevant and withholds the irrelevant by count only", () => {
    const ballot = assembleBallot({
      candidates: [
        candidate({ ref: "BI-applies" }),
        candidate({ ref: "BI-review", archetypeRefs: [] }),
        candidate({ ref: "BI-reference", archetypeRefs: ["category:hospitality"] }),
      ],
      viewer,
    });
    expect(ballot.applies.map((e) => e.ref)).toEqual(["BI-applies"]);
    expect(ballot.mightApply.map((e) => e.ref)).toEqual(["BI-review"]);
    expect(ballot.withheld.notRelevant).toBe(1);
    // The withheld item's content never appears anywhere in the ballot.
    expect(JSON.stringify(ballot)).not.toContain("BI-reference");
  });

  it("carries the reason with every entry so a voter can judge the classification", () => {
    const ballot = assembleBallot({ candidates: [candidate()], viewer });
    expect(ballot.applies[0].applicability.reason).toContain("trades-maintenance");
  });

  it("orders by the score the demand engine already computed, then by breadth", () => {
    const ballot = assembleBallot({
      candidates: [
        candidate({ ref: "low", score: 1 }),
        candidate({ ref: "high", score: 9 }),
        candidate({ ref: "mid-wide", score: 5, affectedOrganizations: 9 }),
        candidate({ ref: "mid-narrow", score: 5, affectedOrganizations: 1 }),
      ],
      viewer,
    });
    expect(ballot.applies.map((e) => e.ref)).toEqual(["high", "mid-wide", "mid-narrow", "low"]);
  });

  it("sorts an unscored item last rather than treating it as a zero", () => {
    // "Not scored" is not "scored zero"; a fabricated zero would outrank
    // genuinely low-scored work.
    const ballot = assembleBallot({
      candidates: [candidate({ ref: "unscored", score: null }), candidate({ ref: "scored", score: -5 })],
      viewer,
    });
    expect(ballot.applies.map((e) => e.ref)).toEqual(["scored", "unscored"]);
  });

  it("returns an empty ballot rather than failing when nothing is inbound", () => {
    expect(assembleBallot({ candidates: [], viewer })).toEqual({
      yours: [], applies: [], mightApply: [], withheld: { notRelevant: 0, noConsent: 0 },
    });
  });
});
