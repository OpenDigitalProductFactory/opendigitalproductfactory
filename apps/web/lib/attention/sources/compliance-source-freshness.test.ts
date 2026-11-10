// BI-68D44727 — the compliance-source freshness attention projection.
//
// Every case passes an explicit `now`. This projector is about expiry dates, so
// a test that read the real clock would be the very defect it warns about.
import { describe, expect, it } from "vitest";

import { loadComplianceSourceFreshnessItems } from "./compliance-source-freshness";

const BEFORE_ANY_EXPIRY = new Date("2026-08-05T12:00:00.000Z");
const INSIDE_WARNING_WINDOW = new Date("2026-09-01T12:00:00.000Z");
const AFTER_60D_EXPIRY = new Date("2026-09-19T12:00:00.000Z");

describe("loadComplianceSourceFreshnessItems", () => {
  it("stays silent while every source is fresh", async () => {
    // A healthy source is not news. An inbox that lists fine things teaches
    // people to skim past it, which is how the real item gets missed.
    expect(await loadComplianceSourceFreshnessItems({ now: BEFORE_ANY_EXPIRY })).toEqual([]);
  });

  it("warns before anything breaks, not after", async () => {
    const items = await loadComplianceSourceFreshnessItems({ now: INSIDE_WARNING_WINDOW });
    expect(items.length).toBe(3);
    for (const item of items) {
      expect(item.source).toBe("compliance-source-freshness");
      expect(item.triage.timeToAct).toBe("due-soon");
      expect(item.riskClass).toBe("bounded-write");
      expect(item.title).toContain("expiring");
      // The lead time is the whole point — say how long they have.
      expect(item.context).toMatch(/lapses in \d+ days/);
      // Do not imply a self-service button that does not exist.
      expect(item.context).toContain("re-reading the source");
    }
  });

  it("escalates to overdue once the evidence has actually lapsed", async () => {
    const items = await loadComplianceSourceFreshnessItems({ now: AFTER_60D_EXPIRY });
    expect(items.length).toBe(3);
    for (const item of items) {
      expect(item.triage.timeToAct).toBe("overdue");
      expect(item.riskClass).toBe("high-risk");
      expect(item.title).toContain("out of date");
      // Name the user-visible consequence, not the internal failure mode.
      expect(item.context).toContain("a human needs to review this");
    }
  });

  it("routes to a person, because re-attesting vendor terms is judgement", async () => {
    const [item] = await loadComplianceSourceFreshnessItems({ now: AFTER_60D_EXPIRY });
    expect(item.triage.decideEffort).toBe("judgment");
    expect(item.triage.residueReason).toBe("no-self-heal");
    expect(item.audience?.operator).toBe(true);
  });

  it("carries the exact cited source and claims into the renewal task", async () => {
    const [item] = await loadComplianceSourceFreshnessItems({ now: AFTER_60D_EXPIRY });
    expect(item.complianceEvidence?.sourceKey).toBeTruthy();
    expect(item.complianceEvidence?.url).toMatch(/^https:\/\//);
    expect(item.complianceEvidence?.claims.length).toBeGreaterThan(0);
    expect(item.actions[0]).toMatchObject({ label: "Open cited source" });
  });

  it("clears a warning after a person confirms the cited claims", async () => {
    const db = {
      rawSource: {
        findMany: async () => [{
          sourceKey: "openai/business-data-privacy",
          retrievedAt: new Date("2026-09-19T12:00:00.000Z"),
          locator: { review: { decision: "confirmed" } },
        }],
      },
    };
    const items = await loadComplianceSourceFreshnessItems({ now: AFTER_60D_EXPIRY, db });

    expect(items.map((item) => item.id)).not.toContain(
      "compliance-source-freshness:openai/business-data-privacy",
    );
  });

  it("gives each source a stable id so repeat loads do not duplicate cards", async () => {
    const first = await loadComplianceSourceFreshnessItems({ now: AFTER_60D_EXPIRY });
    const second = await loadComplianceSourceFreshnessItems({ now: AFTER_60D_EXPIRY });
    expect(first.map((i) => i.id)).toEqual(second.map((i) => i.id));
    expect(new Set(first.map((i) => i.id)).size).toBe(first.length);
    expect(first[0]?.id.startsWith("compliance-source-freshness:")).toBe(true);
  });
});

describe("the caller's clock is the only clock (BI-99909E53)", () => {
  it("stamps createdAtIso from the injected `now`, so a pinned sweep clock reaches the whole item", async () => {
    const items = await loadComplianceSourceFreshnessItems({ now: AFTER_60D_EXPIRY });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.createdAtIso).toBe(AFTER_60D_EXPIRY.toISOString());
  });

  it("renders the frozen-baseline state on the pinned instant: the final valid day reads \"lapses after today\"", async () => {
    // 2026-09-18T12:00Z is the instant .github/workflows/ux-route-sweep.yml pins.
    const items = await loadComplianceSourceFreshnessItems({ now: new Date("2026-09-18T12:00:00.000Z") });
    expect(items.map((i) => i.context.includes("lapses after today"))).toEqual(items.map(() => true));
  });
});
