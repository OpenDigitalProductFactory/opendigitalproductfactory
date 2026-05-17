import {
  DECISION_DOMAIN_CLASSES,
  DECISION_OUTCOME_TYPES,
  type DecisionDomainClass,
  type DecisionInteractionGateView,
  type DecisionOutcomeType,
} from "./types";

export const DECISION_INTERACTION_GATE_SELECT = {
  interactionId: true,
  profileId: true,
  profileVersionId: true,
  domainClass: true,
  outcomeType: true,
  confidenceBefore: true,
  confidenceAfter: true,
  principleConflict: true,
  rationale: true,
  sources: true,
  outcomePayload: true,
  evidenceBundle: true,
  createdAt: true,
  escalationCapture: { select: { id: true } },
  deferralCapture: { select: { id: true } },
} as const;

export type DecisionInteractionGateRow = {
  interactionId: string;
  profileId: string;
  profileVersionId: string;
  domainClass?: string | null;
  outcomeType?: string | null;
  confidenceBefore?: number | null;
  confidenceAfter?: number | null;
  principleConflict?: boolean | null;
  rationale?: string | null;
  sources?: unknown;
  outcomePayload?: unknown;
  evidenceBundle?: unknown;
  createdAt: Date;
  escalationCapture?: unknown;
  deferralCapture?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeDomainClass(value: unknown): DecisionDomainClass {
  return typeof value === "string" && (DECISION_DOMAIN_CLASSES as readonly string[]).includes(value)
    ? value as DecisionDomainClass
    : "plan-readiness";
}

function normalizeOutcomeType(value: unknown): DecisionOutcomeType {
  return typeof value === "string" && (DECISION_OUTCOME_TYPES as readonly string[]).includes(value)
    ? value as DecisionOutcomeType
    : "escalate";
}

function normalizeSources(value: unknown): DecisionInteractionGateView["sources"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const source = asRecord(entry);
      return typeof source.materialId === "string" && typeof source.sourceType === "string"
        ? {
          materialId: source.materialId,
          sourceType: source.sourceType,
          summary: typeof source.summary === "string" ? source.summary : "",
          effectiveWeight: typeof source.effectiveWeight === "number" ? source.effectiveWeight : 0,
        }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function decisionInteractionRowToGateView(row: null | undefined): null;
export function decisionInteractionRowToGateView(row: DecisionInteractionGateRow): DecisionInteractionGateView;
export function decisionInteractionRowToGateView(
  row: DecisionInteractionGateRow | null | undefined,
): DecisionInteractionGateView | null {
  if (!row) return null;

  const outcomePayload = asRecord(row.outcomePayload);
  const evidenceBundle = asRecord(row.evidenceBundle);
  const confidenceAfter = normalizeNumber(row.confidenceAfter);
  const confidenceBefore = normalizeNumber(row.confidenceBefore);
  const confidenceScore =
    normalizeNumber(outcomePayload.confidenceScore)
    ?? confidenceAfter
    ?? confidenceBefore
    ?? 0;
  const sources = normalizeSources(row.sources);
  const materialCount =
    normalizeNumber(outcomePayload.materialCount)
    ?? normalizeNumber(evidenceBundle.materialCount)
    ?? sources.length;

  return {
    interactionId: row.interactionId,
    profileId: row.profileId,
    profileVersionId: row.profileVersionId,
    domainClass: normalizeDomainClass(row.domainClass ?? outcomePayload.domainClass),
    outcomeType: normalizeOutcomeType(row.outcomeType),
    confidenceBefore,
    confidenceAfter,
    confidenceScore,
    materialCount,
    principleConflict: row.principleConflict === true || outcomePayload.principleConflict === true,
    rationale: row.rationale ?? null,
    createdAt: row.createdAt,
    sources,
    escalationCaptured: Boolean(row.escalationCapture),
    deferralCaptured: Boolean(row.deferralCapture),
  };
}
