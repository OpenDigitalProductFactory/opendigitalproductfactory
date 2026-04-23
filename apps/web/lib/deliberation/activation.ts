// apps/web/lib/deliberation/activation.ts
// Task 4 — Deliberation activation policy (spec §7).
//
// Decision order:
//   1. Explicit invocation — if the caller named a pattern, honor it.
//   2. Risk escalation — high/critical => debate, medium => review.
//   3. Stage default — ideate/plan/review => review.
//   4. Otherwise return null (continue with single-agent flow).
//
// Strengthen-but-not-weaken rule: explicit invocation may add or strengthen
// deliberation, but cannot downgrade what stage/risk already require. Pattern
// strength order is `debate` > `review`. If explicit asks for review when
// risk forces debate, debate wins and the triggerSource is reported as
// "combined" so downstream telemetry and the user-facing reason both capture
// that an override occurred.

import type {
  DeliberationActivatedRiskLevel,
  DeliberationArtifactType,
  DeliberationDiversityMode,
  DeliberationStrategyProfile,
  DeliberationTriggerSource,
} from "./types";
import {
  isDeliberationDiversityMode,
  isDeliberationStrategyProfile,
} from "./types";
import { getPattern } from "./registry";
import type { ResolvedDeliberationPattern } from "./registry";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type DeliberationStage = "ideate" | "plan" | "build" | "review" | "ship";

export interface ResolveDeliberationInput {
  stage?: DeliberationStage;
  riskLevel: DeliberationActivatedRiskLevel;
  explicitPatternSlug?: string | null;
  artifactType: DeliberationArtifactType;
  routeContext?: string | null;
}

export interface ResolvedDeliberationRun {
  patternSlug: string;
  triggerSource: DeliberationTriggerSource;
  strategyProfile: DeliberationStrategyProfile;
  diversityMode: DeliberationDiversityMode;
  activatedRiskLevel: DeliberationActivatedRiskLevel | null;
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Pattern strength ordering                                                  */
/* -------------------------------------------------------------------------- */

const STRENGTH: Record<string, number> = {
  review: 1,
  debate: 2,
};

function strengthOf(slug: string): number {
  return STRENGTH[slug] ?? 0;
}

function stronger(a: string, b: string): string {
  return strengthOf(a) >= strengthOf(b) ? a : b;
}

/* -------------------------------------------------------------------------- */
/* Per-axis default resolvers                                                 */
/* -------------------------------------------------------------------------- */

function stageDefault(stage: DeliberationStage | undefined): string | null {
  if (!stage) return null;
  // Spec §7.3: ideate, plan, and review stages all default to review.
  // build and ship do not have a default deliberation.
  switch (stage) {
    case "ideate":
    case "plan":
    case "review":
      return "review";
    default:
      return null;
  }
}

function riskEscalation(
  risk: DeliberationActivatedRiskLevel,
): string | null {
  // Spec §7.4
  switch (risk) {
    case "high":
    case "critical":
      return "debate";
    case "medium":
      return "review";
    case "low":
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Strategy/diversity resolution                                              */
/* -------------------------------------------------------------------------- */

function resolveStrategy(pattern: ResolvedDeliberationPattern): {
  strategyProfile: DeliberationStrategyProfile;
  diversityMode: DeliberationDiversityMode;
} {
  const hints = pattern.providerStrategyHints ?? {};
  const rawProfile = (hints as Record<string, unknown>).strategyProfile;
  const rawDiversity = (hints as Record<string, unknown>).preferredDiversityMode;

  const strategyProfile: DeliberationStrategyProfile =
    isDeliberationStrategyProfile(rawProfile) ? rawProfile : "balanced";
  const diversityMode: DeliberationDiversityMode =
    isDeliberationDiversityMode(rawDiversity)
      ? rawDiversity
      : "single-model-multi-persona";

  return { strategyProfile, diversityMode };
}

/* -------------------------------------------------------------------------- */
/* Reason text                                                                */
/* -------------------------------------------------------------------------- */

function reasonFor(input: {
  slug: string;
  triggerSource: DeliberationTriggerSource;
  riskLevel: DeliberationActivatedRiskLevel;
  stage: DeliberationStage | undefined;
  explicitAttempted: string | null;
  overruledExplicit: boolean;
}): string {
  const { slug, triggerSource, riskLevel, stage, explicitAttempted, overruledExplicit } = input;
  const niceSlug = slug === "review" ? "peer review" : slug;

  if (overruledExplicit) {
    return `Escalated to ${niceSlug} — explicit request for ${explicitAttempted} was overridden by ${riskLevel}-risk policy.`;
  }
  if (triggerSource === "explicit") {
    return `Running ${niceSlug} because you explicitly requested it.`;
  }
  if (triggerSource === "risk") {
    if (riskLevel === "medium") {
      return `Added a ${niceSlug} pass because risk is medium and no stage default applied.`;
    }
    return `Escalated to ${niceSlug} because risk is ${riskLevel}.`;
  }
  if (triggerSource === "stage") {
    return `Peer review is the default for the ${stage ?? "current"} stage.`;
  }
  // combined — non-overrule path (explicit matches or strengthens)
  return `Running ${niceSlug} because you requested it and the ${stage ?? "current"}-stage/${riskLevel}-risk policy agrees.`;
}

/* -------------------------------------------------------------------------- */
/* Public resolver                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Decide whether deliberation runs for this piece of work and, if so, which
 * pattern. Pure policy: reads pattern metadata from the registry, never
 * writes. Returns null when no deliberation should fire — the caller falls
 * back to the single-agent flow.
 */
export async function resolve(
  input: ResolveDeliberationInput,
): Promise<ResolvedDeliberationRun | null> {
  const { stage, riskLevel, explicitPatternSlug, artifactType: _artifactType } = input;

  // Silence unused-var warning without losing the shape of the call-site.
  void _artifactType;

  // Gather the candidate patterns from each axis.
  const required = riskEscalation(riskLevel);   // forced by risk
  const defaulted = stageDefault(stage);        // forced by stage
  const explicit = explicitPatternSlug ? explicitPatternSlug.trim() : null;

  // Short-circuit: nothing wants deliberation.
  if (!required && !defaulted && !explicit) return null;

  // If the caller named a pattern, verify it exists. An unknown explicit
  // slug should not silently fall through to risk/stage — per spec §7 the
  // caller's intent is to trigger deliberation, so failing to find the
  // pattern is an input error and we return null.
  if (explicit) {
    const explicitPattern = await getPattern(explicit);
    if (!explicitPattern) return null;
  }

  // Determine the chosen slug by applying the strengthen-but-not-weaken rule.
  // Compare against the strongest of {risk, stage} — that is the minimum
  // permitted strength. If explicit is weaker than that minimum, the minimum
  // wins and we report triggerSource=combined.
  const axisRequired =
    required && defaulted ? stronger(required, defaulted) : required ?? defaulted;

  let chosen: string;
  let triggerSource: DeliberationTriggerSource;
  let overruledExplicit = false;

  if (explicit) {
    // Risk-based escalation is a requirement; stage defaults are only
    // suggestions. Explicit wins outright over a stage default when it is
    // same-or-stronger, but cannot weaken a risk-driven requirement.
    if (required) {
      const winner = stronger(explicit, required);
      chosen = winner;
      if (winner !== explicit) {
        // explicit was strictly weaker than the risk requirement.
        overruledExplicit = true;
        triggerSource = "combined";
      } else if (strengthOf(explicit) > strengthOf(required)) {
        // explicit is strictly stronger than what risk requires — both contributed.
        triggerSource = "combined";
      } else {
        // explicit matches the risk requirement — treat as the caller's intent.
        triggerSource = "explicit";
      }
    } else {
      // Only a stage default (or nothing) is in play — explicit wins outright.
      chosen = explicit;
      triggerSource = "explicit";
    }
  } else if (required && defaulted) {
    chosen = stronger(required, defaulted);
    // Risk is the stronger signal when both exist and risk wins.
    triggerSource = chosen === required ? "risk" : "stage";
  } else if (required) {
    chosen = required;
    triggerSource = "risk";
  } else {
    chosen = defaulted as string;
    triggerSource = "stage";
  }

  const pattern = await getPattern(chosen);
  if (!pattern) return null;

  const { strategyProfile, diversityMode } = resolveStrategy(pattern);

  const activatedRiskLevel: DeliberationActivatedRiskLevel | null =
    triggerSource === "stage" && riskLevel === "low" ? null : riskLevel;

  const reason = reasonFor({
    slug: chosen,
    triggerSource,
    riskLevel,
    stage,
    explicitAttempted: explicit,
    overruledExplicit,
  });

  return {
    patternSlug: chosen,
    triggerSource,
    strategyProfile,
    diversityMode,
    activatedRiskLevel,
    reason,
  };
}
