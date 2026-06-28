import {
  COWORKER_CAPABILITY_NEED_KINDS,
  type CoworkerCapabilityNeedKind,
} from "@/lib/coworker-self-assessment/types";

export const WORK_PATTERN_STATUSES = [
  "observed",
  "candidate",
  "approved",
  "active",
  "retired",
] as const;
export type WorkPatternStatus = (typeof WORK_PATTERN_STATUSES)[number];

export const WORK_PATTERN_SCOPES = [
  "agent",
  "route",
  "skill",
  "build-phase",
  "activity",
  "risk-class",
  "case-type",
  "case-transition",
] as const;
export type WorkPatternScope = (typeof WORK_PATTERN_SCOPES)[number];

export const WORK_PATTERN_SOURCES = [
  "observer",
  "periodic-review",
  "human-review",
  "shadow-trial",
] as const;
export type WorkPatternSource = (typeof WORK_PATTERN_SOURCES)[number];

export const WORK_PATTERN_DECISION_SCOPES = [
  "platform-wwmd",
  "company-wwwd",
  "profession-wsid",
] as const;
export type WorkPatternDecisionScope = (typeof WORK_PATTERN_DECISION_SCOPES)[number];

export type WorkPatternEvidenceRef = {
  taskRunId?: string;
  toolExecutionId?: string;
  threadId?: string;
  agentMessageId?: string;
  improvementSignalId?: string;
  capabilityNeedId?: string;
  backlogItemId?: string;
  workCaseRef?: string;
  receiptId?: string;
  decisionInteractionId?: string;
};

export type WorkCasePatternBinding = {
  caseType?: string;
  transitionKey?: string;
  governedActionKey?: string;
  authorityMode?: "autonomous" | "on-behalf-of" | "authenticated-inbound";
  sponsorPrincipalId?: string;
  receiptPolicy?: "governed-action" | "observed-event";
};

export type WorkPatternCandidate = {
  kind: CoworkerCapabilityNeedKind;
  need: string;
  blocks: string;
  fingerprint: string;
  evaluationMethod?: string;
};

export type WorkPatternMetadata = {
  patternKey: string;
  status: WorkPatternStatus;
  scope: WorkPatternScope;
  version: number;
  source: WorkPatternSource;
  decisionScope: WorkPatternDecisionScope;
  evidence?: WorkPatternEvidenceRef[];
  candidate?: WorkPatternCandidate;
  workCaseBinding?: WorkCasePatternBinding;
  observedAt?: string;
};

export type WorkPatternReadiness = {
  readyForReview: boolean;
  readyForCaseActivation: boolean;
  blockers: string[];
};

const AUTHORITY_MODES = [
  "autonomous",
  "on-behalf-of",
  "authenticated-inbound",
] as const;
const RECEIPT_POLICIES = ["governed-action", "observed-event"] as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  options: T,
): value is T[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function parseOptionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

function parseEvidenceRef(value: unknown): WorkPatternEvidenceRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const evidence: WorkPatternEvidenceRef = {
    taskRunId: parseOptionalString(value.taskRunId),
    toolExecutionId: parseOptionalString(value.toolExecutionId),
    threadId: parseOptionalString(value.threadId),
    agentMessageId: parseOptionalString(value.agentMessageId),
    improvementSignalId: parseOptionalString(value.improvementSignalId),
    capabilityNeedId: parseOptionalString(value.capabilityNeedId),
    backlogItemId: parseOptionalString(value.backlogItemId),
    workCaseRef: parseOptionalString(value.workCaseRef),
    receiptId: parseOptionalString(value.receiptId),
    decisionInteractionId: parseOptionalString(value.decisionInteractionId),
  };
  return Object.values(evidence).some(Boolean) ? evidence : null;
}

function parseCandidate(value: unknown): WorkPatternCandidate | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!isOneOf(value.kind, COWORKER_CAPABILITY_NEED_KINDS)) {
    return null;
  }
  if (
    !isNonEmptyString(value.need) ||
    !isNonEmptyString(value.blocks) ||
    !isNonEmptyString(value.fingerprint)
  ) {
    return null;
  }
  return {
    kind: value.kind,
    need: value.need,
    blocks: value.blocks,
    fingerprint: value.fingerprint,
    evaluationMethod: parseOptionalString(value.evaluationMethod),
  };
}

function parseWorkCaseBinding(value: unknown): WorkCasePatternBinding | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.authorityMode !== undefined &&
    !isOneOf(value.authorityMode, AUTHORITY_MODES)
  ) {
    return null;
  }
  if (
    value.receiptPolicy !== undefined &&
    !isOneOf(value.receiptPolicy, RECEIPT_POLICIES)
  ) {
    return null;
  }

  return {
    caseType: parseOptionalString(value.caseType),
    transitionKey: parseOptionalString(value.transitionKey),
    governedActionKey: parseOptionalString(value.governedActionKey),
    authorityMode: isOneOf(value.authorityMode, AUTHORITY_MODES)
      ? value.authorityMode
      : undefined,
    sponsorPrincipalId: parseOptionalString(value.sponsorPrincipalId),
    receiptPolicy: isOneOf(value.receiptPolicy, RECEIPT_POLICIES)
      ? value.receiptPolicy
      : undefined,
  };
}

export function patternDecisionScope(scope: WorkPatternScope): WorkPatternDecisionScope {
  if (scope === "case-type" || scope === "case-transition") {
    return "company-wwwd";
  }
  if (scope === "activity" || scope === "risk-class") {
    return "profession-wsid";
  }
  return "platform-wwmd";
}

function hasEvidenceRef(metadata: WorkPatternMetadata): boolean {
  return Boolean(metadata.evidence?.length);
}

function hasCaseSourceReference(metadata: WorkPatternMetadata): boolean {
  return Boolean(
    metadata.evidence?.some((ref) =>
      Boolean(ref.workCaseRef || ref.receiptId || ref.decisionInteractionId),
    ),
  );
}

function isCaseBoundPattern(metadata: WorkPatternMetadata): boolean {
  return (
    metadata.scope === "case-type" ||
    metadata.scope === "case-transition" ||
    metadata.workCaseBinding !== undefined
  );
}

export function evaluatePatternReadiness(metadata: WorkPatternMetadata): WorkPatternReadiness {
  const blockers: string[] = [];
  const hasDecisionScope = isOneOf(metadata.decisionScope, WORK_PATTERN_DECISION_SCOPES);
  const hasEvidence = hasEvidenceRef(metadata);
  const caseBound = isCaseBoundPattern(metadata);
  const approvedForActivation = metadata.status === "approved" || metadata.status === "active";

  if (!hasEvidence) {
    blockers.push("missing-evidence");
  }
  if (!hasDecisionScope) {
    blockers.push("missing-decision-scope");
  }
  if (caseBound && !metadata.workCaseBinding?.governedActionKey) {
    blockers.push("missing-governed-action-key");
  }
  if (caseBound && !metadata.workCaseBinding?.receiptPolicy) {
    blockers.push("missing-receipt-policy");
  }
  if (caseBound && !hasCaseSourceReference(metadata)) {
    blockers.push("missing-case-source-reference");
  }
  if (!approvedForActivation) {
    blockers.push("pattern-status-not-approved-or-active");
  }

  const readyForReview = hasEvidence && hasDecisionScope;
  const caseActivationBlockers = new Set([
    "missing-evidence",
    "missing-decision-scope",
    "missing-governed-action-key",
    "missing-receipt-policy",
    "missing-case-source-reference",
    "pattern-status-not-approved-or-active",
  ]);
  const readyForCaseActivation =
    caseBound && blockers.every((blocker) => !caseActivationBlockers.has(blocker));

  return { readyForReview, readyForCaseActivation, blockers };
}

export function parseWorkPatternMetadata(value: unknown): WorkPatternMetadata | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isNonEmptyString(value.patternKey) ||
    !isOneOf(value.status, WORK_PATTERN_STATUSES) ||
    !isOneOf(value.scope, WORK_PATTERN_SCOPES) ||
    !isOneOf(value.source, WORK_PATTERN_SOURCES) ||
    typeof value.version !== "number" ||
    !Number.isFinite(value.version) ||
    value.version <= 0
  ) {
    return null;
  }

  const decisionScope =
    value.decisionScope === undefined
      ? patternDecisionScope(value.scope)
      : isOneOf(value.decisionScope, WORK_PATTERN_DECISION_SCOPES)
        ? value.decisionScope
        : null;
  if (!decisionScope) {
    return null;
  }

  const evidence = Array.isArray(value.evidence)
    ? value.evidence.map(parseEvidenceRef).filter((ref): ref is WorkPatternEvidenceRef => Boolean(ref))
    : undefined;
  const candidate =
    value.candidate === undefined ? undefined : parseCandidate(value.candidate);
  const workCaseBinding =
    value.workCaseBinding === undefined
      ? undefined
      : parseWorkCaseBinding(value.workCaseBinding);
  if (candidate === null || workCaseBinding === null) {
    return null;
  }

  return {
    patternKey: value.patternKey,
    status: value.status,
    scope: value.scope,
    version: value.version,
    source: value.source,
    decisionScope,
    evidence,
    candidate,
    workCaseBinding,
    observedAt: parseOptionalString(value.observedAt),
  };
}

export function mergeWorkPatternMetadata(
  existing: unknown,
  metadata: WorkPatternMetadata,
): Record<string, unknown> {
  const base = isRecord(existing) ? existing : {};
  return {
    ...base,
    workPattern: metadata,
  };
}

export function normalizePatternText(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  let end = normalized.length;
  while (end > 0 && normalized.charCodeAt(end - 1) === 46) end -= 1;
  return end === normalized.length ? normalized : normalized.slice(0, end);
}

export function workPatternFingerprint(input: {
  agentId: string;
  routeContext?: string | null;
  kind: string;
  normalizedNeed: string;
}): string {
  return [
    normalizePatternText(input.agentId),
    normalizePatternText(input.routeContext ?? "global"),
    normalizePatternText(input.kind),
    normalizePatternText(input.normalizedNeed),
  ].join("|");
}
