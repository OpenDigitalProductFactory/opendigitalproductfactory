import { describe, expect, it, vi } from "vitest";

import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { evaluateOrgBusinessDecisionGate, loadOrgAlignmentCorpora } from "./org-business-gate";
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
  it("carries a caller threshold declaration through the organization wrapper", async () => {
    const result = await evaluateOrgBusinessDecisionGate({ ...base, db: makeDb() as never,
      resolver: fakeResolver() as never, evaluator: () => makeEval({ outcomeType: "recommend" }),
      declarations: { thresholdExceeded: true } });
    expect(result.allowed).toBe(false);
    expect(result.evaluation.escalation?.reasonCode).toBe("damaging-threshold");
  });
  it("loads portfolio evidence only from the organization-owned Product model", async () => {
    const digitalFindMany = vi.fn();
    const productFindMany = vi.fn().mockResolvedValue([
      { id: "p1", productId: "P-1", name: "Self-host support", description: "Subscription" },
    ]);
    const corpora = await loadOrgAlignmentCorpora({
      wikiPage: { findMany: vi.fn().mockResolvedValue([]) },
      digitalProduct: { findMany: digitalFindMany },
      product: { findMany: productFindMany },
    }, "org-123");
    expect(digitalFindMany).not.toHaveBeenCalled();
    expect(productFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-123", effectiveTo: null },
    }));
    expect(corpora?.portfolio).toEqual([
      expect.objectContaining({ ref: "product:P-1", text: expect.stringContaining("Self-host support") }),
    ]);
  });

  it("records a hard WWWD veto with its failing corpus and criterion", async () => {
    const db = makeDb();
    const result = await evaluateOrgBusinessDecisionGate({
      ...base,
      question: "Sell toasters to Alaskan fishermen from dock kiosks",
      db: db as never,
      resolver: fakeResolver() as never,
      evaluator: () => makeEval({ stanceAlignment: "approve" }),
      scoredOptions: [
        { id: "proceed", description: "Proceed", features: { market_fit: 1 } },
        { id: "decline", description: "Decline", features: { reversibility: 1 } },
      ],
      alignmentCorpora: {
        wwwd: [{ ref: "wiki:stance", text: "We serve MSPs. We decline toasters for fishermen in Alaska." }],
        portfolio: [{ ref: "product:dpf", text: "Self-hosted software support subscription" }],
        gtm: [{ ref: "wiki:gtm", text: "Open-source, assurance subscriptions, and MSP partners" }],
      },
    });

    expect(result.evaluation.stanceAlignment).toBe("decline");
    expect(result.evaluation.recommendedOptionId).toBe("decline");
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

  it("coverage gap records defer and outstanding independent review", async () => {
    const db = makeDb();
    const result = await evaluateOrgBusinessDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver({ coverageGap: true }) as never,
      evaluator: () => makeEval({ outcomeType: "recommend" }), // overridden by the coverage gap
    });
    expect(result.evaluation.outcomeType).toBe("defer");
    expect(result.allowed).toBe(true);
    expect(result.evaluation.escalation).toMatchObject({ route: "independent-review", followOn: "corpus-gap" });
    expect(db.decisionInteraction.create).toHaveBeenCalled();
  });

  it("a non-damaging resolver fault records independent review and preserves caller evidence", async () => {
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
    expect(result.allowed).toBe(true);
    expect(result.evaluation.outcomeType).toBe("escalate");
    expect(result.evaluation.rationale).toMatch(/evaluation fault/);
    expect(result.evaluation.escalation).toMatchObject({ route: "independent-review", followOn: "evaluation-fault" });
    expect(db.decisionInteraction.create).toHaveBeenCalled();
    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect((data.outcomePayload as { caller?: unknown }).caller).toEqual(caller);
  });

  it("a non-damaging unresolved org outcome uses the recorded review interim", async () => {
    const db = makeDb();
    const result = await evaluateOrgBusinessDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver() as never,
      evaluator: () => makeEval({ outcomeType: "escalate" }),
    });
    expect(result.allowed).toBe(true);
    expect(result.evaluation.escalation?.route).toBe("independent-review");
  });
});

describe("instance direction in WWWD (BI-8AB6B4F7)", () => {
  it("adds the owner's mission, vision and outcomes to the WWWD corpus with versioned refs", async () => {
    const corpora = await loadOrgAlignmentCorpora({
      wikiPage: { findMany: vi.fn().mockResolvedValue([]) },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      businessContext: { findUnique: vi.fn().mockResolvedValue({ mission: "Serve MSPs", vision: "Every MSP runs on DPF" }) },
      instanceOutcome: { findMany: vi.fn().mockResolvedValue([{ id: "o1", statement: "Ten MSP partners", measure: "signed contracts" }]) },
      instanceDirectionRevision: { findFirst: vi.fn().mockResolvedValue({ version: 2 }) },
    }, "org-123");
    expect(corpora?.wwwd.map((e) => e.ref)).toEqual([
      "direction:mission@v2",
      "direction:vision@v2",
      "direction:outcome:o1@v2",
    ]);
    expect(corpora?.wwwd[2]?.text).toContain("Ten MSP partners");
  });

  it("records on the ledger which direction refs the decision read", async () => {
    const db = makeDb();
    await evaluateOrgBusinessDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver() as never,
      evaluator: () => makeEval(),
      alignmentCorpora: {
        wwwd: [
          { ref: "direction:mission@v2", text: "Mission: Serve MSPs" },
          { ref: "wiki:stance", text: "We serve MSPs." },
        ],
        portfolio: [],
        gtm: [],
      },
    });
    const payload = db.decisionInteraction.create.mock.calls[0]![0].data.outcomePayload as Record<string, unknown>;
    expect(payload.instanceDirection).toEqual({ recorded: true, refs: ["direction:mission@v2"] });
  });

  it("says no direction was recorded rather than inventing one", async () => {
    const db = makeDb();
    await evaluateOrgBusinessDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver() as never,
      evaluator: () => makeEval(),
      alignmentCorpora: { wwwd: [], portfolio: [], gtm: [] },
    });
    const payload = db.decisionInteraction.create.mock.calls[0]![0].data.outcomePayload as Record<string, unknown>;
    expect(payload.instanceDirection).toEqual({ recorded: false, refs: [] });
  });
});
