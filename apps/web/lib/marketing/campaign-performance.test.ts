import { describe, it, expect } from "vitest";
import {
  metricRowFromSnapshot,
  summarizeCampaignPerformance,
  type PublicationMetricRow,
} from "./campaign-performance";

const rows: PublicationMetricRow[] = [
  { channel: "linkedin-personal-social", impressions: 10_000, clicks: 300, costInUsdCents: 0, conversions: 12 },
  { channel: "linkedin-personal-social", impressions: 5_000, clicks: 100, costInUsdCents: 0, conversions: 3 },
  { channel: "email-postmark", impressions: 2_000, clicks: 400, costInUsdCents: 0, conversions: 20 },
  { channel: "linkedin-ads", impressions: 50_000, clicks: 800, costInUsdCents: 40_000, conversions: 25 },
];

describe("summarizeCampaignPerformance", () => {
  it("aggregates per channel and sorts by spend desc", () => {
    const r = summarizeCampaignPerformance({ rows });
    expect(r.channelsActive).toBe(3);
    expect(r.publications).toBe(4);
    // biggest spend first
    expect(r.byChannel[0]!.channel).toBe("linkedin-ads");
    const li = r.byChannel.find((c) => c.channel === "linkedin-personal-social")!;
    expect(li.publications).toBe(2);
    expect(li.impressions).toBe(15_000);
    expect(li.clicks).toBe(400);
    expect(li.conversions).toBe(15);
  });

  it("computes derived efficiency metrics with safe division", () => {
    const r = summarizeCampaignPerformance({ rows });
    // totals: impressions 67k, clicks 1600, spend 40000c, conversions 60
    expect(r.totals.impressions).toBe(67_000);
    expect(r.totals.clicks).toBe(1_600);
    expect(r.totals.spendCents).toBe(40_000);
    expect(r.totals.conversions).toBe(60);
    // CTR = 1600/67000
    expect(r.totals.ctr).toBeCloseTo(1_600 / 67_000, 6);
    // CPC = 40000 / 1600 = 25c
    expect(r.totals.cpcCents).toBe(25);
    // CPA = 40000 / 60 = 667c (rounded)
    expect(r.totals.cpaCents).toBe(Math.round(40_000 / 60));
    // conversion rate = 60/1600
    expect(r.totals.conversionRate).toBeCloseTo(60 / 1_600, 6);
  });

  it("never divides by zero on empty channels", () => {
    const r = summarizeCampaignPerformance({
      rows: [{ channel: "email-postmark", impressions: 0, clicks: 0, costInUsdCents: 0, conversions: 0 }],
    });
    expect(r.totals.ctr).toBe(0);
    expect(r.totals.cpcCents).toBe(0);
    expect(r.totals.cpaCents).toBe(0);
    expect(r.totals.conversionRate).toBe(0);
  });

  it("paces spend against budget", () => {
    const r = summarizeCampaignPerformance({ rows, budgetTotalCents: 100_000 });
    expect(r.budget.budgetTotalCents).toBe(100_000);
    expect(r.budget.spentCents).toBe(40_000);
    expect(r.budget.utilization).toBeCloseTo(0.4, 6);
    expect(r.budget.remainingCents).toBe(60_000);
  });

  it("returns null budget fields when no budget is set", () => {
    const r = summarizeCampaignPerformance({ rows });
    expect(r.budget.budgetTotalCents).toBeNull();
    expect(r.budget.utilization).toBeNull();
    expect(r.budget.remainingCents).toBeNull();
  });

  it("scores KPI targets against actuals, ignoring non-numeric/unknown keys", () => {
    const r = summarizeCampaignPerformance({
      rows,
      kpiTargets: { conversions: 120, clicks: 800, unknownMetric: 5, note: "hit hard" },
    });
    const conv = r.targets.find((t) => t.metric === "conversions")!;
    expect(conv.actual).toBe(60);
    expect(conv.target).toBe(120);
    expect(conv.attainment).toBeCloseTo(0.5, 6);
    const clicks = r.targets.find((t) => t.metric === "clicks")!;
    expect(clicks.attainment).toBeCloseTo(1_600 / 800, 6);
    // unknown/non-numeric keys are dropped
    expect(r.targets.find((t) => t.metric === "unknownMetric")).toBeUndefined();
    expect(r.targets.find((t) => t.metric === "note")).toBeUndefined();
  });

  it("gives an honest headline when there are no measured publications", () => {
    const r = summarizeCampaignPerformance({ rows: [] });
    expect(r.publications).toBe(0);
    expect(r.channelsActive).toBe(0);
    expect(r.headline).toMatch(/no measured publications/i);
  });

  it("headline includes CTR and budget utilization when present", () => {
    const r = summarizeCampaignPerformance({ rows, budgetTotalCents: 100_000 });
    expect(r.headline).toMatch(/CTR/);
    expect(r.headline).toMatch(/40% of budget/);
  });
});

describe("metricRowFromSnapshot", () => {
  it("reads numeric fields from a well-formed snapshot", () => {
    const row = metricRowFromSnapshot("linkedin", {
      impressions: 100,
      clicks: 10,
      costInUsdCents: 500,
      conversions: 2,
    });
    expect(row).toMatchObject({ channel: "linkedin", impressions: 100, clicks: 10, costInUsdCents: 500, conversions: 2 });
  });

  it("carries publication timing and tracked-link provenance when supplied", () => {
    const publishedAt = new Date("2026-07-27T09:00:00.000Z");
    const metricsPolledAt = new Date("2026-07-28T09:00:00.000Z");
    const row = metricRowFromSnapshot("linkedin", { impressions: 1 }, {
      publishedAt,
      metricsPolledAt,
      trackedLink: true,
    });
    expect(row.publishedAt).toEqual(publishedAt);
    expect(row.metricsPolledAt).toEqual(metricsPolledAt);
    expect(row.trackedLink).toBe(true);
  });

  it("defaults timing and tracked-link provenance to absent, never invented", () => {
    const row = metricRowFromSnapshot("linkedin", { impressions: 1 });
    expect(row.publishedAt).toBeNull();
    expect(row.metricsPolledAt).toBeNull();
    expect(row.trackedLink).toBe(false);
  });

  it("defaults missing / non-numeric / non-object snapshots to zero", () => {
    expect(metricRowFromSnapshot("x", null)).toMatchObject({ channel: "x", impressions: 0, clicks: 0, costInUsdCents: 0, conversions: 0 });
    expect(metricRowFromSnapshot("x", "not-an-object")).toMatchObject({ channel: "x", impressions: 0, clicks: 0, costInUsdCents: 0, conversions: 0 });
    expect(metricRowFromSnapshot("x", { impressions: "50", clicks: NaN })).toMatchObject({ channel: "x", impressions: 0, clicks: 0, costInUsdCents: 0, conversions: 0 });
  });

  it("clamps negative counts to zero so the rollup can't show a negative CTR", () => {
    const row = metricRowFromSnapshot("x", { impressions: 100, clicks: -100, conversions: -5, costInUsdCents: -1 });
    expect(row).toMatchObject({ channel: "x", impressions: 100, clicks: 0, costInUsdCents: 0, conversions: 0 });
  });
});
