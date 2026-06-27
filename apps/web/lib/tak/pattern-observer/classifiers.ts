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
const CAUTION_WINDOW_SHARE_THRESHOLD = 0.15;
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

function toolSurfaceEvidence(assessment: ToolSurfaceAssessment): Record<string, unknown> {
  return {
    toolCount: assessment.toolCount,
    estDefinitionTokens: assessment.estDefinitionTokens,
    windowShare: assessment.windowShare,
    zone: assessment.zone,
    exceedsLocalCliff: assessment.exceedsLocalCliff,
  };
}

function isNearLocalCliff(toolCount: number): boolean {
  return toolCount >= LOCAL_TOOL_SELECTION_CLIFF - NEAR_LOCAL_CLIFF_DISTANCE;
}

export function classifyToolSurfaceOverload(
  assessment: ToolSurfaceAssessment,
): CoworkerCapabilityNeedInput | null {
  if (assessment.zone === "overload" || assessment.exceedsLocalCliff) {
    return {
      kind: "tool",
      severity: "important",
      need: "Reduce or phase-scope the coworker's tool surface before local selection degrades.",
      blocks: "The current tool surface risks unreliable tool selection.",
      evidenceJson: toolSurfaceEvidence(assessment),
    };
  }

  const cautionIsActionable =
    assessment.zone === "caution" &&
    (isNearLocalCliff(assessment.toolCount) ||
      (assessment.windowShare !== null && assessment.windowShare >= CAUTION_WINDOW_SHARE_THRESHOLD));

  if (!cautionIsActionable) return null;

  return {
    kind: "tool",
    severity: "minor",
    need: "Trim or phase the caution-zone tool surface before it reaches overload.",
    blocks: "The tool surface is approaching the local selection cliff.",
    evidenceJson: toolSurfaceEvidence(assessment),
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
