import { describe, expect, it, vi } from "vitest";

import { getRecentOverrideCount } from "./override-count";

// BI-ACF0D6D4 — `overridePenalty` is meant to mean "the owner keeps overruling
// this profile here, so trust it less". It counted every EscalationCapture,
// i.e. every time a human ANSWERED an escalation, so agreement was penalised
// exactly as hard as disagreement.
//
// Measured live on DEPLOYED_SHA f35f608e5: clearing a 13-item review queue
// produced 9 captures, driving the penalty to its 0.3 cap and subtracting
// enough confidence (0.9 - 0.1 - 0.3 = 0.50, under the 0.55 threshold) to force
// the NEXT decision to escalate. Answering the queue is what kept it full.
describe("override penalty counts overrules, not answers (BI-ACF0D6D4)", () => {
  type Capture = { recommendedOptionId: string | null; chosenOptionId: string | null };

  /**
   * Fake client that honours the same narrowing the real query asks for, so the
   * test exercises the production filter rather than a copy of it.
   */
  function db(captures: Capture[]) {
    return {
      escalationCapture: {
        findMany: vi.fn(async (args: { where?: { interaction?: { recommendedOptionId?: unknown } } }) => {
          const requiresRecommendation = args?.where?.interaction?.recommendedOptionId !== undefined;
          return captures
            .filter((c) => (requiresRecommendation ? c.recommendedOptionId !== null : true))
            .map((interaction) => ({ interaction }));
        }),
      },
    };
  }

  const args = (captures: Capture[]) => ({
    db: db(captures),
    profileId: "org-1",
    domainClass: "risk-assessment" as const,
    now: new Date("2026-08-16T00:00:00.000Z"),
  });

  it("does not count an answer that AGREED with the recommendation", async () => {
    expect(await getRecentOverrideCount(args([{ recommendedOptionId: "a", chosenOptionId: "a" }]))).toBe(0);
  });

  it("counts an answer that chose differently", async () => {
    expect(await getRecentOverrideCount(args([{ recommendedOptionId: "a", chosenOptionId: "b" }]))).toBe(1);
  });

  // The live shape: a plain escalation carries no recommendation, so answering
  // it overrules nothing. This is the case that drove the penalty to its cap.
  it("does not count answers to escalations that made no recommendation", async () => {
    expect(await getRecentOverrideCount(args([
      { recommendedOptionId: null, chosenOptionId: "a" },
      { recommendedOptionId: null, chosenOptionId: null },
      { recommendedOptionId: null, chosenOptionId: "b" },
    ]))).toBe(0);
  });

  // Absence of evidence is not evidence of disagreement — guessing here would
  // reintroduce the same false signal in a quieter form.
  it("does not count an answer with no structured option chosen", async () => {
    expect(await getRecentOverrideCount(args([{ recommendedOptionId: "a", chosenOptionId: null }]))).toBe(0);
  });

  it("counts only the genuine overrules in a mixed set", async () => {
    expect(await getRecentOverrideCount(args([
      { recommendedOptionId: "a", chosenOptionId: "a" },
      { recommendedOptionId: "a", chosenOptionId: "b" },
      { recommendedOptionId: null, chosenOptionId: "c" },
      { recommendedOptionId: "x", chosenOptionId: null },
      { recommendedOptionId: "y", chosenOptionId: "z" },
    ]))).toBe(2);
  });

  it("narrows in SQL before filtering in memory", async () => {
    const client = db([{ recommendedOptionId: "a", chosenOptionId: "b" }]);
    await getRecentOverrideCount({ ...args([]), db: client });
    const where = (client.escalationCapture.findMany.mock.calls[0]![0] as {
      where: {
        domainClass: string;
        createdAt: { gte: Date };
        interaction: { profileId: string; recommendedOptionId: unknown };
      };
    }).where;
    expect(where.domainClass).toBe("risk-assessment");
    expect(where.interaction.profileId).toBe("org-1");
    expect(where.interaction.recommendedOptionId).toEqual({ not: null });
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("fails closed to zero when captures cannot be read", async () => {
    expect(await getRecentOverrideCount({ ...args([]), db: {} })).toBe(0);
  });
});
