import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createCoworkerA2aTask,
  mapCoworkerEngagementToA2aTask,
  readCoworkerA2aTask,
} from "./a2a-tasks";
import type { CreateCoworkerEngagementInput, CoworkerEngagementResult } from "./engagements";

// These tests exercise the RECEIPT-BEARING path, which requires a signing secret.
// Without one, createCoworkerA2aTask deliberately omits the receipt rather than
// signing with an untrustworthy value (BI-2F318FB3), so the assertions below
// would be testing the unsigned path by accident.
const savedAuthSecret = process.env.AUTH_SECRET;
beforeAll(() => {
  process.env.AUTH_SECRET = "a2a-task-test-secret";
});
afterAll(() => {
  if (savedAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = savedAuthSecret;
});

function db() {
  const engagement = {
    engagementId: "CE-A2A",
    offerId: "offer-sales",
    serviceId: "svc-sales",
    providerAgentId: "sales-coworker",
    requestedOutcome: "Qualify this customer inquiry.",
    status: "requested",
    inputPayload: { inquiry: "Need enterprise quote" },
    approvalContext: { required: false, reasons: [] },
    metadata: {
      a2a: {
        contextId: "ctx-1",
        actingAgentGaid: "gaid:public:customer-agent",
        delegatingAgentGaid: "gaid:public:customer-agent",
      },
    },
    createdAt: new Date("2026-06-30T00:00:00.000Z"),
    updatedAt: new Date("2026-06-30T00:01:00.000Z"),
    completedAt: null,
  };
  return {
    coworkerEngagement: {
      findUnique: vi.fn(async () => engagement),
    },
  };
}

describe("Coworker A2A task lifecycle", () => {
  it("maps engagement status to A2A task states with artifacts separated from messages", () => {
    expect(
      mapCoworkerEngagementToA2aTask({
        engagementId: "CE-1",
        offerId: "offer-1",
        serviceId: "svc-1",
        providerAgentId: "agent-1",
        requestedOutcome: "Prepare packet.",
        status: "needs-approval",
        inputPayload: { document: "draft" },
        approvalContext: { required: true, reasons: ["risk-tier:high"] },
        metadata: { a2a: { contextId: "ctx-1" } },
        createdAt: new Date("2026-06-30T00:00:00.000Z"),
        updatedAt: new Date("2026-06-30T00:01:00.000Z"),
        completedAt: null,
      }),
    ).toMatchObject({
      id: "CE-1",
      contextId: "ctx-1",
      status: { state: "auth-required" },
      messages: [{ role: "user" }],
      artifacts: [],
    });
  });

  it("creates a coworker engagement and returns a submitted A2A task", async () => {
    const createEngagement = vi.fn(async (_input: CreateCoworkerEngagementInput): Promise<CoworkerEngagementResult> => ({
      engagementId: "CE-A2A",
      status: "requested",
      serviceId: "svc-sales",
      providerAgentId: "sales-coworker",
      workCapsuleId: null,
      approvalContext: { required: false, reasons: [] },
    }));

    const task = await createCoworkerA2aTask(
      {
        offerId: "offer-sales",
        requestedOutcome: "Qualify this customer inquiry.",
        inputPayload: { inquiry: "Need enterprise quote" },
        contractContext: { termsRef: "terms://sales", dataBoundaryRef: "boundary://sales" },
        accessProfile: "external-a2a",
        delegatedAgentId: "sales-coworker",
        delegatedAgentGaid: "gaid:public:sales",
        authorityBoundary: "proposal-only",
        riskTier: "medium",
        requiredGrants: ["registry_read"],
        contextId: "ctx-1",
        actingAgentGaid: "gaid:public:customer-agent",
        delegatingAgentGaid: "gaid:public:customer-agent",
        routingRationale: {
          selectedOfferReason: "Sales qualification offer is externally exposed for customer inquiry triage.",
          alternativesConsidered: ["marketing-intake-coworker"],
          processStage: "repeatable",
          aggregateOfferKey: "aggregate-customer-intake",
        },
      },
      { createEngagement },
    );

    expect(createEngagement).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId: "offer-sales",
        requestedOutcome: "Qualify this customer inquiry.",
        metadata: expect.objectContaining({
          a2a: expect.objectContaining({ contextId: "ctx-1" }),
          callChain: expect.objectContaining({
            actingAgentGaid: "gaid:public:customer-agent",
            delegatingAgentGaid: "gaid:public:customer-agent",
            delegatedAgentGaid: "gaid:public:sales",
            delegatedAgentId: "sales-coworker",
          }),
          delegationReceipt: expect.objectContaining({
            receiptKind: "coworker-delegation",
            actingAgentGaid: "gaid:public:customer-agent",
            delegatingAgentGaid: "gaid:public:customer-agent",
            delegatedAgentId: "sales-coworker",
            delegatedAgentGaid: "gaid:public:sales",
          }),
          routingRationale: expect.objectContaining({
            selectedOfferReason: "Sales qualification offer is externally exposed for customer inquiry triage.",
            alternativesConsidered: ["marketing-intake-coworker"],
          }),
          processRefinement: expect.objectContaining({
            stage: "repeatable",
            aggregateOfferKey: "aggregate-customer-intake",
          }),
        }),
        auditRefs: expect.objectContaining({
          delegationReceiptId: expect.stringMatching(/^CDR-/),
        }),
      }),
    );
    expect(task).toMatchObject({
      id: "CE-A2A",
      contextId: "ctx-1",
      serviceId: "svc-sales",
      providerAgentId: "sales-coworker",
      metadata: { delegatedAgentId: "sales-coworker" },
      status: { state: "submitted" },
    });
    expect(task.metadata.delegationReceipt).toMatchObject({
      receiptKind: "coworker-delegation",
      delegatedAgentGaid: "gaid:public:sales",
    });
  });

  it("rejects cross-boundary A2A tasks without an acting and delegating GAID chain", async () => {
    await expect(
      createCoworkerA2aTask(
        {
          offerId: "offer-sales",
          requestedOutcome: "Qualify this customer inquiry.",
          contractContext: { termsRef: "terms://sales", dataBoundaryRef: "boundary://sales" },
          accessProfile: "external-a2a",
          delegatedAgentGaid: "gaid:public:sales",
          authorityBoundary: "proposal-only",
          riskTier: "medium",
        },
        { createEngagement: vi.fn() },
      ),
    ).rejects.toThrow("Cross-boundary A2A tasks require actingAgentGaid and delegatingAgentGaid.");
  });

  it("reads an existing engagement task by id", async () => {
    const fakeDb = db();
    const task = await readCoworkerA2aTask("CE-A2A", { db: fakeDb });

    expect(fakeDb.coworkerEngagement.findUnique).toHaveBeenCalledWith({
      where: { engagementId: "CE-A2A" },
    });
    expect(task).toMatchObject({
      id: "CE-A2A",
      contextId: "ctx-1",
      status: { state: "submitted" },
    });
  });

  it("returns the persisted delegation receipt in task readback metadata", () => {
    const task = mapCoworkerEngagementToA2aTask({
      engagementId: "CE-1",
      offerId: "offer-1",
      serviceId: "svc-1",
      providerAgentId: "sales-coworker",
      requestedOutcome: "Prepare packet.",
      status: "requested",
      inputPayload: {},
      approvalContext: { required: false, reasons: [] },
      metadata: {
        a2a: {
          contextId: "ctx-1",
          actingAgentGaid: "gaid:public:buyer",
          delegatingAgentGaid: "gaid:public:buyer",
        },
        delegationReceipt: {
          receiptKind: "coworker-delegation",
          receiptId: "CDR-1234",
          delegatedAgentGaid: "gaid:public:sales",
        },
      },
      createdAt: new Date("2026-06-30T00:00:00.000Z"),
      updatedAt: new Date("2026-06-30T00:01:00.000Z"),
      completedAt: null,
    });

    expect(task.metadata.delegationReceipt).toMatchObject({
      receiptKind: "coworker-delegation",
      receiptId: "CDR-1234",
      delegatedAgentGaid: "gaid:public:sales",
    });
  });
});
