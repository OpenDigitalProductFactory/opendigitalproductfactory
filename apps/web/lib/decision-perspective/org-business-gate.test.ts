import { describe, expect, it, vi } from "vitest";

import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { evaluateOrgBusinessDecisionGate } from "./org-business-gate";
import type {
  DecisionDomainClass,
  DecisionPerspectiveEvaluationResult,
  DecisionPerspectiveProfile,
} from "./types";

const DOMAIN: DecisionDomainClass = "professional-practice";

function makeProfile(profileId: string): DecisionPerspectiveProfile {
  return { ...MARK_DPF_PLATFORM_PROFILE, profileId };
}

function makeEval(over: Partial<DecisionPerspectiveEvaluationResult> = {}): DecisionPerspectiveEvaluationResult {
  return {
    outcomeType: "recommend",
    selectedProfileId: "org-1",
    fallbackProfileId: null,
    profileVersionId: "org-v1",
    confidenceBefore: 0.8,
    confidenceAfter: 0.8,
    confidenceScore: 0.8,
    coverageGap: false,
    principleConflict: false,
    domainClass: DOMAIN,
    resolvedProfileChain: ["org-1"],
    materialCount: 1,
    freshnessDistribution: { current: 1, stale: 0, superseded: 0, contradicted: 0 },
    riskTier: "medium",
    question: "q",
    options: ["a", "b"],
    rationale: "the org stance supports it",
    materialScores: [],
    sources: [],
    ...over,
  };
}

function makeDb() {
  return {
    decisionInteraction: {
      create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "row-1", ...args.data })),
    },
  };
}

function fakeResolver(over: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    selectedProfileId: "org-1",
    selectedProfile: makeProfile("org-1"),
    resolvedProfileChain: ["org-1"],
    coverageGap: false,
    materials: [],
    orgProfileSelected: true,
    ...over,
  });
}

const base = {
  organizationId: "org-123",
  question: "Should we send a replacement to this customer?",
  options: ["Send replacement", "Decline", "Escalate"],
  domainClass: DOMAIN,
  riskTier: "medium" as const,
  routeContext: "/coworker-business",
};

describe("evaluateOrgBusinessDecisionGate (BI-230C9EF7)", () => {
  it("records a hard WWWD veto with its failing corpus and criterion", async () => {
    const db = makeDb();
    const result = await evaluateOrgBusinessDecisionGate({
      ...base,
      question: "Sell toasters to Alaskan fishermen from dock kiosks",
      db: db as never,
      resolver: fakeResolver() as never,
      evaluator: () => makeEval({ stanceAlignment: "approve" }),
      alignmentCorpora: {
        wwwd: [{ ref: "wiki:stance", text: "We serve MSPs. We decline toasters for fishermen in Alaska." }],
        portfolio: [{ ref: "product:dpf", text: "Self-hosted software support subscription" }],
        gtm: [{ ref: "wiki:gtm", text: "Open-source, assurance subscriptions, and MSP partners" }],
      },
    });

    expect(result.evaluation.stanceAlignment).toBe("decline");
    expect(result.evaluation.constitutionalAlignment?.veto).toMatchObject({
      corpus: "wwwd",
      criterion: "market",
    });
    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect((data.outcomePayload as Record<string, unknown>).constitutionalAlignment).toEqual(
      result.evaluation.constitutionalAlignment,
    );
  });

  it("decides from the org's own profile and records orgProfileSelected=true (no build context)", async () => {
    const db = makeDb();
    const result = await evaluateOrgBusinessDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver() as never,
      evaluator: () => makeEval({ outcomeType: "recommend" }),
    });

    expect(result.orgProfileSelected).toBe(true);
    expect(result.allowed).toBe(true); // recommend
    expect(result.operatorMessage).toMatch(/your organization's recorded stance/);

    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.routeContext).toBe("/coworker-business");
    expect(data.buildId).toBeNull();
    expect(data.phaseFrom).toBeNull();
    expect(data.phaseTo).toBeNull();
    expect((data.outcomePayload as { orgProfileSelected?: boolean }).orgProfileSelected).toBe(true);
  });

  it("falls back to platform as ADVISORY when the org is silent (orgProfileSelected=false)", async () => {
    const db = makeDb();
    const result = await evaluateOrgBusinessDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver({
        selectedProfileId: MARK_DPF_PLATFORM_PROFILE.profileId,
        selectedProfile: MARK_DPF_PLATFORM_PROFILE,
        resolvedProfileChain: [MARK_DPF_PLATFORM_PROFILE.profileId],
        orgProfileSelected: false,
      }) as never,
      evaluator: () => makeEval({ selectedProfileId: MARK_DPF_PLATFORM_PROFILE.profileId }),
    });

    expect(result.orgProfileSelected).toBe(false);
    expect(result.operatorMessage).toMatch(/platform defaults/);
    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect((data.outcomePayload as { orgProfileSelected?: boolean }).orgProfileSelected).toBe(false);
  });

  it("coverage gap forces defer and is not allowed", async () => {
    const db = makeDb();
    const result = await evaluateOrgBusinessDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver({ coverageGap: true }) as never,
      evaluator: () => makeEval({ outcomeType: "recommend" }), // overridden by the coverage gap
    });
    expect(result.evaluation.outcomeType).toBe("defer");
    expect(result.allowed).toBe(false);
    expect(db.decisionInteraction.create).toHaveBeenCalled();
  });

  it("fail-closed: a resolver error escalates to a human and is still recorded", async () => {
    const db = makeDb();
    const caller = {
      client: "codex",
      apiTokenId: "token-1",
      threadId: "thread-1",
    };
    const result = await evaluateOrgBusinessDecisionGate({
      ...base,
      db: db as never,
      resolver: vi.fn().mockRejectedValue(new Error("db down")) as never,
      caller,
    });
    expect(result.allowed).toBe(false);
    expect(result.evaluation.outcomeType).toBe("escalate");
    expect(result.evaluation.rationale).toMatch(/fail-closed/);
    expect(db.decisionInteraction.create).toHaveBeenCalled();
    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect((data.outcomePayload as { caller?: unknown }).caller).toEqual(caller);
  });

  it("a non-recommend org outcome (e.g. escalate) is not allowed", async () => {
    const db = makeDb();
    const result = await evaluateOrgBusinessDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver() as never,
      evaluator: () => makeEval({ outcomeType: "escalate" }),
    });
    expect(result.allowed).toBe(false);
  });
});
