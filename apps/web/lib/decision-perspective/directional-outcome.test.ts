// BI-DEDAC950: each escalate branch of the WWWD directional ladder carries the
// governing principle's slug when a page states the rule, and nothing when no
// page does (those branches are in the unwritten-rule inventory).
import { describe, expect, it } from "vitest";

import {
  DIRECTIONAL_ESCALATION_PRINCIPLE,
  type DirectionalEscalationReason,
} from "@/lib/kernel/governing-principles";

import type { ProfileCoverage } from "./coverage-scoring";
import { contentAwareDirectionalOutcome, type DirectionalOutcomeInput } from "./directional-outcome";
import type { DecisionPerspectiveProfile } from "./types";

const profile = {
  autonomyPolicy: {
    minimumConfidenceForRecommendation: 0.6,
    minimumConfidenceForArbitration: 0.8,
    allowArbitration: true,
    maxRiskForArbitration: "medium",
  },
} as unknown as DecisionPerspectiveProfile;

function run(args: {
  alignment: ProfileCoverage["stanceAlignment"];
  confidence?: number;
  riskTier?: DirectionalOutcomeInput["input"]["riskTier"];
  relevanceMethod?: "semantic" | "lexical";
  settled?: boolean;
}) {
  return contentAwareDirectionalOutcome({
    baseResult: {} as DirectionalOutcomeInput["baseResult"],
    selectedCoverage: {
      contentAware: true,
      stanceAlignment: args.alignment,
      ...(args.settled ? { settledByRuling: { materialId: "m", relevance: 1 } } : {}),
    } as ProfileCoverage,
    selectedProfile: profile,
    confidence: args.confidence ?? 0.9,
    input: { riskTier: args.riskTier ?? "medium", relevanceMethod: args.relevanceMethod ?? "semantic" },
  });
}

const BRANCHES: Array<[DirectionalEscalationReason, Parameters<typeof run>[0]]> = [
  ["lexical-fallback", { alignment: "approve", relevanceMethod: "lexical" }],
  ["mixed-stance", { alignment: "mixed" }],
  ["critical-risk", { alignment: "approve", riskTier: "critical" }],
  ["below-confidence", { alignment: "none" }],
  ["aligned-not-settled", { alignment: "approve" }],
  ["high-risk", { alignment: "approve", riskTier: "high", settled: true }],
];

describe("directional escalations cite their governing principle", () => {
  it.each(BRANCHES)("%s escalates with its table citation", (reason, args) => {
    const result = run(args);
    expect(result?.outcomeType).toBe("escalate");
    const slug = DIRECTIONAL_ESCALATION_PRINCIPLE[reason];
    if (slug) expect(result?.principleSlug).toBe(slug);
    else expect(result).not.toHaveProperty("principleSlug");
  });

  it("cites the consult-scopes rule when the stance does not speak to the decision", () => {
    expect(run({ alignment: "none" })?.principleSlug).toBe("principles/consult-scopes-before-asking");
  });

  it("does not cite a principle on a recommend or arbitrate outcome", () => {
    expect(run({ alignment: "decline" })).not.toHaveProperty("principleSlug");
    expect(run({ alignment: "approve", settled: true })).not.toHaveProperty("principleSlug");
  });
});
