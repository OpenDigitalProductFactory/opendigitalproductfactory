import type { DecisionOutcomeType } from "./types";

export type DecisionCaptureOutcomeType = Extract<DecisionOutcomeType, "escalate" | "defer">;

export type DecisionGateCaptureDraft = {
  interactionId: string;
  outcomeType: DecisionCaptureOutcomeType;
  answer: string;
  criteriaText?: string;
  rationale?: string;
  objectionsResolvedText?: string;
  suggestedSourceTypesText?: string;
  candidateMaterial?: boolean;
};
