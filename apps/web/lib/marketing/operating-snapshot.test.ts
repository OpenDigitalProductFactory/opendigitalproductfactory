// Red-green coverage for the canonical marketing operating snapshot (BI-CEA797A1).
//
// The live gap this pins down: get_marketing_summary returned storefront inbox
// counts and a CRM pipeline rollup but NO campaign identities, so the Marketing
// Strategist never learned a campaignId and fell back to calling
// get_campaign_plan / get_campaign_performance with empty arguments. These tests
// cover the pure projection layer — campaign identities, channel readiness,
// evidence freshness, blockers, and the single next executable step — which both
// the MCP tools and the owner surface now consume.

import { describe, expect, it } from "vitest";

import {
  assessEvidenceFreshness,
  buildChannelReadiness,
  resolveMarketingBlockers,
  resolveMarketingNextStep,
  summarizeCampaignMeasurement,
  type MarketingCampaignIdentity,
  type MarketingChannelReadiness,
} from "./operating-snapshot";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

const ADAPTERS = [
  {
    channelId: "linkedin-personal-social",
    displayName: "LinkedIn (personal)",
    credentialIntegrationId: "linkedin-personal-social",
    capabilities: ["draft-preview", "publish-post", "fetch-engagement"] as const,
  },
  {
    channelId: "email-postmark",
    displayName: "Email (Postmark)",
    credentialIntegrationId: "postmark",
    capabilities: ["draft-preview", "send-email", "receive-inbound"] as const,
  },
];

function campaign(over: Partial<MarketingCampaignIdentity> = {}): MarketingCampaignIdentity {
  return {
    campaignId: "cmp-1",
    name: "Midweek covers",
    objective: "Lift midweek bookings",
    status: "active",
    channels: ["email"],
    startDate: null,
    endDate: null,
    execution: {
      briefCount: 1,
      taskCount: 2,
      draftedCount: 0,
      approvedCount: 0,
      undraftedCount: 0,
      nextStep: "All asset tasks are produced — set KPI targets and measure.",
    },
    measurement: {
      publications: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      spendCents: 0,
      lastPublishedAt: null,
      lastMetricsPolledAt: null,
      attributionConfidence: "none",
    },
    ...over,
  };
}

function readiness(over: Partial<MarketingChannelReadiness> = {}): MarketingChannelReadiness {
  return {
    channelId: "email-postmark",
    displayName: "Email (Postmark)",
    credentialIntegrationId: "postmark",
    connected: true,
    capabilities: ["draft-preview", "send-email"],
    unsupported: [],
    blocker: null,
    ...over,
  };
}

describe("buildChannelReadiness — honest capability advertisement", () => {
  it("marks a channel connected when its credential integration is connected", () => {
    const rows = buildChannelReadiness({
      adapters: ADAPTERS,
      connectedIntegrationIds: ["linkedin-personal-social"],
    });
    const linkedin = rows.find((r) => r.channelId === "linkedin-personal-social");
    const email = rows.find((r) => r.channelId === "email-postmark");

    expect(linkedin?.connected).toBe(true);
    expect(linkedin?.blocker).toBeNull();
    expect(email?.connected).toBe(false);
    expect(email?.blocker).toMatch(/connect/i);
  });

  it("advertises contractual operations the adapter does not implement rather than failing silently", () => {
    const rows = buildChannelReadiness({
      adapters: ADAPTERS,
      connectedIntegrationIds: ["linkedin-personal-social", "postmark"],
    });
    const linkedin = rows.find((r) => r.channelId === "linkedin-personal-social");
    const email = rows.find((r) => r.channelId === "email-postmark");

    // LinkedIn personal publishes and reports engagement but cannot receive inbound.
    expect(linkedin?.unsupported).toContain("receive-inbound");
    expect(linkedin?.unsupported).not.toContain("fetch-engagement");
    // Postmark receives inbound but reports no engagement metrics.
    expect(email?.unsupported).toContain("fetch-engagement");
    expect(email?.unsupported).not.toContain("receive-inbound");
  });

  it("never reports a capability the adapter did not register", () => {
    const rows = buildChannelReadiness({
      adapters: [{ ...ADAPTERS[0]!, capabilities: ["draft-preview"] as const }],
      connectedIntegrationIds: ["linkedin-personal-social"],
    });
    expect(rows[0]!.capabilities).toEqual(["draft-preview"]);
    expect(rows[0]!.unsupported).toEqual(
      expect.arrayContaining(["publish-post", "fetch-engagement", "receive-inbound"]),
    );
  });
});

describe("summarizeCampaignMeasurement — measured evidence, no invention", () => {
  it("returns a zeroed summary with no attribution confidence when nothing is published", () => {
    const m = summarizeCampaignMeasurement({ rows: [], trackedLinkCount: 0 });
    expect(m.publications).toBe(0);
    expect(m.impressions).toBe(0);
    expect(m.attributionConfidence).toBe("none");
    expect(m.lastPublishedAt).toBeNull();
  });

  it("aggregates published metrics and reports 'reported' confidence without tracked links", () => {
    const m = summarizeCampaignMeasurement({
      rows: [
        {
          channel: "email",
          impressions: 400,
          clicks: 40,
          conversions: 4,
          costInUsdCents: 0,
          publishedAt: hoursAgo(30),
          metricsPolledAt: hoursAgo(2),
        },
        {
          channel: "linkedin",
          impressions: 600,
          clicks: 20,
          conversions: 1,
          costInUsdCents: 5000,
          publishedAt: hoursAgo(10),
          metricsPolledAt: hoursAgo(1),
        },
      ],
      trackedLinkCount: 0,
    });
    expect(m.publications).toBe(2);
    expect(m.impressions).toBe(1000);
    expect(m.clicks).toBe(60);
    expect(m.conversions).toBe(5);
    expect(m.spendCents).toBe(5000);
    expect(m.lastPublishedAt).toEqual(hoursAgo(10));
    expect(m.lastMetricsPolledAt).toEqual(hoursAgo(1));
    expect(m.attributionConfidence).toBe("reported");
  });

  it("upgrades to 'linked' confidence only when tracked links back the conversions", () => {
    const m = summarizeCampaignMeasurement({
      rows: [
        {
          channel: "email",
          impressions: 100,
          clicks: 10,
          conversions: 2,
          costInUsdCents: 0,
          publishedAt: hoursAgo(5),
          metricsPolledAt: hoursAgo(1),
        },
      ],
      trackedLinkCount: 1,
    });
    expect(m.attributionConfidence).toBe("linked");
  });
});

describe("assessEvidenceFreshness — stale is a first-class state", () => {
  it("is not stale when nothing has been published yet", () => {
    const f = assessEvidenceFreshness({
      now: NOW,
      publications: 0,
      lastPublishedAt: null,
      lastMetricsPolledAt: null,
      lastKpiCheckpointAt: null,
      lastStrategyReviewAt: hoursAgo(5),
    });
    expect(f.stale).toBe(false);
    expect(f.staleReasons).toEqual([]);
  });

  it("is stale when work is published but measurement was never pulled", () => {
    const f = assessEvidenceFreshness({
      now: NOW,
      publications: 3,
      lastPublishedAt: hoursAgo(50),
      lastMetricsPolledAt: null,
      lastKpiCheckpointAt: null,
      lastStrategyReviewAt: hoursAgo(5),
    });
    expect(f.stale).toBe(true);
    expect(f.staleReasons.join(" ")).toMatch(/never pulled|no channel kpis/i);
  });

  it("is stale when the last metrics pull is older than the configured window", () => {
    const f = assessEvidenceFreshness({
      now: NOW,
      publications: 1,
      lastPublishedAt: hoursAgo(80),
      lastMetricsPolledAt: hoursAgo(70),
      lastKpiCheckpointAt: null,
      lastStrategyReviewAt: hoursAgo(5),
      metricsWindowHours: 24,
    });
    expect(f.stale).toBe(true);
  });

  it("is fresh when metrics were pulled inside the window", () => {
    const f = assessEvidenceFreshness({
      now: NOW,
      publications: 1,
      lastPublishedAt: hoursAgo(30),
      lastMetricsPolledAt: hoursAgo(2),
      lastKpiCheckpointAt: hoursAgo(2),
      lastStrategyReviewAt: hoursAgo(5),
      metricsWindowHours: 24,
    });
    expect(f.stale).toBe(false);
    expect(f.staleReasons).toEqual([]);
  });

  it("treats the freshness window as configurable, not a hardcoded marketing rule", () => {
    const args = {
      now: NOW,
      publications: 1,
      lastPublishedAt: hoursAgo(80),
      lastMetricsPolledAt: hoursAgo(30),
      lastKpiCheckpointAt: null,
      lastStrategyReviewAt: hoursAgo(5),
    };
    expect(assessEvidenceFreshness({ ...args, metricsWindowHours: 24 }).stale).toBe(true);
    expect(assessEvidenceFreshness({ ...args, metricsWindowHours: 72 }).stale).toBe(false);
  });
});

describe("resolveMarketingBlockers — each blocker carries one recovery action", () => {
  it("reports no connected channel as a blocker with a concrete recovery", () => {
    const blockers = resolveMarketingBlockers({
      channels: [readiness({ connected: false, blocker: "Connect Email (Postmark) to publish on this channel." })],
      hasStrategyReview: true,
      strategyStale: false,
      campaigns: [campaign()],
      pendingDraftCount: 0,
      approvedDraftCount: 1,
      evidence: assessEvidenceFreshness({
        now: NOW,
        publications: 0,
        lastPublishedAt: null,
        lastMetricsPolledAt: null,
        lastKpiCheckpointAt: null,
        lastStrategyReviewAt: hoursAgo(2),
      }),
    });
    const channelBlocker = blockers.find((b) => b.id === "no-connected-channel");
    expect(channelBlocker?.severity).toBe("blocked");
    expect(channelBlocker?.recovery).toBeTruthy();
  });

  it("reports pending approval as waiting, not blocked", () => {
    const blockers = resolveMarketingBlockers({
      channels: [readiness()],
      hasStrategyReview: true,
      strategyStale: false,
      campaigns: [campaign()],
      pendingDraftCount: 2,
      approvedDraftCount: 0,
      evidence: assessEvidenceFreshness({
        now: NOW,
        publications: 0,
        lastPublishedAt: null,
        lastMetricsPolledAt: null,
        lastKpiCheckpointAt: null,
        lastStrategyReviewAt: hoursAgo(2),
      }),
    });
    const approval = blockers.find((b) => b.id === "awaiting-approval");
    expect(approval?.severity).toBe("waiting");
  });

  it("returns no blockers on a healthy, measured workspace", () => {
    const blockers = resolveMarketingBlockers({
      channels: [readiness()],
      hasStrategyReview: true,
      strategyStale: false,
      campaigns: [
        campaign({
          measurement: {
            publications: 2,
            impressions: 500,
            clicks: 50,
            conversions: 5,
            spendCents: 0,
            lastPublishedAt: hoursAgo(20),
            lastMetricsPolledAt: hoursAgo(1),
            attributionConfidence: "linked",
          },
        }),
      ],
      pendingDraftCount: 0,
      approvedDraftCount: 0,
      evidence: assessEvidenceFreshness({
        now: NOW,
        publications: 2,
        lastPublishedAt: hoursAgo(20),
        lastMetricsPolledAt: hoursAgo(1),
        lastKpiCheckpointAt: hoursAgo(1),
        lastStrategyReviewAt: hoursAgo(2),
      }),
    });
    expect(blockers).toEqual([]);
  });
});

describe("resolveMarketingNextStep — exactly one next executable step", () => {
  const freshEvidence = assessEvidenceFreshness({
    now: NOW,
    publications: 0,
    lastPublishedAt: null,
    lastMetricsPolledAt: null,
    lastKpiCheckpointAt: null,
    lastStrategyReviewAt: hoursAgo(2),
  });

  const base = {
    channels: [readiness()],
    hasStrategyReview: true,
    strategyStale: false,
    campaigns: [campaign()],
    pendingDraftCount: 0,
    approvedDraftCount: 0,
    evidence: freshEvidence,
  };

  it("puts drafts awaiting the owner ahead of everything else", () => {
    const step = resolveMarketingNextStep({ ...base, pendingDraftCount: 3 });
    expect(step.id).toBe("review-drafts");
    expect(step.headline).toMatch(/3/);
  });

  it("routes approved drafts to publish when a channel is connected", () => {
    const step = resolveMarketingNextStep({ ...base, approvedDraftCount: 2 });
    expect(step.id).toBe("publish-approved");
  });

  it("routes approved drafts to channel connection when nothing is connected", () => {
    const step = resolveMarketingNextStep({
      ...base,
      approvedDraftCount: 2,
      channels: [readiness({ connected: false })],
    });
    expect(step.id).toBe("connect-channel");
  });

  it("asks for a strategy review before a campaign when none has run", () => {
    const step = resolveMarketingNextStep({ ...base, hasStrategyReview: false, campaigns: [] });
    expect(step.id).toBe("run-strategy-review");
  });

  it("asks to establish a campaign when the strategy is set but no campaign exists", () => {
    const step = resolveMarketingNextStep({ ...base, campaigns: [] });
    expect(step.id).toBe("establish-campaign");
    expect(step.campaignId).toBeNull();
  });

  it("names the campaign that still has undrafted asset work", () => {
    const step = resolveMarketingNextStep({
      ...base,
      campaigns: [
        campaign({ campaignId: "cmp-done" }),
        campaign({
          campaignId: "cmp-open",
          execution: {
            briefCount: 1,
            taskCount: 3,
            draftedCount: 0,
            approvedCount: 0,
            undraftedCount: 3,
            nextStep: "Draft 3 asset tasks that still need content.",
          },
        }),
      ],
    });
    expect(step.id).toBe("produce-assets");
    expect(step.campaignId).toBe("cmp-open");
  });

  it("asks for measurement when published work has no fresh evidence", () => {
    const staleEvidence = assessEvidenceFreshness({
      now: NOW,
      publications: 2,
      lastPublishedAt: hoursAgo(60),
      lastMetricsPolledAt: null,
      lastKpiCheckpointAt: null,
      lastStrategyReviewAt: hoursAgo(2),
    });
    const step = resolveMarketingNextStep({
      ...base,
      campaigns: [
        campaign({
          measurement: {
            publications: 2,
            impressions: 0,
            clicks: 0,
            conversions: 0,
            spendCents: 0,
            lastPublishedAt: hoursAgo(60),
            lastMetricsPolledAt: null,
            attributionConfidence: "none",
          },
        }),
      ],
      evidence: staleEvidence,
    });
    expect(step.id).toBe("measure-evidence");
    expect(step.campaignId).toBe("cmp-1");
  });

  it("asks for an outcome decision once fresh measured evidence exists", () => {
    const measured = assessEvidenceFreshness({
      now: NOW,
      publications: 2,
      lastPublishedAt: hoursAgo(20),
      lastMetricsPolledAt: hoursAgo(1),
      lastKpiCheckpointAt: hoursAgo(1),
      lastStrategyReviewAt: hoursAgo(2),
    });
    const step = resolveMarketingNextStep({
      ...base,
      campaigns: [
        campaign({
          measurement: {
            publications: 2,
            impressions: 900,
            clicks: 90,
            conversions: 9,
            spendCents: 1000,
            lastPublishedAt: hoursAgo(20),
            lastMetricsPolledAt: hoursAgo(1),
            attributionConfidence: "linked",
          },
        }),
      ],
      evidence: measured,
    });
    expect(step.id).toBe("decide-outcome");
    expect(step.campaignId).toBe("cmp-1");
  });

  it("always returns a routable href and non-empty copy", () => {
    for (const step of [
      resolveMarketingNextStep({ ...base, pendingDraftCount: 1 }),
      resolveMarketingNextStep({ ...base, campaigns: [] }),
      resolveMarketingNextStep(base),
    ]) {
      expect(step.href.startsWith("/customer/marketing")).toBe(true);
      expect(step.headline.length).toBeGreaterThan(0);
      expect(step.detail.length).toBeGreaterThan(0);
    }
  });
});
