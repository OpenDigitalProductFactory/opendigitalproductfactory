import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SubscriptionCostEstimatesPanel } from "./SubscriptionCostEstimatesPanel";
import {
  estimateSubscriptionPlan,
  estimateSubscriptionUnitCost,
  LOCAL_INSTALL,
  type SubscriptionCostEstimate,
  type UsageBucket,
} from "@/lib/finance/subscription-cost-estimator";
import type { SubscriptionPlanEstimate } from "@/lib/finance/subscription-cost-estimator.server";
import { translate } from "@dpf/i18n";
import type { FinanceT } from "./SubscriptionCostEstimatesPanel";

const t: FinanceT = (key, args) => translate("en-US", "finance", key, args);

/** A plan with only the effective-cost estimate (no token value, no paired install). */
const planOf = (contractId: string, planName: string | null, coveredProviderIds: string[], estimate: SubscriptionCostEstimate): SubscriptionPlanEstimate => ({
  contractId, planName, coveredProviderIds, currency: "USD", estimate, installs: [], peers: [], usageCoverage: "complete",
  value: { status: "none", periodValueUsd: 0, monthlyValueUsd: null, monthlySavingsUsd: null, unpricedProviderIds: [], priceSources: {} },
});

const windows = [
  ...Array.from({ length: 10 }, () => ({ tokens: 2_000_000, limitHits: 2 })),
  ...Array.from({ length: 50 }, () => ({ tokens: 1_000_000, limitHits: 0 })),
];

describe("SubscriptionCostEstimatesPanel", () => {
  it("shows the fee, the estimate as a range and its confidence", () => {
    const html = renderToStaticMarkup(
      <SubscriptionCostEstimatesPanel
        t={t}
        unpriced={[]}
        plans={[planOf("AIS-1", "ChatGPT Pro", ["chatgpt", "codex"],
          estimateSubscriptionUnitCost({ monthlyFeeUsd: 200, windowHours: 5, observedDays: 30, windows }))]}
      />,
    );
    expect(html).toContain("ChatGPT Pro");
    expect(html).toContain("Monthly fee: $200");
    expect(html).toMatch(/About \$[\d.]+ per million tokens \(likely between \$[\d.]+ and \$[\d.]+\)/);
    expect(html).toContain("high confidence");
    expect(html).toContain("Limits were reached in 10 of 60 5-hour windows");
  });

  it("stays closed on arrival so the page's visible word budget holds", () => {
    const html = renderToStaticMarkup(<SubscriptionCostEstimatesPanel t={t} plans={[]} unpriced={[]} />);
    expect(html).toMatch(/<details>/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain("<summary");
    expect(html).toMatch(/Subscription costs\s*<\/summary>/);
  });

  it("names subscriptions still counted at $0 and asks for the fee", () => {
    const html = renderToStaticMarkup(
      <SubscriptionCostEstimatesPanel t={t} plans={[]} unpriced={[{ providerId: "anthropic-sub", name: "Claude subscription" }]} />,
    );
    expect(html).toContain("Claude subscription is still counted at $0");
    expect(html).toContain("Record each plan&#x27;s payment below");
  });

  it("says a never-limited plan's figure is a ceiling", () => {
    const html = renderToStaticMarkup(
      <SubscriptionCostEstimatesPanel
        t={t}
        unpriced={[]}
        plans={[planOf("AIS-2", null, ["anthropic-sub"],
          estimateSubscriptionUnitCost({ monthlyFeeUsd: 100, windowHours: 5, observedDays: 20,
            windows: Array.from({ length: 20 }, () => ({ tokens: 1_000_000, limitHits: 0 })) }))]}
      />,
    );
    expect(html).toContain("AIS-2");
    expect(html).toContain("at most");
    expect(html).toContain("this is the most it costs");
  });

  // BI-6361A930
  const now = new Date("2026-11-13T00:00:00Z");
  const hour = (daysAgo: number) => Math.floor((now.getTime() - daysAgo * 86_400_000) / 3_600_000);
  const prices = new Map([["openai", { inputPerMToken: 2.5, outputPerMToken: 10 }], ["chatgpt", { inputPerMToken: 0, outputPerMToken: 0 }]]);
  const bucket = (install: string, daysAgo: number, inputTokens: number, outputTokens: number): UsageBucket =>
    ({ install, providerId: "chatgpt", hour: hour(daysAgo), inputTokens, outputTokens, limitHits: 0 });
  const render = (plan: ReturnType<typeof estimateSubscriptionPlan>) => renderToStaticMarkup(
    <SubscriptionCostEstimatesPanel t={t} unpriced={[]}
      plans={[{ contractId: "AIS-3", planName: "ChatGPT Pro", coveredProviderIds: ["chatgpt"], currency: "USD", ...plan }]} />,
  );

  it("shows what the plan's usage is worth at pay-per-token prices, the saving, and each install's share", () => {
    const html = render(estimateSubscriptionPlan({
      monthlyFeeUsd: 100, coveredProviderIds: ["chatgpt"], listPrices: prices, now,
      peers: [{ linkId: "link_1", install: "inst_dev", state: "current", reason: null, lastSuccessAt: now.toISOString() }],
      buckets: [bucket(LOCAL_INSTALL, 30, 40_000_000, 4_000_000), bucket("inst_dev", 30, 20_000_000, 2_000_000)],
    }));
    // ($100 + $40) + ($50 + $20) = $210 over 30 days, about $213 a month.
    expect(html).toContain("Usage worth $213 a month at pay-per-token prices");
    expect(html).toContain("Saving $113 a month against the fee");
    expect(html).toContain("This install: 44M tokens, worth $142");
    expect(html).toContain("Paired install inst_dev: 22M tokens, worth $71");
    expect(html).not.toContain("is missing");
  });

  it("says the paired install's usage is missing and why", () => {
    const html = render(estimateSubscriptionPlan({
      monthlyFeeUsd: 100, coveredProviderIds: ["chatgpt"], listPrices: prices, now,
      peers: [{ linkId: "link_1", install: "link_1", state: "missing", reason: "peer-outdated", lastSuccessAt: null }],
      buckets: [bucket(LOCAL_INSTALL, 30, 40_000_000, 4_000_000)],
    }));
    expect(html).toContain("Usage from the paired install is missing: it has not been updated to share AI usage yet.");
    expect(html).toContain("low confidence");
  });

  it("says when the fee costs more than pay-per-token use would", () => {
    const html = render(estimateSubscriptionPlan({
      monthlyFeeUsd: 500, coveredProviderIds: ["chatgpt"], listPrices: prices, now, peers: [],
      buckets: [bucket(LOCAL_INSTALL, 30, 40_000_000, 4_000_000)],
    }));
    expect(html).toContain("The fee is $358 a month more than pay-per-token use would cost");
  });
});
