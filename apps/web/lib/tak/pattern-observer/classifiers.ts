import type { CoworkerCapabilityNeedInput } from "@/lib/coworker-self-assessment/types";
import type {
  ToolSelectionAccuracy,
  ToolSurfaceAssessment,
} from "@/lib/tak/context-economy-metrics";
import { LOCAL_TOOL_SELECTION_CLIFF } from "@/lib/tak/context-economy-metrics";

const DEFAULT_GRANT_DENIAL_THRESHOLD = 3;
const DEFAULT_REPEATED_SUCCESS_THRESHOLD = 3;
const MIN_SUCCESSFUL_WORKFLOW_ACCURACY = 0.9;
const MIN_HIGH_CEREMONY_SCORE = 0.75;
const NEAR_LOCAL_CLIFF_DISTANCE = 1;

const GRANT_DENIAL_PATTERNS = [
  /\bforbidden[_\s-]?grant\b/i,
  /\binsufficient_token_scope\b/i,
  /\bmissing\s+capability\b/i,
] as const;

export type GrantDenialSignal = {
  deniedTool: string;
  missingCapability?: string | null;
  denialMessages: readonly string[];
  threshold?: number;
};

export type RepeatedSuccessSignal = {
  workflowName: string;
  repetitionCount: number;
  threshold?: number;
  ceremonyScore: number;
  accuracy: ToolSelectionAccuracy;
};

function positiveThreshold(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function countGrantDenials(messages: readonly string[]): number {
  return messages.filter((message) =>
    GRANT_DENIAL_PATTERNS.some((pattern) => pattern.test(message)),
  ).length;
}

export function classifyGrantDenial(
  signal: GrantDenialSignal,
): CoworkerCapabilityNeedInput | null {
  const count = countGrantDenials(signal.denialMessages);
  const threshold = positiveThreshold(signal.threshold, DEFAULT_GRANT_DENIAL_THRESHOLD);
  if (count < threshold) return null;

  const missingCapability = signal.missingCapability?.trim() || "required grant";
  return {
    kind: "grant",
    severity: "important",
    need: `Grant ${missingCapability} so the coworker can use ${signal.deniedTool}.`,
    blocks: `Repeated denial blocked ${signal.deniedTool}.`,
    evidenceJson: {
      deniedTool: signal.deniedTool,
      missingCapability,
      count,
      threshold,
    },
  };
}

// Minimum executed tool-call sample before observed selection accuracy is
// trustworthy enough to CONFIRM or REFUTE a count-proxy overload prediction.
const MIN_SELECTION_SAMPLE_FOR_OVERLOAD = 3;

function toolSurfaceEvidence(
  assessment: ToolSurfaceAssessment,
  selection?: ToolSelectionAccuracy | null,
): Record<string, unknown> {
  return {
    toolCount: assessment.toolCount,
    estDefinitionTokens: assessment.estDefinitionTokens,
    windowShare: assessment.windowShare,
    zone: assessment.zone,
    exceedsLocalCliff: assessment.exceedsLocalCliff,
    ...(selection
      ? { observedSelectionAccuracy: selection.accuracy, observedSelectionSample: selection.total }
      : {}),
  };
}

function isNearLocalCliff(toolCount: number): boolean {
  return toolCount >= LOCAL_TOOL_SELECTION_CLIFF - NEAR_LOCAL_CLIFF_DISTANCE;
}

/** True only when there is a meaningful sample AND accuracy is below healthy —
 *  i.e. positive evidence that selection is actually degrading on this surface. */
function selectionIsDegraded(selection?: ToolSelectionAccuracy | null): boolean {
  if (!selection || selection.total < MIN_SELECTION_SAMPLE_FOR_OVERLOAD) return false;
  return selection.accuracy < MIN_SUCCESSFUL_WORKFLOW_ACCURACY;
}

export function classifyToolSurfaceOverload(
  assessment: ToolSurfaceAssessment,
  selection?: ToolSelectionAccuracy | null,
  /**
   * True when `assessment` was computed from the surface the runtime actually
   * ATTACHED (baseline + grants). False when it was reconstructed from executed
   * tools (the periodic-review fallback), which structurally omits every
   * attached-but-uncalled tool — including the ~68-tool read baseline — and so
   * is not a valid basis for an overload assertion (BI-98D17D0B). Defaults true
   * for callers that always pass a real attached surface.
   */
  surfaceReflectsAttached: boolean = true,
): CoworkerCapabilityNeedInput | null {
  const windowKnown = assessment.windowShare !== null;

  // An execution-derived surface omits the attached-but-uncalled baseline, so
  // its toolCount/definition-token estimate understates the real surface. Never
  // assert overload (or caution) from it — the count is measured against the
  // wrong denominator. Evidence-before-diagnosis: assess overload only from the
  // attached surface (BI-98D17D0B). The window-share path needs a live window
  // too, which the executions fallback never carries.
  if (!surfaceReflectsAttached) return null;

  // Two overload regimes, only one of which is self-evidently real:
  //  • window KNOWN and definitions crowd it (zone === "overload") — mechanistic
  //    evidence the surface eats the model's window; fire directly.
  //  • window UNKNOWN and past the raw-count local cliff — the cliff is only a
  //    PROXY for a small local window. Fire ONLY with corroborating evidence
  //    that tool selection is actually degrading. A large surface a model
  //    selects across accurately is not overloaded; asserting otherwise on the
  //    count alone mis-flagged every cloud-served coworker forever (BI-3346DC28).
  const knownOverload = windowKnown && assessment.zone === "overload";
  const proxyOverload = !windowKnown && assessment.exceedsLocalCliff;

  if (knownOverload || (proxyOverload && selectionIsDegraded(selection))) {
    return {
      kind: "tool",
      severity: "important",
      need: "Reduce or phase-scope the coworker's tool surface before local selection degrades.",
      blocks: "The current tool surface risks unreliable tool selection.",
      evidenceJson: toolSurfaceEvidence(assessment, selection),
    };
  }

  // A count-proxy overload we could not corroborate is SUPPRESSED (not
  // downgraded): asserting overload without evidence is exactly the recurring
  // false-positive this fixes. Evidence-before-diagnosis.
  if (proxyOverload) return null;

  // Caution is an early threshold, not proof of harm. File work only after a
  // real attached surface also shows degraded selection; otherwise the signal
  // stays telemetry and does not create low-evidence backlog churn.
  const cautionIsActionable =
    assessment.zone === "caution" &&
    (isNearLocalCliff(assessment.toolCount) || windowKnown) &&
    selectionIsDegraded(selection);

  if (!cautionIsActionable) return null;

  return {
    kind: "tool",
    severity: "minor",
    need: "Trim or phase the caution-zone tool surface before it reaches overload.",
    blocks: "The tool surface is approaching the local selection cliff.",
    evidenceJson: toolSurfaceEvidence(assessment, selection),
  };
}

export function classifyRepeatedSuccess(
  signal: RepeatedSuccessSignal,
): CoworkerCapabilityNeedInput | null {
  const threshold = positiveThreshold(signal.threshold, DEFAULT_REPEATED_SUCCESS_THRESHOLD);
  const isRepeated = signal.repetitionCount >= threshold;
  const isHighCeremony = signal.ceremonyScore >= MIN_HIGH_CEREMONY_SCORE;
  const isReliablySuccessful = signal.accuracy.accuracy >= MIN_SUCCESSFUL_WORKFLOW_ACCURACY;
  if (!isRepeated || !isHighCeremony || !isReliablySuccessful) return null;

  return {
    kind: "code",
    severity: "minor",
    need: `proceduralize the repeated successful ${signal.workflowName} workflow.`,
    blocks: "Manual ceremony is being repeated for a workflow that is already reliable.",
    evidenceJson: {
      workflowName: signal.workflowName,
      repetitionCount: signal.repetitionCount,
      threshold,
      ceremonyScore: signal.ceremonyScore,
      accuracy: signal.accuracy.accuracy,
      totalToolCalls: signal.accuracy.total,
      succeededToolCalls: signal.accuracy.succeeded,
    },
  };
}
