// BI-22601A38. The profession gate records what a decision reviewed, so a
// later outcome of that work can be attributed back to the decision.
import { describe, expect, it, vi } from "vitest";

vi.mock("./acumen-gap-nomination", () => ({
  nominateAcumenCorpusGap: vi.fn().mockResolvedValue({ nominated: false, reason: "not-a-gap" }),
}));

import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { evaluateProfessionDecisionGate } from "./profession-gate";
import type { DecisionPerspectiveEvaluationResult } from "./types";

const OPTIONS = ["aligned", "revise-before-building"];

function evaluation(): DecisionPerspectiveEvaluationResult {
  return {
    outcomeType: "escalate",
    selectedProfileId: "wsid-enterprise-architecture",
    fallbackProfileId: null,
    profileVersionId: "wsid-enterprise-architecture-v1",
    confidenceBefore: 0.2,
    confidenceAfter: 0.2,
    confidenceScore: 0.2,
    coverageGap: false,
    principleConflict: false,
    domainClass: "architecture-tradeoff",
    resolvedProfileChain: ["wsid-enterprise-architecture"],
    materialCount: 1,
    freshnessDistribution: { current: 1, stale: 0, superseded: 0, contradicted: 0 },
    riskTier: "low",
    question: "Architectural alignment review: reuse the ledger",
    options: OPTIONS,
    rationale: "advisory",
    materialScores: [],
    sources: [],
  };
}

function db() {
  return {
    decisionInteraction: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "row-1", ...args.data })),
    },
    agent: { findMany: vi.fn(async () => [{ agentId: "AGT-WS-EA" }]) },
    decisionShadowLedger: { upsert: vi.fn().mockResolvedValue({}) },
  };
}

const resolver = vi.fn().mockResolvedValue({
  selectedProfileId: "wsid-enterprise-architecture",
  selectedProfile: { ...MARK_DPF_PLATFORM_PROFILE, profileId: "wsid-enterprise-architecture" },
  resolvedProfileChain: ["wsid-enterprise-architecture"],
  coverageGap: false,
  materials: [],
  professionProfileSelected: true,
  professionKey: "enterprise-architecture",
});

describe("evaluateProfessionDecisionGate — what the decision reviewed (BI-22601A38)", () => {
  it("records the build, subject, phase and reviewed artifact the caller names, on the decision and its ledger row", async () => {
    const client = db();
    await evaluateProfessionDecisionGate({
      db: client as never,
      agentIdentity: { agentId: "AGT-WS-EA", slugId: "ea-architect" },
      caller: { agentId: "AGT-WS-EA", threadId: null },
      question: "Architectural alignment review: reuse the ledger",
      options: OPTIONS,
      domainClass: "architecture-tradeoff",
      riskTier: "low",
      routeContext: "reviewDesignDoc",
      proposedOptionId: "aligned",
      build: { buildId: "FB-1" },
      subject: { kind: "backlog_item", id: "BI-1" },
      phaseFrom: "ideate",
      phaseTo: "plan",
      outcomePayloadExtra: { reviewedArtifact: { buildId: "FB-1", kind: "design", digest: "abc" } },
      resolver: resolver as never,
      evaluator: () => evaluation(),
      nominateGap: null,
    });
    const data = client.decisionInteraction.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ buildId: "FB-1", subjectKind: "backlog_item", subjectRef: "BI-1", phaseFrom: "ideate", phaseTo: "plan" });
    expect(data.outcomePayload).toMatchObject({
      reviewedArtifact: { buildId: "FB-1", kind: "design", digest: "abc" },
      proposedOptionId: "aligned",
      caller: { agentId: "AGT-WS-EA" },
    });
    const ledger = client.decisionShadowLedger.upsert.mock.calls[0]![0] as { create: { metadata: Record<string, unknown> } };
    expect(ledger.create.metadata.subject).toEqual({ kind: "backlog_item", ref: "BI-1" });
  });

  it("keeps its own facts over a caller's extra payload", async () => {
    const client = db();
    await evaluateProfessionDecisionGate({
      db: client as never,
      agentIdentity: { agentId: "AGT-WS-EA", slugId: "ea-architect" },
      question: "q",
      options: OPTIONS,
      domainClass: "architecture-tradeoff",
      riskTier: "low",
      routeContext: "reviewDesignDoc",
      outcomePayloadExtra: { professionKey: "forged", outcomeType: "recommend" },
      resolver: resolver as never,
      evaluator: () => evaluation(),
      nominateGap: null,
    });
    const payload = client.decisionInteraction.create.mock.calls[0]![0].data.outcomePayload as Record<string, unknown>;
    expect(payload.professionKey).toBe("enterprise-architecture");
    expect(payload.outcomeType).toBe("escalate");
  });
});
