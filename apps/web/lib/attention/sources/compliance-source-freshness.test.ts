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
  it("stays silent while every source is fresh", () => {
    // A healthy source is not news. An inbox that lists fine things teaches
    // people to skim past it, which is how the real item gets missed.
    expect(loadComplianceSourceFreshnessItems({ now: BEFORE_ANY_EXPIRY })).toEqual([]);
  });

  it("warns before anything breaks, not after", () => {
    const items = loadComplianceSourceFreshnessItems({ now: INSIDE_WARNING_WINDOW });
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

  it("escalates to overdue once the evidence has actually lapsed", () => {
    const items = loadComplianceSourceFreshnessItems({ now: AFTER_60D_EXPIRY });
    expect(items.length).toBe(3);
    for (const item of items) {
      expect(item.triage.timeToAct).toBe("overdue");
      expect(item.riskClass).toBe("high-risk");
      expect(item.title).toContain("out of date");
      // Name the user-visible consequence, not the internal failure mode.
      expect(item.context).toContain("a human needs to review this");
    }
  });

  it("routes to a person, because re-attesting vendor terms is judgement", () => {
    const [item] = loadComplianceSourceFreshnessItems({ now: AFTER_60D_EXPIRY });
    expect(item.triage.decideEffort).toBe("judgment");
    expect(item.triage.residueReason).toBe("no-self-heal");
    expect(item.audience?.operator).toBe(true);
  });

  it("gives each source a stable id so repeat loads do not duplicate cards", () => {
    const first = loadComplianceSourceFreshnessItems({ now: AFTER_60D_EXPIRY });
    const second = loadComplianceSourceFreshnessItems({ now: AFTER_60D_EXPIRY });
    expect(first.map((i) => i.id)).toEqual(second.map((i) => i.id));
    expect(new Set(first.map((i) => i.id)).size).toBe(first.length);
    expect(first[0]?.id.startsWith("compliance-source-freshness:")).toBe(true);
  });
});
