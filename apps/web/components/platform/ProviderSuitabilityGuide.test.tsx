// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderSuitabilityGuide } from "./ProviderSuitabilityGuide";
import { buildProviderReviewPacket } from "@/lib/routing/provider-suitability/provider-review-packet";
import type { ProviderOnboardingRecommendation } from "@/lib/routing/provider-suitability/onboarding-recommendation";

afterEach(cleanup);

describe("ProviderSuitabilityGuide", () => {
  it("hands the explanation to the canonical COO route", () => {
    const events: CustomEvent[] = [];
    const handler = (event: Event) => events.push(event as CustomEvent);
    document.addEventListener("open-agent-panel", handler);

    const recommendation: Omit<ProviderOnboardingRecommendation, "reviewPacket"> = {
      status: "review-needed",
      headline: "Keep company data out until account terms are confirmed",
      useNow: [],
      useAfterReview: [],
      notForThisWork: [],
      whatMayLeave: "Public prompts",
      whatStaysLocal: "Secrets",
      whatDpfBlocks: "Company data",
      nextAction: "Choose a business account.",
      caveat: "Local is not automatically compliant.",
      workloadClasses: ["public-marketing"],
    };
    render(<ProviderSuitabilityGuide recommendation={{
      ...recommendation,
      reviewPacket: buildProviderReviewPacket({
        businessProfile: {
          organizationId: "org-1",
          archetypeId: null,
          archetypeCategory: null,
          operatesIn: ["eu"],
          sellsTo: [],
          employsIn: [],
          dataResidency: ["eu"],
          riskPosture: "conservative",
        },
        recommendation: {
          status: recommendation.status,
          workloadClasses: recommendation.workloadClasses,
          items: [],
        },
      }),
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask my COO to explain" }));

    document.removeEventListener("open-agent-panel", handler);
    expect(events).toHaveLength(1);
    expect(events[0]?.detail.routeContext).toBe("/workspace");
    expect(events[0]?.detail.autoMessage).toContain("Consult AGT-902");
    expect(events[0]?.detail.autoMessage).toContain("provider-compliance-review.v1");
    expect(events[0]?.detail.autoMessage).not.toContain(recommendation.headline);
    expect(events[0]?.detail.providerReviewPacket).toEqual(expect.objectContaining({
      schemaVersion: "provider-compliance-review.v1",
      organizationRef: "org-1",
    }));
  });
});
