/**
 * Human-readable presentation for Operations Map routing internals
 * (BI-E3969A69).
 *
 * The Operations Map renders routing substrate ids raw — harness recipe keys
 * like `glm.center.summarize.provisional`, container image refs like
 * `docker.io/ai/qwen3.6:latest`, and bare confidence enums. Operators can't
 * act on those. This module is the pure translation layer: parse the ids,
 * say what they mean in the operator's language, and never throw — an
 * unparseable id falls back to being shown as a technical id.
 *
 * Pure and client-safe by design (no React, no server imports): the unified
 * topology canvas (three-band spec, Stage B–E) consumes this same module at
 * cutover, per the kernel decision recorded in
 * docs/superpowers/plans/2026-07-06-ops-map-digestibility-and-coworker-panel-honesty-plan.md.
 */

import { providerModelLabel } from "@/lib/agent/provider-model-label";
import type {
  ActivityClass,
  ActivityDistributionShape,
  ActivityRiskClass,
} from "@/lib/routing/activity-contract";
import type { OperationsMapActivitySuccessSignal } from "./types";

export type ActivityConfidence = "provisional" | "calibrating" | "trusted" | "degraded";

const DISTRIBUTION_SHAPES: ReadonlySet<string> = new Set(["center", "mixed", "edge"]);
const CONFIDENCE_TIERS: ReadonlySet<string> = new Set([
  "provisional",
  "calibrating",
  "trusted",
  "degraded",
]);
const ACTIVITY_CLASSES: ReadonlySet<string> = new Set([
  "classify",
  "summarize",
  "extract",
  "synthesize",
  "critique",
  "plan",
  "code-edit",
  "tool-act",
  "verify",
  "handoff",
]);

// ── Plain-language copy registries ──────────────────────────────────────────

/** What kind of work each activity class is, in operator words. */
export const ACTIVITY_CLASS_COPY: Record<ActivityClass, string> = {
  classify: "classification",
  summarize: "summarizing",
  extract: "data extraction",
  synthesize: "drafting & synthesis",
  critique: "review & critique",
  plan: "planning",
  "code-edit": "code editing",
  "tool-act": "tool actions",
  verify: "verification",
  handoff: "handoff",
};

/** Where the work sits on the routine↔novel spectrum. */
export const DISTRIBUTION_COPY: Record<ActivityDistributionShape, { label: string; description: string }> = {
  center: {
    label: "routine work",
    description: "Routine, well-understood work — safe ground for trialing cheaper models.",
  },
  mixed: {
    label: "mixed work",
    description: "A blend of routine and novel work.",
  },
  edge: {
    label: "hard/novel work",
    description: "Hard or novel work where the strongest models are used.",
  },
};

/** How much trust each harness confidence tier has earned, and what that means. */
export const CONFIDENCE_COPY: Record<ActivityConfidence, { label: string; description: string }> = {
  provisional: {
    label: "Trial",
    description: "Trial run — this model route is being evaluated and hasn't earned trust yet.",
  },
  calibrating: {
    label: "Calibrating",
    description: "Gathering outcome evidence to decide whether this route should be trusted.",
  },
  trusted: {
    label: "Trusted",
    description: "Proven route — outcomes have consistently met the bar.",
  },
  degraded: {
    label: "Degraded",
    description: "Recent outcomes fell below the bar — this route is being backed off.",
  },
};

/** Priority/risk chips (HIGH / LOW on the node cards). */
export const RISK_COPY: Record<ActivityRiskClass, { label: string; description: string }> = {
  low: { label: "Low stakes", description: "Mistakes here are cheap to catch and fix." },
  medium: { label: "Medium stakes", description: "Worth a second look, but not gating." },
  high: { label: "High stakes", description: "Errors here are costly — routed conservatively." },
  critical: { label: "Critical", description: "Must not fail — strongest route and checks apply." },
};

/** What each outcome signal means for the operator. */
export const SUCCESS_SIGNAL_COPY: Record<OperationsMapActivitySuccessSignal, { label: string; description: string }> = {
  valid: { label: "Succeeded", description: "Output passed validation." },
  accepted: { label: "Accepted", description: "Output was accepted downstream." },
  "review-passed": { label: "Review passed", description: "Output passed review." },
  failed: { label: "Failed", description: "This step failed and needs attention." },
  retried: { label: "Retried", description: "Needed at least one retry before settling." },
  attention: { label: "Needs attention", description: "Outcome was flagged for an employee look." },
  unknown: { label: "No outcome yet", description: "This route hasn't produced a recorded outcome." },
};

// ── Recipe key parsing ───────────────────────────────────────────────────────

export type ParsedRecipeKey = {
  providerFamily: string;
  distribution: ActivityDistributionShape;
  activity: ActivityClass;
  confidence: ActivityConfidence;
};

export type RecipeKeyPresentation = {
  /** Human sentence when the key parses; null when it doesn't. */
  label: string | null;
  /** Parsed parts when available. */
  parsed: ParsedRecipeKey | null;
  /** Always set: the raw key for the technical-details disclosure. */
  technicalId: string;
};

/**
 * Parse `<provider>.<distribution>.<activity>.<confidence>` — e.g.
 * `glm.center.summarize.provisional`. Returns null parts (never throws) for
 * anything that doesn't match the shape.
 */
export function parseHarnessRecipeKey(key: string | null | undefined): ParsedRecipeKey | null {
  const raw = (key ?? "").trim();
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [providerFamily, distribution, activity, confidence] = parts;
  if (!providerFamily) return null;
  if (!DISTRIBUTION_SHAPES.has(distribution)) return null;
  if (!ACTIVITY_CLASSES.has(activity)) return null;
  if (!CONFIDENCE_TIERS.has(confidence)) return null;
  return {
    providerFamily,
    distribution: distribution as ActivityDistributionShape,
    activity: activity as ActivityClass,
    confidence: confidence as ActivityConfidence,
  };
}

/**
 * Full presentation for a harness recipe key, optionally grounded by the
 * step's resolved provider/model ids (preferred for the model name).
 *
 *   ("glm.center.summarize.provisional", { providerId: "zai", modelId: "glm-5.2" })
 *   → "GLM 5.2 via Z.ai — trial recipe for summarizing (routine work)"
 */
export function presentRecipeKey(
  key: string | null | undefined,
  step?: { providerId?: string | null; modelId?: string | null },
): RecipeKeyPresentation {
  const technicalId = (key ?? "").trim();
  const parsed = parseHarnessRecipeKey(technicalId);
  if (!parsed) {
    return { label: null, parsed: null, technicalId };
  }
  const { label: modelLabel } = providerModelLabel(
    step?.providerId ?? parsed.providerFamily,
    step?.modelId ?? null,
  );
  const confidence = CONFIDENCE_COPY[parsed.confidence];
  const activity = ACTIVITY_CLASS_COPY[parsed.activity];
  const distribution = DISTRIBUTION_COPY[parsed.distribution];
  return {
    label: `${modelLabel} — ${confidence.label.toLowerCase()} recipe for ${activity} (${distribution.label})`,
    parsed,
    technicalId,
  };
}

// ── Model / container id shortening ─────────────────────────────────────────

/**
 * Shorten a container image ref to a human model name.
 *   "docker.io/ai/qwen3.6:latest" → "Qwen 3.6 (local container)"
 * Non-container ids pass through providerModelLabel-style prettifying by the
 * caller; this returns null when the id doesn't look like an image ref.
 */
export function shortenContainerImageRef(modelId: string | null | undefined): string | null {
  const raw = (modelId ?? "").trim();
  if (!raw || !raw.includes("/")) return null;
  const lastSegment = raw.split("/").pop() ?? "";
  const name = lastSegment.split(":")[0];
  if (!name) return null;
  // "qwen3.6" → "Qwen 3.6"; "llama3" → "Llama 3"; keep unknown shapes as-is.
  const match = name.match(/^([a-zA-Z][a-zA-Z-]*?)[-_]?(\d[\d.]*)?$/);
  if (!match) return `${name} (local container)`;
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  const version = match[2] ? ` ${match[2]}` : "";
  return `${family}${version} (local container)`;
}

/** Compact human label for a step's selected provider+model pair. */
export function presentModelRoute(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
): { label: string; technicalId: string | null } {
  const containerLabel = shortenContainerImageRef(modelId);
  if (containerLabel) {
    return { label: containerLabel, technicalId: modelId ?? null };
  }
  const { label, title } = providerModelLabel(providerId, modelId);
  return { label, technicalId: title === label ? null : title };
}

// ── Outcome evidence ─────────────────────────────────────────────────────────

/**
 * One honest sentence when there is no outcome evidence at all — replaces a
 * grid of four "Unknown" facts. Returns null when any real evidence exists
 * (caller renders the facts as before).
 */
export function emptyOutcomeEvidenceSummary(step: {
  successSignal: OperationsMapActivitySuccessSignal;
  routeDecisionId: string | null;
  tokenTotal: number | null;
  costUsd: number | null;
}): string | null {
  const hasEvidence =
    step.successSignal !== "unknown" ||
    step.routeDecisionId !== null ||
    step.tokenTotal !== null ||
    step.costUsd !== null;
  if (hasEvidence) return null;
  return "No outcome recorded yet — this route hasn't run.";
}
