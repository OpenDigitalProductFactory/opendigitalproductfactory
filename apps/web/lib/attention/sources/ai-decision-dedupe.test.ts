import { describe, expect, it, vi } from "vitest";

// The loader references Prisma.DbNull to express "humanOutcome IS NULL"; the
// generated client is not available in a unit context, so stub just that.
vi.mock("@dpf/db", () => ({ Prisma: { DbNull: Symbol("DbNull") } }));

import { dedupeDecisionRows, loadAiDecisionItems } from "./ai-decision";

/**
 * BI-13C38318. Measured on the customer 0 install: 39 of 53 unresolved
 * founder-actionable decisions were the SAME question ("run hive scout
 * ingest: "), left pending by a routing defect fixed on 2026-09-09. The
 * founder-review queue had always collapsed them to one card; this source read
 * the same rows and rendered 39, so roughly three quarters of the owner's
 * attention list was one obsolete question.
 */

function row(over: Partial<{ question: string; gateKey: string; interactionId: string }> = {}) {
  return {
    interactionId: over.interactionId ?? "DI-1",
    question: over.question ?? "run hive scout ingest: ",
    outcomeType: "escalate",
    riskTier: "medium",
    principleConflict: false,
    rationale: "Constitutional alignment could not be established.",
    buildId: null,
    taskRunId: null,
    routeContext: "/platform/ai/operations",
    domainClass: "plan-readiness",
    gateKey: over.gateKey ?? "org-business",
    createdAt: new Date("2026-09-09T00:00:00Z"),
    resolutionProposals: [],
  };
}

describe("attention decision dedupe", () => {
  it("collapses rows asking the same question of the same gate", () => {
    const rows = Array.from({ length: 39 }, (_, i) => row({ interactionId: `DI-${i}` }));
    const collapsed = dedupeDecisionRows(rows);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.occurrences).toBe(39);
  });

  it("keeps the first row of a group, so newest-first ordering picks the newest", () => {
    const collapsed = dedupeDecisionRows([
      row({ interactionId: "DI-new" }),
      row({ interactionId: "DI-old" }),
    ]);
    expect(collapsed[0]!.row.interactionId).toBe("DI-new");
  });

  it("normalises whitespace and case, matching the founder-review queue", () => {
    const collapsed = dedupeDecisionRows([
      row({ question: "Run Hive  Scout Ingest: " }),
      row({ question: "run hive scout ingest:" }),
    ]);
    expect(collapsed).toHaveLength(1);
  });

  it("does not merge the same question asked of different gates", () => {
    expect(
      dedupeDecisionRows([row({ gateKey: "org-business" }), row({ gateKey: "build-studio" })]),
    ).toHaveLength(2);
  });

  it("keeps genuinely different questions apart", () => {
    expect(
      dedupeDecisionRows([row({ question: "fund the workroom owner?" }), row()]),
    ).toHaveLength(2);
  });

  it("surfaces a genuine decision that sits below a flood of duplicates", async () => {
    // The starvation case: with a render-limited SQL read, the real decision
    // ranked below 50 identical rows was never loaded at all.
    const duplicates = Array.from({ length: 120 }, (_, i) => row({ interactionId: `DI-dup-${i}` }));
    const genuine = row({
      interactionId: "DI-real",
      question: "Should we create qualification tasks for the two partner prospects?",
    });
    const db = {
      decisionInteraction: { findMany: async () => [...duplicates, genuine] },
    } as never;

    const items = await loadAiDecisionItems(db);

    expect(items.map((i) => i.id)).toContain("ai-decision:DI-real");
    expect(items).toHaveLength(2);
    const flooded = items.find((i) => i.id === "ai-decision:DI-dup-0");
    expect(flooded!.context).toContain("Asked 120 times");
  });

  it("filters non-actionable rows before collapsing, so one cannot represent a group", async () => {
    const db = {
      decisionInteraction: {
        findMany: async () => [
          { ...row({ interactionId: "DI-advisory" }), gateKey: "profession" },
          row({ interactionId: "DI-actionable" }),
        ],
      },
    } as never;

    const items = await loadAiDecisionItems(db);
    expect(items.map((i) => i.id)).toEqual(["ai-decision:DI-actionable"]);
  });
});
