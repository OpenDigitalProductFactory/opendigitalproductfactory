import { describe, expect, it } from "vitest";

import {
  planCapacityFinanceRouting,
  type CapacityProviderFinanceSignal,
} from "./finance-routing";
import type { CapacityContinuityCandidate } from "./candidates";

const baseCandidate: CapacityContinuityCandidate = {
  candidateId: "cap-cand-1",
  dedupeKey: "qa-evidence:2026-05-12",
  source: "qa-gap",
  title: "Collect QA evidence",
  objective: "Run read-only QA evidence collection for the platform AI operations page.",
  routeContext: "/platform/ai/operations-map",
  agentId: "agent-capacity",
  ownerPrincipalId: "principal-owner",
  riskClass: "read-only",
  evidenceRequired: ["QA evidence captured"],
  capacityFit: {
    modelTierHint: "standard",
    reason: "Safe evidence work can use already-paid capacity.",
  },
  sourceRef: {
    kind: "qa-gap",
    id: "QA-123",
  },
};

const underusedFixedCost: CapacityProviderFinanceSignal = {
  providerId: "openai-subscription",
  providerClass: "fixed-cost",
  status: "active",
  utilizationPct: 35,
  projectedUnusedValue: 120,
  overageRisk: false,
};

describe("planCapacityFinanceRouting", () => {
  it("prefers underused fixed-cost capacity for routine or standard safe work without pinning a provider", () => {
    const plan = planCapacityFinanceRouting(baseCandidate, {
      financeSignals: [underusedFixedCost],
    });

    expect(plan.routingHints).toEqual({
      budgetClass: "minimize_cost",
      interactionMode: "background",
      modelTierHint: "standard",
      preferredProviderClass: "fixed-cost",
      reasonCodes: ["underused_commitment", "safe_background_work"],
    });
    expect(plan.financeTracking).toEqual({
      candidateId: "cap-cand-1",
      dedupeKey: "qa-evidence:2026-05-12",
      observedProviderClasses: ["fixed-cost"],
      sourceProviderIds: ["openai-subscription"],
      projectedUnusedValue: 120,
      utilizationPct: 35,
    });
    expect(JSON.stringify(plan)).not.toContain("allowedProviders");
    expect(JSON.stringify(plan.routingHints)).not.toContain("openai-subscription");
  });

  it("uses quality-first routing for frontier work even when fixed-cost capacity is underused", () => {
    const plan = planCapacityFinanceRouting(
      {
        ...baseCandidate,
        capacityFit: {
          modelTierHint: "frontier",
          reason: "Architecture review requires frontier reasoning.",
        },
      },
      { financeSignals: [underusedFixedCost] },
    );

    expect(plan.routingHints).toMatchObject({
      budgetClass: "quality_first",
      modelTierHint: "frontier",
      preferredProviderClass: "fixed-cost",
    });
    expect(plan.routingHints.reasonCodes).toContain("frontier_required");
  });

  it("avoids token-priced overage risk for safe background work", () => {
    const plan = planCapacityFinanceRouting(baseCandidate, {
      financeSignals: [
        {
          providerId: "token-provider",
          providerClass: "token-priced",
          status: "active",
          utilizationPct: 98,
          projectedUnusedValue: 0,
          overageRisk: true,
        },
      ],
    });

    expect(plan.routingHints).toEqual({
      budgetClass: "minimize_cost",
      interactionMode: "background",
      modelTierHint: "standard",
      avoidProviderClasses: ["token-priced"],
      reasonCodes: ["overage_risk", "safe_background_work"],
    });
  });
});
