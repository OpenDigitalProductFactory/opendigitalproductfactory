import { describe, expect, it, vi } from "vitest";

import {
  recordRegulatoryDecisionShadowEvidence,
  resolveRuntimeRegulatoryAutonomyCeiling,
  type RegulatoryAutonomyRuntimeDb,
} from "./regulatory-autonomy-runtime";
import type { RegulatoryAutonomyPolicyRecord } from "./regulatory-ceiling";

const emptyRegional = {
  operatesIn: [],
  sellsTo: [],
  employsIn: [],
  dataResidency: [],
};

function policy(overrides: Partial<RegulatoryAutonomyPolicyRecord> = {}): RegulatoryAutonomyPolicyRecord {
  return {
    policyId: "RAP-EU-PATIENT-MESSAGE",
    policyKey: "eu-patient-message",
    version: 1,
    status: "active",
    industry: "healthcare-wellness",
    jurisdiction: "eu",
    jurisdictionBasis: "operating",
    activityClass: "patient-message.send",
    maxAutonomyLevel: "propose",
    humanControlRequired: true,
    requiredEvidence: ["decision-shadow-ledger", "human-approval"],
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveUntil: null,
    ...overrides,
  };
}

function db(overrides: Partial<RegulatoryAutonomyRuntimeDb> = {}): RegulatoryAutonomyRuntimeDb {
  return {
    businessContext: {
      findFirst: vi.fn().mockResolvedValue({
        ...emptyRegional,
        operatesIn: ["eu"],
        industry: "legacy-business-context-industry",
      }),
    },
    storefrontConfig: {
      findFirst: vi.fn().mockResolvedValue({
        archetype: { category: "healthcare-wellness" },
      }),
    },
    regulatoryAutonomyPolicy: {
      findMany: vi.fn().mockResolvedValue([policy()]),
    },
    decisionShadowLedger: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
    trustState: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

describe("resolveRuntimeRegulatoryAutonomyCeiling", () => {
  it("loads install context and active policies before delegating to the pure resolver", async () => {
    const fakeDb = db();

    const result = await resolveRuntimeRegulatoryAutonomyCeiling(fakeDb, {
      activityClass: "patient-message.send",
      asOf: "2026-06-29T03:00:00.000Z",
    });

    expect(result.profile).toEqual({
      operatesIn: ["eu"],
      sellsTo: [],
      employsIn: [],
      dataResidency: [],
      archetype: "healthcare-wellness",
    });
    expect(result.industry).toBe("healthcare-wellness");
    expect(result.resolution).toMatchObject({
      ceiling: "propose",
      defaulted: false,
      requiredEvidence: ["decision-shadow-ledger", "human-approval"],
    });
    expect(fakeDb.regulatoryAutonomyPolicy.findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        effectiveFrom: { lte: new Date("2026-06-29T03:00:00.000Z") },
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gt: new Date("2026-06-29T03:00:00.000Z") } },
        ],
      },
    });
  });
});

describe("recordRegulatoryDecisionShadowEvidence", () => {
  it("writes ledger evidence and refreshes the measured TrustState read model", async () => {
    const fakeDb = db({
      decisionShadowLedger: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([
          {
            ledgerId: "DI-1:S-2",
            agreement: false,
            observedAt: new Date("2026-06-29T03:01:00.000Z"),
          },
          {
            ledgerId: "DI-1:S-1",
            agreement: true,
            observedAt: new Date("2026-06-29T03:00:00.000Z"),
          },
        ]),
      },
      trustState: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
    const runtime = await resolveRuntimeRegulatoryAutonomyCeiling(fakeDb, {
      activityClass: "patient-message.send",
      asOf: "2026-06-29T03:00:00.000Z",
    });

    const result = await recordRegulatoryDecisionShadowEvidence(fakeDb, {
      agentId: "healthcare-agent",
      activityType: "patient-message.send",
      riskClass: "read-only",
      currentLevel: "shadow",
      decisionInteractionId: "DI-1",
      taskRunId: "TR-1",
      toolExecutionId: "TE-1",
      regulatory: runtime,
      trials: [
        {
          trialId: "S-1",
          candidateDecision: "send suggested response",
          actualDecision: "send suggested response",
          outcome: "accepted",
          agreement: true,
          observedAt: "2026-06-29T03:00:00.000Z",
        },
        {
          trialId: "S-2",
          candidateDecision: "send suggested response",
          actualDecision: "ask human",
          outcome: "corrected",
          agreement: false,
          observedAt: "2026-06-29T03:01:00.000Z",
        },
      ],
    });

    expect(fakeDb.decisionShadowLedger.upsert).toHaveBeenCalledTimes(2);
    expect(fakeDb.decisionShadowLedger.upsert).toHaveBeenCalledWith({
      where: { ledgerId: "DI-1:S-1" },
      update: expect.objectContaining({
        regulatoryPolicyId: "RAP-EU-PATIENT-MESSAGE",
      }),
      create: expect.objectContaining({
        ledgerId: "DI-1:S-1",
        agentId: "healthcare-agent",
        activityType: "patient-message.send",
        riskClass: "read-only",
        autonomyLevel: "shadow",
        agreement: true,
        taskRunId: "TR-1",
        toolExecutionId: "TE-1",
        decisionInteractionId: "DI-1",
        regulatoryPolicyId: "RAP-EU-PATIENT-MESSAGE",
        regulatoryEvidence: expect.objectContaining({
          ceiling: "propose",
          matchedPolicyIds: ["RAP-EU-PATIENT-MESSAGE"],
          requiredEvidence: ["decision-shadow-ledger", "human-approval"],
        }),
      }),
    });
    expect(fakeDb.trustState.upsert).toHaveBeenCalledWith({
      where: {
        agentId_activityType_riskClass: {
          agentId: "healthcare-agent",
          activityType: "patient-message.send",
          riskClass: "read-only",
        },
      },
      create: expect.objectContaining({
        currentLevel: "shadow",
        regulatoryCeiling: "propose",
        sampleCount: 2,
        agreementCount: 1,
        agreementRate: 0.5,
        lastLedgerId: "DI-1:S-2",
      }),
      update: expect.objectContaining({
        currentLevel: "shadow",
        regulatoryCeiling: "propose",
        sampleCount: 2,
        agreementCount: 1,
        agreementRate: 0.5,
        lastLedgerId: "DI-1:S-2",
      }),
    });
    expect(result.trustState?.window).toEqual({ samples: 2, agreements: 1 });
  });
});
