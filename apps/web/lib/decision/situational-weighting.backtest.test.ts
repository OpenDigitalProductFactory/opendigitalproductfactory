// Back-test for the situational-aware decision weighting design.
// Spec: docs/superpowers/specs/2026-06-05-situational-aware-decision-weighting-design.md
//
// Drives the REAL decide() engine (the same one the principle_decide MCP
// handler imports via @/lib/wiki/principle-decide → ../decision/option-scoring).
//
// Two things are proven here:
//   1. The live-reproduced defect: in a normal quick-vs-proper decision the
//      kernel recommends the SHORTCUT, and promoting proper-fix-over-quick-fix
//      to a commandment (so its signed vector loads structurally at weight 1.0)
//      flips the recommendation to the proper fix with margin > tieMargin.
//   2. The rejected alternative: aggressive weight escalation on
//      architecture-over-shortcuts breaks the anti-maximalism guard (an
//      expensive rebuild beats a cheap-sound option), which is why Layer 1
//      promotes proper-fix instead of cranking weights.

import { describe, expect, it } from "vitest";
import { decide, type DecisionOption, type DecisionPrinciple } from "./option-scoring";

// ─── Real authored vectors (from the founder-kernel wiki frontmatter) ────────
const ARCHITECTURE_VECTOR = {
  long_term_maintainability: 1.0,
  schema_grounding: 0.7,
  speed_to_value: -0.4,
};
const PROPER_FIX_VECTOR = {
  long_term_maintainability: 0.9,
  schema_grounding: 0.5,
  blast_radius: -0.3,
  speed_to_value: -0.4,
};

// ─── Live ledger capture (mcp__dpf__principle_decide, 2026-06-05) ─────────────
// Per-commandment alignment on each option from the real call. We replay each
// commandment as a 1-dimensional "ledger" principle on a private axis so the
// real decide() reproduces the live composite exactly, while proper-fix is
// scored NATIVELY by decide() from its real multi-dim vector against the real
// option features below.
type Ledger = { name: string; quick: number; proper: number };
const LIVE_COMMANDMENT_LEDGER: Ledger[] = [
  { name: "All Changes Land via PR Against Main", quick: 0.6357142857142857, proper: 0.5142857142857143 },
  { name: "Architecture Over Shortcuts", quick: -0.009523809523809545, proper: 0.7071428571428571 },
  { name: "Build Gate (Mandatory)", quick: 0.6543478260869565, proper: 0.5130434782608696 },
  { name: "DCO Sign-Off Required on Every Commit", quick: 0.7333333333333333, proper: 0.3333333333333333 },
  { name: "Destructive actions require explicit go", quick: 0.36666666666666675, proper: 0.43000000000000005 },
  { name: "Do the work; don't task the operator", quick: 0.34090909090909094, proper: -0.0045454545454545366 },
  { name: "Human-in-the-Loop at Phase Boundaries", quick: 0.5333333333333333, proper: 0.15952380952380954 },
  { name: "Never Assume — Verify", quick: 0.07777777777777777, proper: 0.7777777777777777 },
  { name: "Never Fabricate", quick: 0.6921052631578948, proper: 0.5105263157894737 },
  { name: "Never ask the user to run commands", quick: 0.6607142857142858, proper: 0.41428571428571437 },
];
// Live core-tier contributions were all 0.000 (semantic mode), so they do not
// affect the composite and are omitted from the replay.

// Real option features as supplied to the live call.
const QUICK_FEATURES: Record<string, number> = {
  long_term_maintainability: 0.2, schema_grounding: 0.2, reusability: 0.2,
  blast_radius: 0.1, speed_to_value: 0.9, evidence_density: 0.85,
  governance_compliance: 0.85, public_safety: 0.5, human_cognitive_load: 0.3,
};
const PROPER_FEATURES: Record<string, number> = {
  long_term_maintainability: 0.95, schema_grounding: 0.85, reusability: 0.7,
  blast_radius: 0.55, speed_to_value: 0.15, evidence_density: 0.5,
  governance_compliance: 0.5, human_cognitive_load: 0.4,
};

/** A commandment that replays a known per-option alignment via a private axis. */
function ledgerPrinciple(l: Ledger, idx: number): DecisionPrinciple {
  const axis = `__ledger_${idx}`;
  return { id: l.name, name: l.name, tier: "commandment", weight: 1.0, dimensionVector: { [axis]: 1.0 } };
}
function withLedgerFeatures(base: Record<string, number>, pick: (l: Ledger) => number): Record<string, number> {
  const f = { ...base };
  LIVE_COMMANDMENT_LEDGER.forEach((l, i) => { f[`__ledger_${i}`] = pick(l); });
  return f;
}

function buildOptions(): [DecisionOption, DecisionOption] {
  return [
    { id: "quick-runtime-patch", description: "shortcut", features: withLedgerFeatures(QUICK_FEATURES, (l) => l.quick) },
    { id: "proper-seed-fix", description: "sound fix", features: withLedgerFeatures(PROPER_FEATURES, (l) => l.proper) },
  ];
}

const ledgerCommandments = LIVE_COMMANDMENT_LEDGER.map(ledgerPrinciple);

describe("situational weighting — Layer 1: promote proper-fix to commandment", () => {
  it("reproduces the live defect: the kernel recommends the SHORTCUT today", () => {
    const result = decide(buildOptions(), ledgerCommandments);
    expect(result.recommendation?.optionId).toBe("quick-runtime-patch");
    // Matches the live composites (4.685 vs 4.355) within float tolerance.
    const quick = result.scores.find((s) => s.optionId === "quick-runtime-patch")!;
    const proper = result.scores.find((s) => s.optionId === "proper-seed-fix")!;
    expect(quick.composite).toBeCloseTo(4.685, 2);
    expect(proper.composite).toBeCloseTo(4.355, 2);
  });

  it("promoting proper-fix to a commandment (structured, weight 1.0) flips it to the proper fix", () => {
    const promotedProperFix: DecisionPrinciple = {
      id: "proper-fix-over-quick-fix",
      name: "Proper Fix Over Quick Fix",
      tier: "commandment",
      weight: 1.0,
      dimensionVector: PROPER_FIX_VECTOR,
    };
    const result = decide(buildOptions(), [...ledgerCommandments, promotedProperFix]);
    expect(result.recommendation?.optionId).toBe("proper-seed-fix");
    expect(result.recommendation?.confidence).toBe("high");
    // proper ~4.858, quick ~4.633, margin ~0.225 > tieMargin 0.2.
    expect(result.recommendation!.margin).toBeGreaterThan(0.2);
  });
});

describe("situational weighting — rejected alternative: aggressive weight escalation causes maximalism", () => {
  // A cheap, sound, additive fix vs an expensive maximalist rebuild. NEITHER is
  // a shortcut. The cheap-sound option should not lose to the rebuild just
  // because the rebuild is marginally more "maintainable" and slower.
  const cheapSound: DecisionOption = {
    id: "cheap-sound-additive",
    description: "cheap sound additive fix",
    features: { long_term_maintainability: 0.85, schema_grounding: 0.8, blast_radius: 0.2, speed_to_value: 0.75 },
  };
  const expensiveRebuild: DecisionOption = {
    id: "expensive-rebuild",
    description: "expensive maximalist rebuild",
    features: { long_term_maintainability: 0.9, schema_grounding: 0.85, blast_radius: 0.95, speed_to_value: 0.05 },
  };

  function architectureAt(weight: number): DecisionPrinciple {
    return { id: "architecture-over-shortcuts", name: "Architecture Over Shortcuts", tier: "commandment", weight, dimensionVector: ARCHITECTURE_VECTOR };
  }

  const properFix: DecisionPrinciple = { id: "proper-fix", name: "Proper Fix", tier: "commandment", weight: 1.0, dimensionVector: PROPER_FIX_VECTOR };

  it("escalating architecture weight to ~2.75x makes the expensive rebuild win (maximalism)", () => {
    const result = decide([cheapSound, expensiveRebuild], [architectureAt(2.75)]);
    expect(result.recommendation?.optionId).toBe("expensive-rebuild");
  });

  it("maximalism is INTRINSIC to the soundness principles: architecture + proper-fix favor the rebuild even at weight 1.0", () => {
    // Both soundness principles reward maintainability and penalize speed, so
    // the bigger/slower rebuild scores higher on them regardless of weight.
    // Weight tuning cannot remove this — escalation only amplifies it. This is
    // why Layer 1 does NOT touch architecture's weight, and why the real
    // anti-maximalism fix is a cost dimension (Layer 2), not weighting.
    const result = decide([cheapSound, expensiveRebuild], [architectureAt(1.0), properFix]);
    expect(result.recommendation?.optionId).toBe("expensive-rebuild");
  });

  it("a cost_efficiency principle (Layer 2) flips it back to the cheap-sound option", () => {
    // The registry already defines cost_efficiency (PR #926) but no principle
    // scores it. Adding one lets the cheap option win on the merits.
    const cheapWithCost: DecisionOption = { ...cheapSound, features: { ...cheapSound.features, cost_efficiency: 0.9 } };
    const rebuildWithCost: DecisionOption = { ...expensiveRebuild, features: { ...expensiveRebuild.features, cost_efficiency: 0.2 } };
    const costSensitivity: DecisionPrinciple = { id: "prefer-cost-effective", name: "Prefer Cost-Effective Sound Solutions", tier: "commandment", weight: 1.5, dimensionVector: { cost_efficiency: 1.0 } };
    const result = decide([cheapWithCost, rebuildWithCost], [architectureAt(1.0), properFix, costSensitivity]);
    expect(result.recommendation?.optionId).toBe("cheap-sound-additive");
  });
});
