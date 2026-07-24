import { randomUUID } from "crypto";
import {
  DECISION_DOMAIN_CLASSES,
  DECISION_OUTCOME_TYPES,
  DECISION_RISK_TIERS,
  type DecisionDomainClass,
  type DecisionGateKey,
  type DecisionOutcomeType,
  type DecisionPerspectiveEvaluationResult,
  type DecisionRiskTier,
  type PerspectiveMaterialFreshness,
} from "./types";

type DecisionInteractionClient = {
  decisionInteraction: {
    findFirst?(args: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
      orderBy?: Record<string, string>;
    }): Promise<unknown>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export function createDecisionInteractionId(): string {
  return `DI-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

type PersistedDecisionInteractionRow = {
  interactionId: string;
  profileId: string;
  profileVersionId: string;
  fallbackProfileId?: string | null;
  domainClass?: string | null;
  question?: string | null;
  options?: unknown;
  evidenceBundle?: unknown;
  sources?: unknown;
  rationale?: string | null;
  riskTier?: string | null;
  confidenceBefore?: number | null;
  confidenceAfter?: number | null;
  outcomeType?: string | null;
  outcomePayload?: unknown;
  humanOutcome?: unknown;
  escalationCapture?: unknown;
};

const EMPTY_FRESHNESS_DISTRIBUTION: Record<PerspectiveMaterialFreshness, number> = {
  current: 0,
  stale: 0,
  superseded: 0,
  contradicted: 0,
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

function normalizeRiskTier(value: unknown): DecisionRiskTier {
  return typeof value === "string" && (DECISION_RISK_TIERS as readonly string[]).includes(value)
    ? value as DecisionRiskTier
    : "medium";
}

function normalizeFreshnessDistribution(value: unknown): Record<PerspectiveMaterialFreshness, number> {
  const record = asRecord(value);
  return {
    current: typeof record.current === "number" ? record.current : 0,
    stale: typeof record.stale === "number" ? record.stale : 0,
    superseded: typeof record.superseded === "number" ? record.superseded : 0,
    contradicted: typeof record.contradicted === "number" ? record.contradicted : 0,
  };
}

function normalizeSources(value: unknown): DecisionPerspectiveEvaluationResult["sources"] {
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

function interactionWasCleared(row: PersistedDecisionInteractionRow): boolean {
  const humanOutcome = asRecord(row.humanOutcome);
  return Boolean(row.escalationCapture && humanOutcome.clearsGate === true);
}

export function decisionInteractionRowToEvaluation(
  row: PersistedDecisionInteractionRow,
): DecisionPerspectiveEvaluationResult {
  const payload = asRecord(row.outcomePayload);
  const evidenceBundle = asRecord(row.evidenceBundle);
  const sources = normalizeSources(row.sources);
  const freshnessDistribution = normalizeFreshnessDistribution(
    payload.freshnessDistribution ?? evidenceBundle.freshnessDistribution ?? EMPTY_FRESHNESS_DISTRIBUTION,
  );
  const resolvedProfileChain = Array.isArray(payload.resolvedProfileChain)
    ? payload.resolvedProfileChain.filter((entry): entry is string => typeof entry === "string")
    : Array.isArray(evidenceBundle.resolvedProfileChain)
      ? evidenceBundle.resolvedProfileChain.filter((entry): entry is string => typeof entry === "string")
      : [row.profileId];
  const confidenceScore = typeof payload.confidenceScore === "number"
    ? payload.confidenceScore
    : typeof row.confidenceAfter === "number"
      ? row.confidenceAfter
      : 0;

  return {
    outcomeType: normalizeOutcomeType(row.outcomeType),
    selectedProfileId: row.profileId,
    fallbackProfileId: row.fallbackProfileId ?? null,
    profileVersionId: row.profileVersionId,
    confidenceBefore: typeof row.confidenceBefore === "number" ? row.confidenceBefore : confidenceScore,
    confidenceAfter: typeof row.confidenceAfter === "number" ? row.confidenceAfter : confidenceScore,
    confidenceScore,
    coverageGap: payload.coverageGap === true,
    principleConflict: payload.principleConflict === true,
    domainClass: normalizeDomainClass(row.domainClass ?? payload.domainClass),
    resolvedProfileChain,
    materialCount: typeof payload.materialCount === "number"
      ? payload.materialCount
      : typeof evidenceBundle.materialCount === "number"
        ? evidenceBundle.materialCount
        : sources.length,
    freshnessDistribution,
    riskTier: normalizeRiskTier(row.riskTier),
    question: row.question ?? "",
    options: Array.isArray(row.options) ? row.options.filter((entry): entry is string => typeof entry === "string") : [],
    rationale: row.rationale ?? "",
    materialScores: [],
    sources,
  };
}

export async function findExistingDecisionInteraction(input: {
  db: DecisionInteractionClient;
  build: { buildId: string };
  phaseFrom: string;
  phaseTo: string;
  profileVersionId: string;
}): Promise<{ interactionId: string; evaluation: DecisionPerspectiveEvaluationResult } | null> {
  if (!input.db.decisionInteraction.findFirst) return null;

  const row = await input.db.decisionInteraction.findFirst({
    where: {
      buildId: input.build.buildId,
      phaseFrom: input.phaseFrom,
      phaseTo: input.phaseTo,
      profileVersionId: input.profileVersionId,
    },
    include: { escalationCapture: true },
    orderBy: { createdAt: "desc" },
  }) as PersistedDecisionInteractionRow | null;

  if (!row || interactionWasCleared(row)) return null;
  return {
    interactionId: row.interactionId,
    evaluation: decisionInteractionRowToEvaluation(row),
  };
}

export async function persistDecisionInteraction(input: {
  db: DecisionInteractionClient;
  /** Optional: the build a decision belongs to. Omit for non-build (e.g. org/WWWD) decisions. */
  build?: { buildId: string } | null;
  evaluation: DecisionPerspectiveEvaluationResult;
  deliberationRunId?: string | null;
  taskRunId?: string | null;
  triggeredByUserId?: string | null;
  interactionId?: string;
  /** Defaults to "/build" (the Build Studio gate) when omitted. */
  routeContext?: string;
  /** Build-phase transition fields; default to plan->build when omitted, pass null for non-build decisions. */
  phaseFrom?: string | null;
  phaseTo?: string | null;
  /** Extra fields merged into outcomePayload (e.g. { orgProfileSelected }). */
  outcomePayloadExtra?: Record<string, unknown>;
  /**
   * Which gate produced this row (BI-1BE30A9A). The audit tier derives from
   * this rather than from the resolved profile kind, so a gate that fell back
   * to another kind's doctrine for material still audits under its own tier.
   * Omitted only by callers that predate the column.
   */
  gateKey?: DecisionGateKey;
  /** True when doctrine fell back off the gate's own profile kind. */
  gateFallbackUsed?: boolean;
}): Promise<{ interactionId: string; row: Record<string, unknown> }> {
  const interactionId = input.interactionId ?? createDecisionInteractionId();
  const row = await input.db.decisionInteraction.create({
    data: {
      interactionId,
      profileId: input.evaluation.selectedProfileId,
      profileVersionId: input.evaluation.profileVersionId,
      fallbackProfileId: input.evaluation.fallbackProfileId,
      buildId: input.build?.buildId ?? null,
      taskRunId: input.taskRunId ?? null,
      deliberationRunId: input.deliberationRunId ?? null,
      triggeredByUserId: input.triggeredByUserId ?? null,
      routeContext: input.routeContext ?? "/build",
      phaseFrom: input.phaseFrom === undefined ? "plan" : input.phaseFrom,
      phaseTo: input.phaseTo === undefined ? "build" : input.phaseTo,
      domainClass: input.evaluation.domainClass,
      question: input.evaluation.question,
      options: input.evaluation.options,
      scoredOptions: input.evaluation.scoredOptions ?? null,
      recommendedOptionId: input.evaluation.recommendedOptionId ?? null,
      evidenceBundle: {
        materialCount: input.evaluation.materialCount,
        freshnessDistribution: input.evaluation.freshnessDistribution,
        resolvedProfileChain: input.evaluation.resolvedProfileChain,
      },
      sources: input.evaluation.sources,
      rationale: input.evaluation.rationale,
      riskTier: input.evaluation.riskTier,
      confidenceBefore: input.evaluation.confidenceBefore,
      confidenceAfter: input.evaluation.confidenceAfter,
      outcomeType: input.evaluation.outcomeType,
      principleConflict: input.evaluation.principleConflict,
      gateKey: input.gateKey ?? null,
      gateFallbackUsed: input.gateFallbackUsed ?? false,
      outcomePayload: {
        outcomeType: input.evaluation.outcomeType,
        domainClass: input.evaluation.domainClass,
        confidenceScore: input.evaluation.confidenceScore,
        coverageGap: input.evaluation.coverageGap,
        principleConflict: input.evaluation.principleConflict,
        resolvedProfileChain: input.evaluation.resolvedProfileChain,
        materialCount: input.evaluation.materialCount,
        freshnessDistribution: input.evaluation.freshnessDistribution,
        ...(input.outcomePayloadExtra ?? {}),
      },
    },
  }) as Record<string, unknown>;

  return { interactionId, row };
}
