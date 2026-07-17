import { describe, expect, it, vi } from "vitest";

import { createCoworkerEngagement } from "./engagements";

function db(overrides: Record<string, unknown> = {}) {
  return {
    coworkerOffer: {
      findUnique: vi.fn(async () => ({
        offerId: "offer-1",
        serviceId: "svc-1",
        riskTier: "medium",
        authorityBoundary: "proposal-only",
        availabilityScope: "internal",
        legalTerms: {},
        dataBoundary: {},
        service: {
          serviceId: "svc-1",
          providerAgentId: "agent-1",
          authorityBoundary: "proposal-only",
          riskTier: "medium",
        },
      })),
    },
    coworkerEngagement: {
      create: vi.fn(async ({ data }) => ({
        id: "row-1",
        engagementId: data.engagementId,
        status: data.status,
        workCapsuleId: data.workCapsuleId ?? null,
        ...data,
      })),
    },
    ...overrides,
  };
}

describe("createCoworkerEngagement", () => {
  it("creates a requested engagement without creating a Work Capsule", async () => {
    const fakeDb = db();

    const result = await createCoworkerEngagement(
      {
        offerId: "offer-1",
        requestedByUserId: "user-1",
        requestedOutcome: "Prepare review packet.",
        inputPayload: { matter: "support terms" },
      },
      { db: fakeDb },
    );

    expect(result.status).toBe("requested");
    expect(result.workCapsuleId).toBeNull();
    expect(fakeDb.coworkerEngagement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          offerId: "offer-1",
          serviceId: "svc-1",
          providerAgentId: "agent-1",
          requestedByUserId: "user-1",
          status: "requested",
          workCapsuleId: null,
        }),
      }),
    );
  });

  it("marks high-risk or approval-required offers as needing approval", async () => {
    const fakeDb = db({
      coworkerOffer: {
        findUnique: vi.fn(async () => ({
          offerId: "offer-legal",
          serviceId: "svc-legal",
          riskTier: "high",
          authorityBoundary: "approval-required",
          availabilityScope: "internal",
          legalTerms: { attorneyReviewRequired: true },
          dataBoundary: { sensitivity: "confidential" },
          service: {
            serviceId: "svc-legal",
            providerAgentId: "legal-operations-counsel",
            authorityBoundary: "proposal-only",
            riskTier: "high",
          },
        })),
      },
    });

    const result = await createCoworkerEngagement(
      {
        offerId: "offer-legal",
        requestedByUserId: "user-1",
        requestedOutcome: "Prepare Arcamanus packet.",
      },
      { db: fakeDb },
    );

    expect(result.status).toBe("needs-approval");
    expect(result.approvalContext).toMatchObject({
      required: true,
      reasons: ["risk-tier:high", "authority-boundary:approval-required"],
    });
  });

  it("requires paid-provider funding and contract evidence before request is execution-ready", async () => {
    const fakeDb = db({
      coworkerOffer: {
        findUnique: vi.fn(async () => ({
          offerId: "offer-paid-provider",
          serviceId: "svc-paid-provider",
          riskTier: "medium",
          authorityBoundary: "proposal-only",
          availabilityScope: "internal",
          budgetEnvelope: { paidProvider: true, requiresBudgetApproval: true },
          legalTerms: { termsRequired: true },
          dataBoundary: { dataBoundaryRequired: true },
          service: {
            serviceId: "svc-paid-provider",
            providerAgentId: "procurement-finance-coordinator",
            authorityBoundary: "proposal-only",
            riskTier: "medium",
          },
        })),
      },
    });

    const result = await createCoworkerEngagement(
      {
        offerId: "offer-paid-provider",
        requestedByUserId: "user-1",
        requestedOutcome: "Approve D&B Direct+ provider usage.",
      },
      { db: fakeDb },
    );

    expect(result.status).toBe("needs-approval");
    expect(result.approvalContext.reasons).toEqual(
      expect.arrayContaining([
        "paid-provider:funding-context-missing",
        "contract-terms:missing",
        "data-boundary:missing",
      ]),
    );
  });

  it("rejects external offers without terms and data boundary context", async () => {
    const fakeDb = db({
      coworkerOffer: {
        findUnique: vi.fn(async () => ({
          offerId: "offer-external",
          serviceId: "svc-external",
          riskTier: "medium",
          authorityBoundary: "proposal-only",
          availabilityScope: "external",
          legalTerms: {},
          dataBoundary: {},
          service: {
            serviceId: "svc-external",
            providerAgentId: "external-agent",
            authorityBoundary: "proposal-only",
            riskTier: "medium",
          },
        })),
      },
    });

    await expect(
      createCoworkerEngagement(
        {
          offerId: "offer-external",
          requestedByUserId: "user-1",
          requestedOutcome: "Request external analysis.",
        },
        { db: fakeDb },
      ),
    ).rejects.toThrow("External coworker offers require contractContext.termsRef and contractContext.dataBoundaryRef.");
  });

  it("persists audit references supplied by an A2A delegation receipt", async () => {
    const fakeDb = db();

    await createCoworkerEngagement(
      {
        offerId: "offer-1",
        requestedByAgentId: "coordinator-agent",
        requestedOutcome: "Prepare review packet.",
        auditRefs: {
          delegationReceiptId: "CDR-1234",
          delegationReceiptKind: "coworker-delegation",
        },
      },
      { db: fakeDb },
    );

    expect(fakeDb.coworkerEngagement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          auditRefs: {
            delegationReceiptId: "CDR-1234",
            delegationReceiptKind: "coworker-delegation",
          },
        }),
      }),
    );
  });
});
