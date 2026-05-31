import { describe, expect, expectTypeOf, it } from "vitest";

import type { DecisionPerspectiveEvaluationResult } from "@/lib/decision-perspective/types";
import type { WikiPerspective } from "@/lib/wiki/perspective-intent";

import {
  fromDecisionInteractionRow,
  projectDecisionCanvas,
  sanitizeOperatorText,
  type DecisionCanvasContribution,
  type DecisionCanvasViewModel,
} from "./canvas";

function evaluation(
  overrides: Partial<DecisionPerspectiveEvaluationResult> = {},
): DecisionPerspectiveEvaluationResult {
  return {
    outcomeType: "recommend",
    selectedProfileId: "profile-mark",
    fallbackProfileId: null,
    profileVersionId: "version-1",
    confidenceBefore: 0.4,
    confidenceAfter: 0.82,
    confidenceScore: 0.82,
    coverageGap: false,
    principleConflict: false,
    domainClass: "architecture-tradeoff",
    resolvedProfileChain: ["profile-mark"],
    materialCount: 2,
    freshnessDistribution: {
      current: 2,
      stale: 0,
      superseded: 0,
      contradicted: 0,
    },
    riskTier: "medium",
    question: "How should we explain WWMD decisions?",
    options: ["Build projection service", "Add a new decision engine"],
    rationale:
      "WWMD recommends Build projection service because principle_decide found stronger architecture alignment.",
    materialScores: [
      {
        materialId: "PM-1",
        profileId: "profile-mark",
        sourceType: "principle",
        freshness: "current",
        confidenceWeight: 0.9,
        freshnessFactor: 1,
        evidenceFactor: 1,
        reviewFactor: 1,
        promotionFactor: 1,
        effectiveWeight: 0.9,
        exclusionReason: null,
      },
    ],
    sources: [
      {
        materialId: "PM-1",
        sourceType: "principle",
        summary: "Architecture over shortcuts",
        effectiveWeight: 0.9,
      },
    ],
    ...overrides,
  };
}

describe("sanitizeOperatorText", () => {
  it("removes raw tool and skill names from operator-facing prose", () => {
    expect(
      sanitizeOperatorText(
        "principle_decide used MCP via dpf-use-shared-nonprod-environment",
        "fallback",
      ),
    ).toBe(
      "the decision service used the decision service via the decision service",
    );
  });
});

describe("projectDecisionCanvas", () => {
  it("projects a recommended option, confidence, and audit ids", () => {
    const view = projectDecisionCanvas({
      interactionId: "DI-1",
      profileLabel: "WWMD Platform",
      perspective: "wwmd",
      evaluation: evaluation(),
      recommendedOption: "Build projection service",
      createdAt: new Date("2026-05-31T12:00:00.000Z"),
      routeContext: "codex-cli",
    });

    expect(view.header.interactionId).toBe("DI-1");
    expect(view.header.profileLabel).toBe("WWMD Platform");
    expect(view.header.perspective).toBe("wwmd");
    expect(view.header.createdAt).toBe("2026-05-31T12:00:00.000Z");
    expect(view.recommendation.state).toBe("recommended");
    expect(view.recommendation.recommendedOption).toBe(
      "Build projection service",
    );
    expect(view.recommendation.confidenceLabel).toBe("high");
    expect(view.options.find((option) => option.selected)?.id).toBe(
      "Build projection service",
    );
    expect(view.audit.materialIds).toEqual(["PM-1"]);
  });

  it("round-trips a persisted decision row through the canvas input adapter", () => {
    const direct = projectDecisionCanvas({
      interactionId: "DI-ROW",
      profileId: "profile-mark",
      profileLabel: "WWMD Platform",
      perspective: "wwmd",
      evaluation: evaluation(),
      createdAt: new Date("2026-05-31T12:00:00.000Z"),
      routeContext: "/build",
    });
    const viaRow = projectDecisionCanvas(
      fromDecisionInteractionRow({
        interactionId: "DI-ROW",
        profileId: "profile-mark",
        profileVersionId: "version-1",
        fallbackProfileId: null,
        domainClass: "architecture-tradeoff",
        question: "How should we explain WWMD decisions?",
        options: ["Build projection service", "Add a new decision engine"],
        evidenceBundle: {},
        sources: [
          {
            materialId: "PM-1",
            sourceType: "principle",
            summary: "Architecture over shortcuts",
            effectiveWeight: 0.9,
          },
        ],
        rationale:
          "WWMD recommends Build projection service because principle_decide found stronger architecture alignment.",
        riskTier: "medium",
        confidenceBefore: 0.4,
        confidenceAfter: 0.82,
        outcomeType: "recommend",
        outcomePayload: {
          confidenceScore: 0.82,
          materialCount: 2,
        },
        humanOutcome: null,
        createdAt: new Date("2026-05-31T12:00:00.000Z"),
        routeContext: "/build",
        profile: {
          profileId: "profile-mark",
          name: "WWMD Platform",
          kind: "platform",
        },
      }),
    );

    expect(viaRow.header).toEqual(direct.header);
    expect(viaRow.recommendation).toEqual(direct.recommendation);
    expect(viaRow.sources).toEqual(direct.sources);
  });

  it("uses the same projection shape for WWWD organization decisions", () => {
    const view = projectDecisionCanvas({
      profileId: "profile-org",
      profileLabel: "WWWD Organization",
      perspective: "wwwd",
      evaluation: evaluation({
        selectedProfileId: "profile-org",
        question: "Should we comp the customer?",
        options: ["Offer a credit", "Decline compensation"],
        rationale: "WWWD recommends Offer a credit based on customer promise material.",
      }),
      recommendedOption: "Offer a credit",
    });

    expect(view.header.profileId).toBe("profile-org");
    expect(view.header.profileLabel).toBe("WWWD Organization");
    expect(view.header.perspective).toBe("wwwd");
    expect(view.recommendation.recommendedOption).toBe("Offer a credit");
  });

  it("projects WWWD defer outcomes to owner review", () => {
    const view = projectDecisionCanvas({
      profileId: "profile-org",
      profileLabel: "WWWD Organization",
      perspective: "wwwd",
      evaluation: evaluation({
        selectedProfileId: "profile-org",
        outcomeType: "defer",
        confidenceScore: 0.22,
        coverageGap: true,
        question: "Should we change the service guarantee?",
        rationale: "No approved organization policy applies.",
      }),
    });

    expect(view.recommendation.state).toBe("deferred");
    expect(view.recommendation.nextActionLabel).toBe("Send to owner review");
  });

  it("projects WWMD defer outcomes as founder-review next actions without selecting an option", () => {
    const view = projectDecisionCanvas({
      perspective: "wwmd",
      evaluation: evaluation({
        outcomeType: "defer",
        confidenceScore: 0.2,
        coverageGap: true,
        gapReason: "no-applicable-material",
        rationale: "No approved material applies.",
      }),
      recommendedOption: "Build projection service",
    });

    expect(view.recommendation.state).toBe("deferred");
    expect(view.recommendation.recommendedOption).toBeNull();
    expect(view.recommendation.nextActionLabel).toBe("Send to founder review");
    expect(view.options.every((option) => option.selected === false)).toBe(true);
  });

  it("marks commandment conflicts as blocked", () => {
    const view = projectDecisionCanvas({
      evaluation: evaluation({
        principleConflict: true,
        rationale: "A commandment blocks the option.",
      }),
    });

    expect(view.recommendation.state).toBe("blocked");
    expect(view.recommendation.nextActionLabel).toBe(
      "Resolve blocker before continuing",
    );
  });

  it("splits positive and negative principle pulls by contribution", () => {
    const contributions: DecisionCanvasContribution[] = [
      {
        principleId: "P1",
        principleName: "Architecture over shortcuts",
        contribution: 0.7,
      },
      {
        principleId: "P2",
        principleName: "Responsible capacity utilization",
        contribution: -0.3,
      },
      {
        principleId: "P3",
        principleName: "No signal",
        contribution: 0,
      },
    ];

    const view = projectDecisionCanvas({
      evaluation: evaluation(),
      contributions,
    });

    expect(view.materialPulls.positive.map((item) => item.principleId)).toEqual([
      "P1",
    ]);
    expect(view.materialPulls.negative.map((item) => item.principleId)).toEqual([
      "P2",
    ]);
    expect(view.materialPulls.neutral.map((item) => item.principleId)).toEqual([
      "P3",
    ]);
    expect(view.principlePulls).toBe(view.materialPulls);
  });

  it("sanitizes default prose while preserving raw rationale in audit", () => {
    const view = projectDecisionCanvas({
      evaluation: evaluation(),
      recommendedOption: "Build projection service",
    });

    expect(view.recommendation.operatorMessage).not.toMatch(
      /mcp|principle_decide|dpf-/i,
    );
    expect(view.sources[0]?.summary).toBe("Architecture over shortcuts");
    expect(view.audit.rawRationale).toContain("principle_decide");
  });

  it("projects human override outcome separately from recommendation", () => {
    const view = projectDecisionCanvas({
      evaluation: evaluation(),
      recommendedOption: "Build projection service",
      humanOutcome: {
        chosenOption: "Add a new decision engine",
        rationale: "Mark chose to test the competing option.",
        overrodeRecommendation: true,
        recordedAt: "2026-05-31T14:00:00.000Z",
      },
    });

    expect(view.outcome.hasHumanOutcome).toBe(true);
    expect(view.outcome.overrodeRecommendation).toBe(true);
    expect(view.outcome.chosenOption).toBe("Add a new decision engine");
    expect(view.options.find((option) => option.humanSelected)?.id).toBe(
      "Add a new decision engine",
    );
  });

  // Reconciliation with PR #1343 (BI-F5179C9E): the canvas perspective field
  // must use the canonical WikiPerspective enum, not a sibling string union.
  // This type-only assertion catches any future redeclaration in code review
  // before it ships a second source of truth.
  it("types `header.perspective` as the canonical WikiPerspective | null", () => {
    expectTypeOf<DecisionCanvasViewModel["header"]["perspective"]>().toEqualTypeOf<
      WikiPerspective | null
    >();
  });

  it("infers seededFromWwmd for WWWD rows that resolved through a fallback profile chain", () => {
    const view = projectDecisionCanvas({
      perspective: "wwwd",
      evaluation: evaluation({
        selectedProfileId: "profile-org",
        resolvedProfileChain: ["profile-org", "profile-mark"],
      }),
    });

    expect(view.header.seededFromWwmd).toBe(true);
    expect(view.recommendation.caveat).toContain("Seeded from WWMD doctrine");
  });

  it("does not flag seededFromWwmd for a WWWD row with its own corpus", () => {
    const view = projectDecisionCanvas({
      perspective: "wwwd",
      evaluation: evaluation({
        selectedProfileId: "profile-org",
        resolvedProfileChain: ["profile-org"],
      }),
    });

    expect(view.header.seededFromWwmd).toBe(false);
    expect(view.recommendation.caveat).toBe("");
  });

  it("does not flag seededFromWwmd for WWMD rows", () => {
    const view = projectDecisionCanvas({
      perspective: "wwmd",
      evaluation: evaluation({
        resolvedProfileChain: ["profile-mark", "fallback-profile"],
      }),
    });

    expect(view.header.seededFromWwmd).toBe(false);
    expect(view.recommendation.caveat).toBe("");
  });

  it("honors an explicit seededFromWwmd override from the caller", () => {
    const view = projectDecisionCanvas({
      perspective: "wwwd",
      seededFromWwmd: true,
      evaluation: evaluation({
        selectedProfileId: "profile-org",
        resolvedProfileChain: ["profile-org"],
      }),
    });

    expect(view.header.seededFromWwmd).toBe(true);
    expect(view.recommendation.caveat).toContain("Seeded from WWMD doctrine");
  });

  // PR #1343 persona doctrine: coworkers must attribute Mark's recorded view
  // to Mark, never invent one. The canvas projection must not generate prose
  // mentioning Mark unless a backing source material id is preserved in audit.
  it("does not produce a 'Mark thinks…' attribution string in default prose without a backing material id", () => {
    const view = projectDecisionCanvas({
      perspective: "wwwd",
      profileLabel: "WWWD Organization",
      evaluation: evaluation({
        selectedProfileId: "profile-org",
        question: "Should we offer a refund?",
        rationale: "Customer-promise material recommends a refund.",
        materialScores: [],
        sources: [],
      }),
    });

    expect(view.recommendation.operatorMessage.toLowerCase()).not.toContain("mark thinks");
    expect(view.recommendation.operatorMessage.toLowerCase()).not.toContain("mark's view");
    expect(view.audit.materialIds).toEqual([]);
  });
});
