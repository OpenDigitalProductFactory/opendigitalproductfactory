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

  it("exposes the recommendation, safeguards, next action, and COO coordination in plain language", () => {
    const recommendation: Omit<ProviderOnboardingRecommendation, "reviewPacket"> = {
      status: "not-ready",
      headline: "Choose a connection before using AI with company data",
      useNow: [],
      useAfterReview: [],
      notForThisWork: [],
      whatMayLeave: "No company data may leave yet.",
      whatStaysLocal: "Credentials and unknown data stay controlled.",
      whatDpfBlocks: "DPF blocks customer and employee data.",
      nextAction: "Add a local connection or document a business account.",
      caveat: "Local is not automatically compliant.",
      workloadClasses: ["customer-records"],
    };

    render(<ProviderSuitabilityGuide recommendation={{
      ...recommendation,
      reviewPacket: buildProviderReviewPacket({
        businessProfile: {
          organizationId: "org-1",
          archetypeId: null,
          archetypeCategory: null,
          operatesIn: [],
          sellsTo: [],
          employsIn: [],
          dataResidency: [],
          riskPosture: null,
        },
        recommendation: { status: recommendation.status, workloadClasses: recommendation.workloadClasses, items: [] },
      }),
    }} />);

    expect(screen.getByRole("status").textContent).toContain("Setup needed");
    expect(screen.getByRole("region", { name: "Use now" }).textContent).toContain("No connection is approved to use now");
    expect(screen.getByRole("region", { name: "Use after review" }).textContent).toContain("No connection is waiting for review");
    expect(screen.getByRole("region", { name: "Not for this work" }).textContent).toContain("No connection is blocked for this work");
    expect(screen.getByRole("region", { name: "Work DPF is protecting" }).textContent).toContain("Customer records");
    expect(screen.getByText(/Your COO coordinates the Data Governance specialist/)).toBeTruthy();
    expect(screen.getByText(/Next action:/).textContent).toContain(recommendation.nextAction);
  });

  it("keeps a long provider name readable and associated with its allowed scope", () => {
    const longName = "Contoso Sovereign Business AI Platform — European Economic Area Dedicated Processing Connection";
    const recommendation: Omit<ProviderOnboardingRecommendation, "reviewPacket"> = {
      status: "ready",
      headline: "A connection is available for company work",
      useNow: [{
        providerConnectionId: "connection-long",
        providerId: "contoso",
        label: longName,
        scope: "company-work",
        reason: "Business terms and regional controls are recorded.",
        executionChannel: "direct-api",
        accountClass: "enterprise",
      }],
      useAfterReview: [],
      notForThisWork: [],
      whatMayLeave: "Allowed company prompts.",
      whatStaysLocal: "Secrets.",
      whatDpfBlocks: "Anything outside policy.",
      nextAction: "Review evidence.",
      caveat: "Review regularly.",
      workloadClasses: ["internal-operations"],
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
        recommendation: { status: recommendation.status, workloadClasses: recommendation.workloadClasses, items: recommendation.useNow },
      }),
    }} />);

    const item = screen.getByText(longName).closest("li");
    expect(item?.className).toContain("break-words");
    expect(item?.textContent).toContain("Business terms and regional controls are recorded");
  });
});
