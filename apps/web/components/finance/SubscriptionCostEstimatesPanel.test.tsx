import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SubscriptionCostEstimatesPanel } from "./SubscriptionCostEstimatesPanel";
import { estimateSubscriptionUnitCost } from "@/lib/finance/subscription-cost-estimator";

const windows = [
  ...Array.from({ length: 10 }, () => ({ tokens: 2_000_000, limitHits: 2 })),
  ...Array.from({ length: 50 }, () => ({ tokens: 1_000_000, limitHits: 0 })),
];

describe("SubscriptionCostEstimatesPanel", () => {
  it("shows the fee, the estimate as a range and its confidence", () => {
    const html = renderToStaticMarkup(
      <SubscriptionCostEstimatesPanel
        unpriced={[]}
        plans={[{ contractId: "AIS-1", planName: "ChatGPT Pro", coveredProviderIds: ["chatgpt", "codex"], currency: "USD",
          estimate: estimateSubscriptionUnitCost({ monthlyFeeUsd: 200, windowHours: 5, observedDays: 30, windows }) }]}
      />,
    );
    expect(html).toContain("ChatGPT Pro");
    expect(html).toContain("Monthly fee: $200");
    expect(html).toMatch(/per million tokens \(likely between \$[\d.]+ and \$[\d.]+\)/);
    expect(html).toContain("high confidence");
    expect(html).toContain("Limits were reached in 10 of 60 5-hour windows");
  });

  it("stays closed on arrival so the page's visible word budget holds", () => {
    const html = renderToStaticMarkup(<SubscriptionCostEstimatesPanel plans={[]} unpriced={[]} />);
    expect(html).toMatch(/^<details[^>]*>/);
    expect(html).not.toMatch(/^<details[^>]*\bopen\b/);
    expect(html).toContain("<summary");
    expect(html).toContain("Subscription costs</summary>");
  });

  it("names subscriptions still counted at $0 and asks for the fee", () => {
    const html = renderToStaticMarkup(
      <SubscriptionCostEstimatesPanel plans={[]} unpriced={[{ providerId: "anthropic-sub", name: "Claude subscription" }]} />,
    );
    expect(html).toContain("Claude subscription is still counted at $0");
    expect(html).toContain("Record each plan&#x27;s payment below");
  });

  it("says a never-limited plan's figure is a ceiling", () => {
    const html = renderToStaticMarkup(
      <SubscriptionCostEstimatesPanel
        unpriced={[]}
        plans={[{ contractId: "AIS-2", planName: null, coveredProviderIds: ["anthropic-sub"], currency: "USD",
          estimate: estimateSubscriptionUnitCost({ monthlyFeeUsd: 100, windowHours: 5, observedDays: 20,
            windows: Array.from({ length: 20 }, () => ({ tokens: 1_000_000, limitHits: 0 })) }) }]}
      />,
    );
    expect(html).toContain("AIS-2");
    expect(html).toContain("at most");
    expect(html).toContain("this is the most it costs");
  });
});
