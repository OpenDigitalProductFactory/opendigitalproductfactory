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
  // BI-6DCF772F: which of the gate's scored options the human chose. Validated
  // server-side against the row's scoredOptions ids; populates chosenOptionId.
  chosenOptionId?: string;
};
