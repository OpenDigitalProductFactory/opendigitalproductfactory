// Scope-guided verdicts for probed candidates (BI-B8DAEB71, slice 2; spec
// AC-11, AC-14..AC-17).
//
// The owning scope decides: WWMD for platform harness, WWWD for a business
// room, WSID for craft. It scores KEEP_BASE and every probed variant on the
// features the probe measured, so the scope reasons over vectors, not prose.
// The hard rules still veto: an edit that raises human load is never ADOPT.
// When the scope cannot answer, the room records a kernel gap — the loop
// improves the doctrine store, so the same question is not asked of a person
// again — instead of writing an edit.

import type { ActionResult } from "@/lib/shared/action-result";

import { VARIANT_PREFERENCE, buildScopeOptions, type Assessment, type CandidateProbe, type ScopeOption, type VariantKey } from "./probe";
import { executorLayerOf, type DecisionScope } from "./room-candidates";

export type ScopeRecommendation = {
  interactionId: string | null;
  recommendedOptionId: string | null;
  confidence: string | null;
  autonomyBlockers: string[];
};

export type ScopeDecision = ActionResult<ScopeRecommendation>;

/** principle_decide, injected so the verdict is tested without the kernel. */
export type ScopeDecider = (args: {
  context: string;
  options: ScopeOption[];
  decisionDomain: "platform-development" | "org-business";
  callingPopulation: "in_platform_coworker";
  stakes: "routine";
}) => Promise<ScopeDecision>;

/** The principle_decide route for a scope. WSID is decided by evaluate_profession_decision, not wired here yet. */
export function scopeRouteFor(scope: DecisionScope): { decisionDomain: "platform-development" | "org-business" } | null {
  if (scope === "wwmd") return { decisionDomain: "platform-development" };
  if (scope === "wwwd") return { decisionDomain: "org-business" };
  return null;
}

export type HarnessVerdict = {
  candidateKey: string;
  verdict: "ADOPT" | "KEEP_BASE" | "KERNEL_GAP";
  variantKey: VariantKey | null;
  decisionScope: DecisionScope;
  decisionId: string | null;
  scopeRecommendation: string | null;
  reasons: string[];
  conditions: string[];
  /** Candidate minus baseline, for the chosen variant (zero for KEEP_BASE / KERNEL_GAP). */
  deltas: { completionRate: number; human: number; ai: number; code: number; tokens: number; refusalsPerSuccess: number; recoveryTurns: number };
  baseline: Assessment;
  chosen: Assessment | null;
  /** Every variant replayed, so the room shows what was tried and why each failed. */
  variants: Array<{ variantKey: VariantKey; pass: boolean; reasons: string[]; assessment: Assessment }>;
  replays: number;
  /** Target refusals per executor, and the layer the edit lands in: one executor's own, or the core when shared. */
  executors: Record<string, number>;
  executorLayer: string;
  kernelGap?: { reason: "no-recommendation" | "low-confidence" | "insufficient-signal" | "scope-route-unavailable"; question: string };
};

function deltaOf(baseline: Assessment, chosen: Assessment | null): HarnessVerdict["deltas"] {
  if (!chosen) return { completionRate: 0, human: 0, ai: 0, code: 0, tokens: 0, refusalsPerSuccess: 0, recoveryTurns: 0 };
  return {
    completionRate: chosen.outcome.completionRate - baseline.outcome.completionRate,
    human: chosen.load.human - baseline.load.human,
    ai: chosen.load.ai - baseline.load.ai,
    code: chosen.load.code - baseline.load.code,
    tokens: chosen.load.tokens - baseline.load.tokens,
    refusalsPerSuccess: chosen.gate.refusalsPerSuccess - baseline.gate.refusalsPerSuccess,
    recoveryTurns: chosen.gate.recoveryTurns - baseline.gate.recoveryTurns,
  };
}

export async function decideCandidateVerdict(input: {
  candidate: { candidateKey: string; capsuleId: string; decisionScope: DecisionScope; missKey: string };
  probe: CandidateProbe;
  decide: ScopeDecider;
}): Promise<HarnessVerdict> {
  const { candidate, probe } = input;
  const question = `Room ${candidate.capsuleId}: ${probe.target.toolName} is refused ${probe.target.code} repeatedly `
    + `(${probe.baseline.assessment.gate.refusals} refusals, ${probe.baseline.assessment.gate.recoveryTurns} recovery turns). `
    + "Which harness edit, if any, should this room adopt?";
  const base = {
    candidateKey: candidate.candidateKey,
    decisionScope: candidate.decisionScope,
    baseline: probe.baseline.assessment,
    variants: probe.variants.map((v) => ({ variantKey: v.variantKey, pass: v.judgement.pass, reasons: v.judgement.reasons, assessment: v.assessment })),
    replays: probe.replays,
    executors: probe.executors,
    executorLayer: executorLayerOf(probe.executors),
  };
  const keep = (reasons: string[], extra: Partial<HarnessVerdict> = {}): HarnessVerdict => ({
    ...base, verdict: "KEEP_BASE", variantKey: null, decisionId: null, scopeRecommendation: null,
    reasons, conditions: [], deltas: deltaOf(probe.baseline.assessment, null), chosen: null, ...extra,
  });
  const gap = (reason: NonNullable<HarnessVerdict["kernelGap"]>["reason"], extra: Partial<HarnessVerdict> = {}): HarnessVerdict => ({
    ...keep([`kernel-gap:${reason}`], extra), verdict: "KERNEL_GAP", kernelGap: { reason, question },
  });

  const route = scopeRouteFor(candidate.decisionScope);
  if (!route) return gap("scope-route-unavailable");

  const decision = await input.decide({
    context: question,
    options: buildScopeOptions(probe),
    decisionDomain: route.decisionDomain,
    callingPopulation: "in_platform_coworker",
    stakes: "routine",
  });
  if (!decision.ok) return keep(["scope-unavailable"]);

  const scope = decision.data;
  const recorded = { decisionId: scope.interactionId, scopeRecommendation: scope.recommendedOptionId };
  if (scope.autonomyBlockers.includes("insufficient_signal")) return gap("insufficient-signal", recorded);
  if (!scope.recommendedOptionId) return gap("no-recommendation", recorded);
  if (scope.confidence === "low") return gap("low-confidence", recorded);
  if (scope.recommendedOptionId === "keep-base") return keep(["scope-keeps-base"], recorded);

  const picked = probe.variants.find((v) => v.variantKey === scope.recommendedOptionId);
  if (!picked) return gap("no-recommendation", recorded);
  if (!picked.judgement.pass) return keep(["scope-pick-vetoed", ...picked.judgement.reasons], recorded);

  // Between gates of equal outcome, the one inside the tool wins, then a named next call, then a permit.
  const preferred = VARIANT_PREFERENCE
    .map((key) => probe.variants.find((v) => v.variantKey === key))
    .find((v) => v && v.judgement.pass
      && v.assessment.outcome.completionRate >= picked.assessment.outcome.completionRate
      && v.assessment.load.human <= picked.assessment.load.human)!;
  const chosen = preferred ?? picked;
  const conditions = [
    ...(chosen.encodedRuleCheck === "required-on-real-host" ? ["verify-encoded-rule-on-real-host"] : []),
    "adopt-through-governed-change",
  ];
  return {
    ...base,
    ...recorded,
    verdict: "ADOPT",
    variantKey: chosen.variantKey,
    reasons: chosen === picked ? [] : ["gate-preference"],
    conditions,
    deltas: deltaOf(probe.baseline.assessment, chosen.assessment),
    chosen: chosen.assessment,
  };
}
