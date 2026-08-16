import { describe, expect, expectTypeOf, it } from "vitest";
import type { WikiPerspective } from "@/lib/wiki/perspective-intent";
import {
  groupFounderReviewCandidates,
  isFounderActionable,
  projectFounderReviewCandidate,
  type DecisionInteractionQueueRow,
  type FounderReviewCandidate,
} from "./queue";

describe("founder review queue", () => {
  it("projects unresolved decision interactions into review cards", () => {
    const candidate = projectFounderReviewCandidate({
      interactionId: "DI-1",
      question: "Should the interface hide raw traces?",
      options: ["Hide by default", "Show raw traces"],
      outcomeType: "defer",
      outcomePayload: { unresolvedReason: "principle-gap" },
      buildId: "FB-1",
      taskRunId: null,
      routeContext: "/build",
      createdAt: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(candidate.id).toBe("DI-1");
    expect(candidate.unresolvedReason).toBe("principle-gap");
    expect(candidate.unresolvedReasonLabel).toBe("Principle gap");
    expect(candidate.primaryActionLabel).toBe("Clarify founder principle");
    expect(candidate.perspective).toBe("wwmd");
    expect(candidate.links.buildHref).toBe("/build?buildId=FB-1");
    expect(candidate.links.decisionCanvasHref).toBe("/platform/ai/decisions/DI-1");
  });

  it("uses operating-policy wording for WWWD principle gaps", () => {
    const candidate = projectFounderReviewCandidate({
      interactionId: "DI-ORG",
      question: "Should we change the guarantee?",
      options: [],
      outcomeType: "defer",
      outcomePayload: { unresolvedReason: "principle-gap" },
      buildId: null,
      taskRunId: null,
      routeContext: "/storefront",
      createdAt: new Date("2026-05-26T12:00:00.000Z"),
      profile: {
        profileId: "profile-org",
        name: "WWWD Organization",
        kind: "organization",
      },
    });

    expect(candidate.perspective).toBe("wwwd");
    expect(candidate.profileLabel).toBe("WWWD Organization");
    expect(candidate.primaryActionLabel).toBe("Clarify operating policy");
  });

  // Reconciliation with PR #1343 (BI-F5179C9E): the candidate's perspective
  // field must use the canonical WikiPerspective enum. The default for a
  // missing profile is "wwmd" (founder-review queue legacy default).
  it("types `perspective` as the canonical WikiPerspective", () => {
    expectTypeOf<FounderReviewCandidate["perspective"]>().toEqualTypeOf<WikiPerspective>();
  });

  it("groups projected candidates by human-readable reason", () => {
    const groups = groupFounderReviewCandidates([
      projectFounderReviewCandidate({
        interactionId: "DI-1",
        question: "Clarify principle?",
        options: [],
        outcomeType: "defer",
        outcomePayload: { unresolvedReason: "principle-gap" },
        buildId: null,
        taskRunId: null,
        routeContext: "/build",
        createdAt: new Date("2026-05-26T12:00:00.000Z"),
      }),
      projectFounderReviewCandidate({
        interactionId: "DI-2",
        question: "Need evidence?",
        options: [],
        outcomeType: "defer",
        outcomePayload: { unresolvedReason: "evidence-gap" },
        buildId: null,
        taskRunId: "TR-1",
        routeContext: "/build",
        createdAt: new Date("2026-05-26T12:05:00.000Z"),
      }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["Principle gap", "Evidence gap"]);
    expect(groups[0]?.items).toHaveLength(1);
  });
});

// BI-6EC1EE25. The founder-review / attention queues were inclusion-by-default:
// every escalate/defer row was founder residue unless it matched a hardcoded
// deny-list of "agent-internal noise", DUPLICATED across three files. A new
// class of fail-open advisory reviews (the profession/WSID gate fired from
// reviewDesignDoc/reviewBuildPlan, BI-D6CFE63A) was not on the list, so 109
// advisory defers polluted the queue and grew on every review. This one derived
// predicate replaces the duplicated deny-lists so the next advisory writer
// cannot silently re-pollute.
type PredicateRow = Pick<
  DecisionInteractionQueueRow,
  "buildId" | "taskRunId" | "routeContext" | "domainClass" | "gateKey"
>;

function predicateRow(overrides: Partial<PredicateRow> = {}): PredicateRow {
  return {
    buildId: null,
    taskRunId: null,
    routeContext: "/build",
    domainClass: "plan-readiness",
    gateKey: "build-studio",
    ...overrides,
  };
}

describe("isFounderActionable (BI-6EC1EE25)", () => {
  it("excludes fail-open profession/WSID advisories — the #3344 regression", () => {
    // A craft "defer" means the corpus is empty; that is a ProfessionCorpusGap
    // signal, not a founder decision. The advisory already returned and blocks
    // nothing (advisory by contract, BI-D6CFE63A).
    expect(
      isFounderActionable(predicateRow({ gateKey: "profession", routeContext: "reviewPlanDoc" })),
    ).toBe(false);
    expect(
      isFounderActionable(predicateRow({ gateKey: "profession", routeContext: "reviewDesignDoc" })),
    ).toBe(false);
  });

  it("excludes a profession advisory even if it carried a build/task link", () => {
    // Advisory is advisory regardless of linkage — linkage must not re-admit it.
    expect(isFounderActionable(predicateRow({ gateKey: "profession", buildId: "FB-9" }))).toBe(false);
  });

  it("excludes unlinked agent-internal kernel consults (BI-9026B96C, preserved)", () => {
    expect(
      isFounderActionable(
        predicateRow({ gateKey: null, routeContext: "mcp:principle_decide", domainClass: "kernel-consult" }),
      ),
    ).toBe(false);
  });

  it("keeps a kernel consult that is linked to a real build (preserved)", () => {
    expect(
      isFounderActionable(
        predicateRow({ buildId: "FB-1", routeContext: "mcp:principle_decide", domainClass: "kernel-consult" }),
      ),
    ).toBe(true);
  });

  it("keeps a genuine build-studio plan gate escalation", () => {
    expect(isFounderActionable(predicateRow({ gateKey: "build-studio", buildId: "FB-3" }))).toBe(true);
  });

  it("keeps a genuine WWWD org-business stance gap", () => {
    // The case the operator actually answered on 2026-07-10 — must still surface.
    expect(
      isFounderActionable(
        predicateRow({ gateKey: "org-business", routeContext: "/coworker-business", buildId: null }),
      ),
    ).toBe(true);
  });

  it("keeps an unlinked non-advisory decision from a real surface", () => {
    expect(
      isFounderActionable(
        predicateRow({ gateKey: null, routeContext: "/coworker-decisions/decisions", domainClass: "plan-readiness" }),
      ),
    ).toBe(true);
  });
});

// BI-38658E6B — never synthesise "Principle gap". When `unresolvedReason` is
// absent the reason must be DERIVED from the payload that is present, because
// the fallback told operators to "clarify operating policy" on rows whose own
// payload recorded `coverageGap: false` — i.e. the doctrine was found and
// applied. Post-BI-7E1F128A that advice is actively wrong: adding stance
// material moves a relevance-weighted score by an amount that can be zero.
describe("unresolved reason is derived, never invented (BI-38658E6B)", () => {
  function orgRow(payload: Record<string, unknown>): DecisionInteractionQueueRow {
    return {
      interactionId: "DI-DERIVE",
      question: "Should we restore the lapsed subscription?",
      options: [],
      outcomeType: "escalate",
      outcomePayload: payload,
      buildId: null,
      taskRunId: null,
      routeContext: "/coworker-business",
      createdAt: new Date("2026-08-15T12:00:00.000Z"),
      profile: { profileId: "profile-org", name: "Operator perspective", kind: "organization" },
    };
  }

  it("an explicitly recorded reason still wins", () => {
    const c = projectFounderReviewCandidate(orgRow({ unresolvedReason: "evidence-gap" }));
    expect(c.unresolvedReason).toBe("evidence-gap");
  });

  it("coverageGap:true is a genuine doctrine gap and keeps the policy wording", () => {
    const c = projectFounderReviewCandidate(orgRow({ coverageGap: true, materialCount: 0 }));
    expect(c.unresolvedReason).toBe("principle-gap");
    expect(c.primaryActionLabel).toBe("Clarify operating policy");
  });

  // The live regression: DI-B4E7DCC2D028 carried exactly this payload and was
  // labelled "Principle gap → Clarify operating policy" while the corpus already
  // held a promoted ruling on the same question.
  it("coverageGap:false with a low score reports confidence, NOT a principle gap", () => {
    const c = projectFounderReviewCandidate(orgRow({
      coverageGap: false,
      principleConflict: false,
      confidenceScore: 0.35,
      materialCount: 3,
    }));
    expect(c.unresolvedReason).toBe("confidence-below-threshold");
    expect(c.unresolvedReasonLabel).toBe("Below confidence threshold");
    expect(c.primaryActionLabel).not.toBe("Clarify operating policy");
  });

  it("a lexical relevance fallback is reported as a degraded retrieval layer", () => {
    const c = projectFounderReviewCandidate(orgRow({
      coverageGap: false,
      confidenceScore: 0.5,
      relevanceMethod: "lexical",
      stanceAlignment: "approve",
    }));
    expect(c.unresolvedReason).toBe("relevance-degraded");
    expect(c.unresolvedReasonLabel).toBe("Embeddings unavailable");
  });

  it("conflicting stance directions are reported as a conflict, not a gap", () => {
    const c = projectFounderReviewCandidate(orgRow({
      coverageGap: false,
      stanceAlignment: "mixed",
      confidenceScore: 0.6,
    }));
    expect(c.unresolvedReason).toBe("principle-conflict");
  });

  it("principleConflict:true is a conflict even without stanceAlignment", () => {
    const c = projectFounderReviewCandidate(orgRow({ coverageGap: false, principleConflict: true }));
    expect(c.unresolvedReason).toBe("principle-conflict");
  });

  it("an empty payload is labelled unknown rather than guessed", () => {
    const c = projectFounderReviewCandidate(orgRow({}));
    expect(c.unresolvedReason).toBe("unknown");
    expect(c.unresolvedReasonLabel).toBe("Reason not recorded");
    expect(c.primaryActionLabel).toBe("Open the decision canvas");
  });

  it("an unrecognised reason string is unknown, not silently principle-gap", () => {
    const c = projectFounderReviewCandidate(orgRow({ unresolvedReason: "something-new" }));
    expect(c.unresolvedReason).toBe("unknown");
  });
});
