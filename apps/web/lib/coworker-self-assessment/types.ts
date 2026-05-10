export const COWORKER_ASSESSMENT_VERDICTS = ["adequate", "gaps", "blocked"] as const;
export type CoworkerAssessmentVerdict = (typeof COWORKER_ASSESSMENT_VERDICTS)[number];

export const COWORKER_ASSESSMENT_CONFIDENCE = ["high", "medium", "low"] as const;
export type CoworkerAssessmentConfidence = (typeof COWORKER_ASSESSMENT_CONFIDENCE)[number];

export const COWORKER_CAPABILITY_NEED_KINDS = [
  "tool",
  "skill",
  "grant",
  "model",
  "memory",
  "data",
  "ui_surface",
  "boundary",
] as const;
export type CoworkerCapabilityNeedKind = (typeof COWORKER_CAPABILITY_NEED_KINDS)[number];

export const COWORKER_CAPABILITY_NEED_SEVERITIES = [
  "blocker",
  "important",
  "minor",
] as const;
export type CoworkerCapabilityNeedSeverity =
  (typeof COWORKER_CAPABILITY_NEED_SEVERITIES)[number];

export const COWORKER_CAPABILITY_NEED_STATUSES = [
  "submitted",
  "reviewing",
  "accepted",
  "deferred",
  "duplicate",
  "discarded",
  "backlog-filed",
  "resolved",
] as const;
export type CoworkerCapabilityNeedStatus =
  (typeof COWORKER_CAPABILITY_NEED_STATUSES)[number];

export type JsonObject = Record<string, unknown>;

export type CoworkerCapabilityNeedInput = {
  kind: CoworkerCapabilityNeedKind;
  severity: CoworkerCapabilityNeedSeverity;
  need: string;
  blocks: string;
  evidenceJson?: JsonObject;
  readinessJson?: JsonObject;
};

export type SubmitCoworkerSelfAssessmentInput = {
  agentId: string;
  trigger: string;
  routeContext?: string | null;
  verdict: CoworkerAssessmentVerdict;
  confidence: CoworkerAssessmentConfidence;
  missionSummary?: string | null;
  capabilitySummary?: string | null;
  rawPayload?: JsonObject;
  needs: CoworkerCapabilityNeedInput[];
};

export type CoworkerNeedFilters = {
  agentId?: string;
  status?: CoworkerCapabilityNeedStatus;
  kind?: CoworkerCapabilityNeedKind;
  severity?: CoworkerCapabilityNeedSeverity;
};

export type ResolveCoworkerCapabilityNeedInput = {
  status: Exclude<CoworkerCapabilityNeedStatus, "backlog-filed">;
  duplicateOfId?: string;
  reviewerNote?: string;
};
