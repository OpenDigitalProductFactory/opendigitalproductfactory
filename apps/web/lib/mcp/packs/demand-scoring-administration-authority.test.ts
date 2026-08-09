import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backlogFind: vi.fn(),
  platformConfigFind: vi.fn(),
  activityCreate: vi.fn(),
  loadActivation: vi.fn(),
  evaluateTransition: vi.fn(),
  transitionDemand: vi.fn(),
  evaluateOrgGate: vi.fn(),
  refreshPlaybook: vi.fn(),
  authorizationLog: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: { findUnique: mocks.backlogFind },
    platformConfig: { findUnique: mocks.platformConfigFind },
    backlogItemActivity: { create: mocks.activityCreate },
  },
}));
vi.mock("@/lib/demand/transition-repository", () => ({
  loadDemandActivation: mocks.loadActivation,
  transitionDemandItem: mocks.transitionDemand,
}));
vi.mock("@/lib/demand/activation", () => ({ evaluateDemandTransition: mocks.evaluateTransition }));
vi.mock("@/lib/decision-perspective/org-business-gate", () => ({
  evaluateOrgBusinessDecisionGate: mocks.evaluateOrgGate,
}));
vi.mock("@/lib/product-management/product-management-playbook-refresh", () => ({
  queueProductManagementPlaybookRefreshForBacklogItem: mocks.refreshPlaybook,
}));
vi.mock("@/lib/governance-data", () => ({ createAuthorizationDecisionLog: mocks.authorizationLog }));
vi.mock("@/lib/demand/volunteering.server", () => ({
  offerFundedItemToCoworker: vi.fn().mockResolvedValue({ offered: false, agentId: null }),
  recordVolunteeringAutonomyShadow: vi.fn().mockResolvedValue(undefined),
}));

import { approveDemandForFundingHandler } from "./demand-scoring-administration";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.backlogFind.mockResolvedValue({
    id: "row-1",
    itemId: "BI-1",
    title: "Important work",
    organizationId: "org-1",
    demandScore: 10,
    demandStage: "shaped",
    investmentBucket: "grow",
    effortSize: "small",
    agentId: null,
    claimStatus: null,
  });
  mocks.loadActivation.mockResolvedValue({ input: {} });
  mocks.evaluateTransition.mockReturnValue({ allowed: false, code: "funding-decision-required", message: "Needs funding." });
});

describe("approveDemandForFundingHandler installation authority", () => {
  it.each([
    ["missing intent", null],
    ["development companion", { value: {
      schemaVersion: 1,
      primaryPurpose: "evolve-dpf",
      secondaryPurposes: [],
      relationshipIntents: [],
      evidence: [{ source: "human", claim: "Confirmed companion.", observedAt: "2026-08-08T12:00:00.000Z" }],
      confidence: "high",
      confirmation: { status: "confirmed", confirmedAt: "2026-08-08T12:00:00.000Z", confirmedByPrincipalId: "principal-1" },
    } }],
  ])("refuses %s before WWWD or backlog mutation", async (_label, config) => {
    mocks.platformConfigFind.mockResolvedValue(config);

    const result = await approveDemandForFundingHandler({ itemId: "BI-1" }, "user-1");

    expect(result).toMatchObject({ success: false, error: "installation_authority_required" });
    expect(mocks.evaluateOrgGate).not.toHaveBeenCalled();
    expect(mocks.authorizationLog).toHaveBeenCalledWith(expect.objectContaining({
      actionKey: "approve_demand_for_funding",
      decision: "deny",
      objectRef: "BI-1",
    }));
    expect(mocks.transitionDemand).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it("allows a confirmed business-production installation to reach WWWD and fund work", async () => {
    mocks.platformConfigFind.mockResolvedValue({
      value: {
        schemaVersion: 1,
        primaryPurpose: "operate-organization",
        secondaryPurposes: [],
        relationshipIntents: [],
        evidence: [{ source: "human", claim: "Confirmed production role.", observedAt: "2026-08-08T12:00:00.000Z" }],
        confidence: "high",
        confirmation: { status: "confirmed", confirmedAt: "2026-08-08T12:00:00.000Z", confirmedByPrincipalId: "principal-1" },
      },
    });
    mocks.evaluateOrgGate.mockResolvedValue({
      allowed: true,
      interactionId: "DI-1",
      operatorMessage: "The organization stance supports funding.",
      evaluation: { outcomeType: "recommend" },
      orgProfileSelected: true,
    });
    mocks.transitionDemand.mockResolvedValue({ ok: true });
    mocks.activityCreate.mockResolvedValue({});
    mocks.refreshPlaybook.mockResolvedValue(undefined);

    const result = await approveDemandForFundingHandler({ itemId: "BI-1" }, "user-1");

    expect(result).toMatchObject({ success: true, data: { funded: true, demandStage: "ready" } });
    expect(mocks.evaluateOrgGate).toHaveBeenCalledOnce();
    expect(mocks.transitionDemand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      itemId: "BI-1",
      to: "ready",
      fundingDecisionAllowed: true,
    }));
    expect(mocks.authorizationLog).not.toHaveBeenCalled();
    expect(mocks.activityCreate).toHaveBeenCalledOnce();
  });
});
