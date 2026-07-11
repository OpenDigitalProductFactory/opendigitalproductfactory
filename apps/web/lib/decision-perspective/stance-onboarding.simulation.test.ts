// Simulation evidence for the WWWD company-stance onboarding design (EP-0AF96937).
//
// Drives the REAL evaluator (evaluateDecisionPerspective) with (a) the corpus
// seedOrgWwwdCorpus produces today and (b) candidate "primed" corpora the
// stance-onboarding design would produce, across the three risk postures, over
// a scenario panel that includes the two live decisions that escalated to the
// founder on 2026-07-10:
//   - DI-C9F8B475B652  billing-error goodwill      (risk-assessment, medium) -> defer, 0 materials
//   - DI-A190B8B3FEB7  quality vs new offering     (plan-readiness,  low)    -> escalate @ 0.45
//
// The design question the numbers answer: which (evidenceGrade, confidenceWeight)
// a user-confirmed stance bundle must carry, per class, for the common decision
// classes to clear the gate — and which cases stay escalated by construction
// (high/critical risk; unconfirmed defaults).

import { describe, expect, it } from "vitest";
import { evaluateDecisionPerspective } from "./evaluator";
import type {
  DecisionDomainClass,
  DecisionPerspectiveProfile,
  DecisionRiskTier,
  PerspectiveEvidenceGrade,
  PerspectiveMaterial,
} from "./types";

const ORG_PROFILE_ID = "org-perspective-sim";

function orgProfile(posture: "conservative" | "balanced" | "progressive"): DecisionPerspectiveProfile {
  // Mirrors riskEnvelopeToAutonomyPolicy (lib/govern/risk-posture.ts).
  const policies = {
    conservative: {
      allowRecommendation: true,
      allowArbitration: false,
      maxRiskForArbitration: "low" as const,
      minimumConfidenceForRecommendation: 0.65,
      minimumConfidenceForArbitration: 0.95,
    },
    balanced: {
      allowRecommendation: true,
      allowArbitration: false,
      maxRiskForArbitration: "low" as const,
      minimumConfidenceForRecommendation: 0.55,
      minimumConfidenceForArbitration: 0.9,
    },
    progressive: {
      allowRecommendation: true,
      allowArbitration: true,
      maxRiskForArbitration: "medium" as const,
      minimumConfidenceForRecommendation: 0.5,
      minimumConfidenceForArbitration: 0.8,
    },
  };
  return {
    profileId: ORG_PROFILE_ID,
    name: "Simulated org perspective",
    kind: "organization",
    scope: { domains: ["plan-readiness"] },
    fallbackProfileId: null,
    defaultResolver: { type: "build-studio-owner" },
    autonomyPolicy: policies[posture],
    currentVersion: {
      versionId: `${ORG_PROFILE_ID}-v1`,
      versionNumber: 1,
      materialFingerprint: "sim",
      changeSummary: "sim",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  };
}

let seq = 0;
function material(input: {
  domainClass: DecisionDomainClass;
  grade: PerspectiveEvidenceGrade;
  weight: number;
}): PerspectiveMaterial {
  seq += 1;
  return {
    materialId: `sim-${input.domainClass}-${seq}`,
    profileId: ORG_PROFILE_ID,
    sourceType: "stance",
    sourceRef: {},
    summary: `sim ${input.domainClass}`,
    domainClass: input.domainClass,
    direction: "support",
    domains: [input.domainClass],
    freshness: "current",
    evidenceGrade: input.grade,
    confidenceWeight: input.weight,
    reviewStatus: "approved",
    promotionState: "promoted",
    lastValidatedAt: new Date("2026-07-01T00:00:00.000Z"),
  };
}

const ALL_CLASSES: DecisionDomainClass[] = [
  "plan-readiness",
  "architecture-tradeoff",
  "risk-assessment",
  "professional-practice",
];

type CorpusName =
  | "current-seed"
  | "primed-unconfirmed"
  | "primed-confirmed-a85"
  | "primed-confirmed-a90"
  | "primed-confirmed-a100"
  | "primed-mixed-drag";

/** Candidate corpora the onboarding design could produce. */
function corpus(name: CorpusName): PerspectiveMaterial[] {
  switch (name) {
    case "current-seed":
      // seedOrgWwwdCorpus today: 4 pages, all plan-readiness, B/0.6.
      return Array.from({ length: 4 }, () =>
        material({ domainClass: "plan-readiness", grade: "B", weight: 0.6 }),
      );
    case "primed-unconfirmed":
      // Archetype-default vector bundles across all classes, not yet confirmed.
      return ALL_CLASSES.flatMap((domainClass) => [
        material({ domainClass, grade: "B", weight: 0.6 }),
        material({ domainClass, grade: "B", weight: 0.6 }),
      ]);
    case "primed-confirmed-a85":
      return ALL_CLASSES.flatMap((domainClass) => [
        material({ domainClass, grade: "A", weight: 0.85 }),
        material({ domainClass, grade: "A", weight: 0.85 }),
      ]);
    case "primed-confirmed-a90":
      return ALL_CLASSES.flatMap((domainClass) => [
        material({ domainClass, grade: "A", weight: 0.9 }),
        material({ domainClass, grade: "A", weight: 0.9 }),
      ]);
    case "primed-confirmed-a100":
      return ALL_CLASSES.flatMap((domainClass) => [
        material({ domainClass, grade: "A", weight: 1.0 }),
        material({ domainClass, grade: "A", weight: 1.0 }),
      ]);
    case "primed-mixed-drag":
      // A confirmed A/1.0 stance coexisting with unconfirmed B/0.6 defaults in
      // the SAME class — shows the mean-based formula dragging the class down.
      return ALL_CLASSES.flatMap((domainClass) => [
        material({ domainClass, grade: "A", weight: 1.0 }),
        material({ domainClass, grade: "B", weight: 0.6 }),
        material({ domainClass, grade: "B", weight: 0.6 }),
      ]);
  }
}

type Scenario = {
  id: string;
  question: string;
  domainClass: DecisionDomainClass;
  riskTier: DecisionRiskTier;
};

const SCENARIOS: Scenario[] = [
  {
    id: "billing-goodwill (DI-C9F8B475B652)",
    question:
      "A long-time customer subscription lapsed because of a billing error on our side. Restore access and waive the lapsed period, or require re-subscription?",
    domainClass: "risk-assessment",
    riskTier: "medium",
  },
  {
    id: "quality-vs-offering (DI-A190B8B3FEB7)",
    question:
      "Should we prioritize fixing quality issues for existing customers over launching a new offering this month?",
    domainClass: "plan-readiness",
    riskTier: "low",
  },
  {
    id: "small-refund",
    question: "Customer asks for a refund on a $40 order that arrived late. Refund, credit, or decline?",
    domainClass: "risk-assessment",
    riskTier: "low",
  },
  {
    id: "service-quality-call",
    question: "A job finished under time budget but below our usual finish standard. Redo it at our cost?",
    domainClass: "professional-practice",
    riskTier: "low",
  },
  {
    id: "tooling-buy-vs-build",
    question: "Adopt a paid scheduling tool or keep the manual process for now?",
    domainClass: "architecture-tradeoff",
    riskTier: "low",
  },
  {
    id: "large-contract (safety invariant)",
    question: "Sign a 3-year exclusive supplier contract at 20% below market?",
    domainClass: "risk-assessment",
    riskTier: "high",
  },
];

function run(name: CorpusName, posture: "conservative" | "balanced" | "progressive", s: Scenario) {
  return evaluateDecisionPerspective({
    profile: orgProfile(posture),
    fallbackProfiles: [],
    materials: corpus(name),
    question: s.question,
    questionDomain: s.domainClass,
    options: ["option-a", "option-b"],
    riskTier: s.riskTier,
    recentOverrideCount: 0,
    evidence: [],
  });
}

describe("stance-onboarding simulation: current seed reproduces the live escalations", () => {
  it("quality-vs-offering escalates at exactly 0.45 (the live DI-A190B8B3FEB7 confidence)", () => {
    const r = run("current-seed", "balanced", SCENARIOS[1]);
    expect(r.outcomeType).toBe("escalate");
    expect(r.confidenceScore).toBe(0.45);
    expect(r.gapReason).toBe("material-below-confidence");
  });

  it("billing-goodwill hits a coverage gap (the live DI-C9F8B475B652 defer)", () => {
    const r = run("current-seed", "balanced", SCENARIOS[0]);
    expect(r.outcomeType).toBe("defer");
    expect(r.coverageGap).toBe(true);
    expect(r.materialCount).toBe(0);
  });
});

describe("stance-onboarding simulation: primed corpora", () => {
  it("prints the full outcome matrix (design evidence)", () => {
    const names: CorpusName[] = [
      "current-seed",
      "primed-unconfirmed",
      "primed-confirmed-a85",
      "primed-confirmed-a90",
      "primed-confirmed-a100",
      "primed-mixed-drag",
    ];
    const postures = ["conservative", "balanced", "progressive"] as const;
    const rows: string[] = [];
    for (const name of names) {
      for (const posture of postures) {
        for (const s of SCENARIOS) {
          const r = run(name, posture, s);
          rows.push(
            [
              name.padEnd(22),
              posture.padEnd(13),
              s.id.padEnd(38),
              `${s.domainClass}/${s.riskTier}`.padEnd(28),
              r.outcomeType.padEnd(10),
              String(r.confidenceScore),
            ].join(" | "),
          );
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\n${rows.join("\n")}\n`);
    if (process.env.SIM_MATRIX_OUT) {
      // Design-evidence escape hatch: the repo vitest config swallows console
      // output, so allow dumping the matrix to a file when asked.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").writeFileSync(process.env.SIM_MATRIX_OUT, `${rows.join("\n")}\n`);
    }
    expect(rows.length).toBeGreaterThan(0);
  });

  it("unconfirmed archetype defaults alone never clear the gate (confirmation is the lever)", () => {
    for (const posture of ["conservative", "balanced", "progressive"] as const) {
      for (const s of SCENARIOS) {
        const r = run("primed-unconfirmed", posture, s);
        expect(["escalate", "defer"]).toContain(r.outcomeType);
      }
    }
  });

  it("confirmed A/0.85 bundles clear every LOW-risk scenario under every posture", () => {
    const lowRisk = SCENARIOS.filter((s) => s.riskTier === "low");
    for (const posture of ["conservative", "balanced", "progressive"] as const) {
      for (const s of lowRisk) {
        const r = run("primed-confirmed-a85", posture, s);
        // recommend or arbitrate — both are gate-clearing (allowed) outcomes.
        expect(["recommend", "arbitrate"], `${posture}/${s.id}`).toContain(r.outcomeType);
      }
    }
  });

  it("medium risk (the billing case) needs A/0.9 + progressive arbitration OR a perfect A/1.0 set", () => {
    const billing = SCENARIOS[0];
    // A/0.85: conf 0.75 -> escalates everywhere at medium.
    expect(run("primed-confirmed-a85", "progressive", billing).outcomeType).toBe("escalate");
    // A/0.9 + progressive (arbitration to medium at >=0.8): conf 0.8 -> arbitrate.
    expect(run("primed-confirmed-a90", "progressive", billing).outcomeType).toBe("arbitrate");
    // A/0.9 + balanced: conf 0.8 < 0.9 -> still escalates (no arbitration).
    expect(run("primed-confirmed-a90", "balanced", billing).outcomeType).toBe("escalate");
    // A/1.0 (perfect set): conf 0.9 -> recommend even under balanced.
    expect(run("primed-confirmed-a100", "balanced", billing).outcomeType).toBe("recommend");
  });

  it("mixing confirmed A/1.0 with unconfirmed B/0.6 defaults in one class DRAGS the class below the gate", () => {
    // mean = (1.0 + 0.45 + 0.45) / 3 = 0.6333 -> below the 0.7 recommend band even at low risk.
    const r = run("primed-mixed-drag", "balanced", SCENARIOS[1]);
    expect(r.outcomeType).toBe("escalate");
    expect(r.confidenceScore).toBeLessThan(0.7);
  });

  it("SAFETY INVARIANT: high-risk decisions always escalate, no matter how primed the corpus", () => {
    const highRisk = SCENARIOS[5];
    for (const name of ["primed-confirmed-a100", "primed-confirmed-a90"] as CorpusName[]) {
      for (const posture of ["conservative", "balanced", "progressive"] as const) {
        const r = run(name, posture, highRisk);
        expect(r.outcomeType, `${name}/${posture}`).toBe("escalate");
      }
    }
  });
});
