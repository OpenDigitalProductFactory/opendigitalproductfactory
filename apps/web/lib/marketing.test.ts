import { describe, expect, it } from "vitest";

import { vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {},
}));

import {
  buildMarketingReviewArtifact,
  formatMarketingGap,
  formatMarketingLabel,
} from "./marketing";

describe("marketing language helpers", () => {
  it("uses marketer-facing labels for seeded strategy values", () => {
    expect(formatMarketingLabel("content-seo")).toBe("Search-led content");
    expect(formatMarketingLabel("direct-sales")).toBe("Sales-led outreach");
    expect(formatMarketingLabel("draft")).toBe("Needs strategist review");
  });

  it("translates raw strategy gaps into user-actionable language", () => {
    expect(formatMarketingGap("Geographic scope needs review")).toBe(
      "Decide where we want to win customers first: local, regional, national, or international.",
    );
    expect(formatMarketingGap("Proof assets are still missing")).toBe(
      "Pick the proof that will make the offer credible: outcomes, testimonials, case studies, or credentials.",
    );
  });
});

describe("buildMarketingReviewArtifact", () => {
  it("normalizes a strategist recommendation into review and strategy updates", () => {
    const now = new Date("2026-04-30T18:30:00.000Z");

    const artifact = buildMarketingReviewArtifact(
      {
        summary:
          "Run a 30-day inquiry cadence led by LinkedIn outreach, SEO, and partner/community forums.",
        primaryChannels: ["linkedin", "content-seo", "partner", "tiktok", "linkedin"],
        skippedChannels: ["tiktok", "event-attend"],
        kpis: ["inquiries", "qualified rate", "time-to-first-response"],
        cadence: "weekly",
        suggestedActions: [
          "Publish one LinkedIn post each week.",
          "Send two founder-led outbound messages per day.",
        ],
      },
      now,
    );

    expect(artifact.review.reviewType).toBe("ai-proactive");
    expect(artifact.review.summary).toContain("30-day inquiry cadence");
    expect(artifact.review.suggestedActions).toEqual([
      { description: "Publish one LinkedIn post each week.", priority: "normal" },
      { description: "Send two founder-led outbound messages per day.", priority: "normal" },
    ]);
    expect(artifact.review.detectedChanges).toEqual({
      primaryChannels: ["linkedin", "content-seo", "partner"],
      skippedChannels: ["tiktok", "event-attend"],
      cadence: "weekly",
    });
    expect(artifact.review.funnelAssessment).toEqual({
      kpis: ["inquiries", "qualified rate", "time-to-first-response"],
    });
    expect(artifact.strategyUpdate).toMatchObject({
      status: "active",
      primaryChannels: ["linkedin", "content-seo", "partner"],
      reviewCadence: "weekly",
      lastReviewedAt: now,
    });
    expect(artifact.strategyUpdate.nextReviewAt?.toISOString()).toBe("2026-05-07T18:30:00.000Z");
  });
});
