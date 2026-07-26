import { prisma } from "@dpf/db";

import {
  COWORKER_CAPABILITY_NEED_KINDS,
  type CoworkerCapabilityNeedKind,
} from "@/lib/coworker-self-assessment/types";
import type { AutonomyLevel, RiskClass } from "@/lib/autonomy/trust-graduation";
import {
  WORK_PATTERN_DECISION_SCOPES,
  evaluatePatternReadiness,
  parseWorkPatternMetadata,
  patternDecisionScope,
  type WorkPatternCandidate,
  type WorkPatternDecisionScope,
  type WorkPatternEvidenceRef,
  type WorkPatternReadiness,
  type WorkPatternScope,
  type WorkPatternSource,
  type WorkPatternStatus,
} from "./work-pattern-types";
import {
  evaluateWorkPatternShadowEvidence,
  parseAutonomyLevel,
  parseLegacyWorkPatternShadowTrials,
  parseRiskClass,
  type WorkPatternShadowEvaluation,
  type WorkPatternShadowTrial,
} from "./work-pattern-shadow-evaluation";
import {
  parseWorkPatternReviewState,
  type WorkPatternActivationCandidate,
  type WorkPatternReviewState,
} from "./work-pattern-review";
import type { WorkPatternCaseStagingState } from "./work-pattern-case-staging";

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_TAKE = 200;

const OPEN_NEED_STATUSES = new Set(["submitted", "reviewing", "accepted", "backlog-filed"]);
const FAILED_RUN_STATUSES = new Set(["failed", "canceled", "rejected"]);

export type WorkPatternReadModelTaskRunRow = {
  taskRunId: string;
  currentAgentId?: string | null;
  initiatingAgentId?: string | null;
  routeContext?: string | null;
  title?: string | null;
  status?: string | null;
  repeatedPatternKey?: string | null;
  a2aMetadata?: unknown;
  createdAt?: Date | null;
  completedAt?: Date | null;
};

export type WorkPatternReadModelNeedRow = {
  needId: string;
  agentId: string;
  kind: string;
  severity: string;
  status: string;
  need: string;
  blocks: string;
  evidenceJson?: unknown;
  readinessJson?: unknown;
  linkedBacklogItemId?: string | null;
  duplicateOfId?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  assessment?: {
    routeContext?: string | null;
    trigger?: string | null;
    createdAt?: Date | null;
  } | null;
};

export type WorkPatternReadModelQuery = {
  agentId: string;
  routeContext?: string | null;
  since: Date;
  until: Date;
  take: number;
};

export type WorkPatternReadModelDb = {
  listTaskRuns(query: WorkPatternReadModelQuery): Promise<WorkPatternReadModelTaskRunRow[]>;
  listCapabilityNeeds(query: WorkPatternReadModelQuery): Promise<WorkPatternReadModelNeedRow[]>;
};

export type GetWorkPatternReadModelInput = {
  agentId: string;
  routeContext?: string | null;
  since?: Date;
  until?: Date;
  now?: Date;
  windowDays?: number;
  take?: number;
};

export type WorkPatternSummary = {
  patternKey: string;
  agentId: string;
  routeContext: string | null;
  riskClass: string | null;
  status: WorkPatternStatus;
  scope: WorkPatternScope;
  version: number;
  source: WorkPatternSource;
  decisionScope: WorkPatternDecisionScope;
  observedRuns: number;
  completedRuns: number;
  failedRuns: number;
  outcomeCounts: Record<string, number>;
  latestObservedAt: Date | null;
  latestTaskRunId: string | null;
  evidenceRefs: WorkPatternEvidenceRef[];
  candidate: WorkPatternCandidate | null;
  candidateNeedKinds: CoworkerCapabilityNeedKind[];
  linkedNeedIds: string[];
  openNeedCount: number;
  readiness: WorkPatternReadiness;
  activationProposed: boolean;
  reviewState: WorkPatternReviewState | null;
  activationCandidate: WorkPatternActivationCandidate | null;
  caseStaging: WorkPatternCaseStagingState | null;
  shadowEvaluation: WorkPatternShadowEvaluation | null;
};

export type WorkPatternReadModel = {
  generatedAt: Date;
  window: {
    since: Date;
    until: Date;
  };
  summary: {
    totalPatterns: number;
    totalObservedRuns: number;
    openNeedCount: number;
    readyForReviewCount: number;
    candidateOnlyCount: number;
  };
  patterns: WorkPatternSummary[];
};

type SummaryAccumulator = Omit<
  WorkPatternSummary,
  "candidateNeedKinds" | "linkedNeedIds" | "evidenceRefs" | "shadowEvaluation"
> & {
  candidateNeedKinds: Set<CoworkerCapabilityNeedKind>;
  linkedNeedIds: Set<string>;
  evidenceRefs: Map<string, WorkPatternEvidenceRef>;
  shadowTrials: WorkPatternShadowTrial[];
  shadowCurrentLevel: AutonomyLevel | null;
  shadowRegulatoryCeiling: AutonomyLevel | null;
  shadowRiskClass: RiskClass | null;
};

type PatternSeed = {
  patternKey: string;
  agentId: string;
  routeContext: string | null;
  riskClass: string | null;
  status: WorkPatternStatus;
  scope: WorkPatternScope;
  version: number;
  source: WorkPatternSource;
  decisionScope: WorkPatternDecisionScope;
  candidate: WorkPatternCandidate | null;
  readiness: WorkPatternReadiness;
  activationProposed: boolean;
};

function defaultDb(): WorkPatternReadModelDb {
  return {
    listTaskRuns: (query) =>
      prisma.taskRun.findMany({
        where: {
          OR: [{ currentAgentId: query.agentId }, { initiatingAgentId: query.agentId }],
          ...(query.routeContext ? { routeContext: query.routeContext } : {}),
          createdAt: { gte: query.since, lte: query.until },
        },
        orderBy: { createdAt: "desc" },
        take: query.take,
        select: {
          taskRunId: true,
          currentAgentId: true,
          initiatingAgentId: true,
          routeContext: true,
          title: true,
          status: true,
          repeatedPatternKey: true,
          a2aMetadata: true,
          createdAt: true,
          completedAt: true,
        },
      }) as Promise<WorkPatternReadModelTaskRunRow[]>,
    listCapabilityNeeds: (query) =>
      prisma.coworkerCapabilityNeed.findMany({
        where: {
          agentId: query.agentId,
          ...(query.routeContext
            ? { assessment: { routeContext: query.routeContext } }
            : {}),
          createdAt: { gte: query.since, lte: query.until },
        },
        orderBy: { createdAt: "desc" },
        take: query.take,
        select: {
          needId: true,
          agentId: true,
          kind: true,
          severity: true,
          status: true,
          need: true,
          blocks: true,
          evidenceJson: true,
          readinessJson: true,
          linkedBacklogItemId: true,
          duplicateOfId: true,
          createdAt: true,
          updatedAt: true,
          assessment: {
            select: {
              routeContext: true,
              trigger: true,
              createdAt: true,
            },
          },
        },
      }) as Promise<WorkPatternReadModelNeedRow[]>,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(source: unknown, field: string): string | null {
  if (!isRecord(source)) return null;
  const value = source[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringArrayField(source: unknown, field: string): string[] {
  if (!isRecord(source)) return [];
  const value = source[field];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function booleanField(source: unknown, field: string): boolean | null {
  if (!isRecord(source)) return null;
  const value = source[field];
  return typeof value === "boolean" ? value : null;
}

function dateFrom(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveQuery(input: GetWorkPatternReadModelInput): WorkPatternReadModelQuery {
  const until = input.until ?? input.now ?? new Date();
  const windowDays = positiveNumber(input.windowDays, DEFAULT_WINDOW_DAYS);
  const since =
    input.since ?? new Date(until.getTime() - windowDays * 24 * 60 * 60 * 1000);
  return {
    agentId: input.agentId,
    routeContext: input.routeContext ?? null,
    since,
    until,
    take: positiveNumber(input.take, DEFAULT_TAKE),
  };
}

function workPatternFromMetadata(value: unknown) {
  if (!isRecord(value)) return null;
  return parseWorkPatternMetadata(value.workPattern);
}

function riskClassFromMetadata(value: unknown): string | null {
  return stringField(value, "riskClass");
}

function fallbackReadiness(): WorkPatternReadiness {
  return {
    readyForReview: true,
    readyForCaseActivation: false,
    blockers: ["pattern-status-not-approved-or-active"],
  };
}

function fallbackSeed(input: {
  patternKey: string;
  agentId: string;
  routeContext: string | null;
  riskClass: string | null;
}): PatternSeed {
  return {
    patternKey: input.patternKey,
    agentId: input.agentId,
    routeContext: input.routeContext,
    riskClass: input.riskClass,
    status: "observed",
    scope: input.routeContext ? "route" : "agent",
    version: 1,
    source: "observer",
    decisionScope: input.routeContext ? patternDecisionScope("route") : patternDecisionScope("agent"),
    candidate: null,
    readiness: fallbackReadiness(),
    activationProposed: false,
  };
}

function seedFromTaskRun(row: WorkPatternReadModelTaskRunRow, agentId: string): PatternSeed | null {
  const metadata = workPatternFromMetadata(row.a2aMetadata);
  const effectiveAgentId = row.currentAgentId ?? row.initiatingAgentId ?? agentId;
  const routeContext = row.routeContext ?? null;
  const riskClass = riskClassFromMetadata(row.a2aMetadata);
  if (metadata) {
    return {
      patternKey: metadata.patternKey,
      agentId: effectiveAgentId,
      routeContext,
      riskClass,
      status: metadata.status,
      scope: metadata.scope,
      version: metadata.version,
      source: metadata.source,
      decisionScope: metadata.decisionScope,
      candidate: metadata.candidate ?? null,
      readiness: evaluatePatternReadiness(metadata),
      activationProposed: false,
    };
  }

  if (!row.repeatedPatternKey) return null;
  return fallbackSeed({
    patternKey: row.repeatedPatternKey,
    agentId: effectiveAgentId,
    routeContext,
    riskClass,
  });
}

function knownKind(value: string): CoworkerCapabilityNeedKind {
  return COWORKER_CAPABILITY_NEED_KINDS.includes(value as CoworkerCapabilityNeedKind)
    ? (value as CoworkerCapabilityNeedKind)
    : "other";
}

function knownDecisionScope(value: string | null): WorkPatternDecisionScope | null {
  return WORK_PATTERN_DECISION_SCOPES.includes(value as WorkPatternDecisionScope)
    ? (value as WorkPatternDecisionScope)
    : null;
}

function readinessFromNeed(row: WorkPatternReadModelNeedRow): WorkPatternReadiness {
  const blockers = stringArrayField(row.readinessJson, "blockers");
  return {
    readyForReview: booleanField(row.readinessJson, "readyForReview") ?? Boolean(row.need),
    readyForCaseActivation:
      booleanField(row.readinessJson, "readyForCaseActivation") ?? false,
    blockers:
      blockers.length > 0 ? blockers : ["pattern-status-not-approved-or-active"],
  };
}

function autonomyLevelFromNeed(
  row: WorkPatternReadModelNeedRow,
  field: string,
): AutonomyLevel | null {
  return (
    parseAutonomyLevel(stringField(row.evidenceJson, field)) ??
    parseAutonomyLevel(stringField(row.readinessJson, field))
  );
}

function shadowRiskClassFromNeed(row: WorkPatternReadModelNeedRow): RiskClass | null {
  return (
    parseRiskClass(stringField(row.evidenceJson, "shadowRiskClass")) ??
    parseRiskClass(stringField(row.readinessJson, "shadowRiskClass")) ??
    parseRiskClass(stringField(row.evidenceJson, "riskClass")) ??
    parseRiskClass(stringField(row.readinessJson, "riskClass"))
  );
}

function shadowTrialsFromNeed(row: WorkPatternReadModelNeedRow): WorkPatternShadowTrial[] {
  return parseLegacyWorkPatternShadowTrials(row.evidenceJson, row.readinessJson);
}

function seedFromNeed(row: WorkPatternReadModelNeedRow): PatternSeed | null {
  const patternKey =
    stringField(row.evidenceJson, "patternKey") ?? stringField(row.readinessJson, "patternKey");
  if (!patternKey) return null;
  const routeContext = row.assessment?.routeContext ?? null;
  const scope: WorkPatternScope = routeContext ? "route" : "agent";
  const kind = knownKind(row.kind);
  return {
    patternKey,
    agentId: row.agentId,
    routeContext,
    riskClass: stringField(row.evidenceJson, "riskClass"),
    status: "candidate",
    scope,
    version: 1,
    source: "observer",
    decisionScope:
      knownDecisionScope(stringField(row.evidenceJson, "decisionScope")) ??
      patternDecisionScope(scope),
    candidate: {
      kind,
      need: row.need,
      blocks: row.blocks,
      fingerprint:
        stringField(row.evidenceJson, "fingerprint") ??
        `${row.agentId}|${kind}|${row.need}`,
      evaluationMethod:
        stringField(row.evidenceJson, "evaluationMethod") ??
        "capability-need-review",
    },
    readiness: readinessFromNeed(row),
    activationProposed: booleanField(row.readinessJson, "activationProposed") ?? false,
  };
}

function groupKey(seed: Pick<PatternSeed, "patternKey" | "agentId" | "routeContext" | "riskClass">): string {
  return [seed.patternKey, seed.agentId, seed.routeContext ?? "", seed.riskClass ?? ""].join("\u001f");
}

function createAccumulator(seed: PatternSeed): SummaryAccumulator {
  return {
    patternKey: seed.patternKey,
    agentId: seed.agentId,
    routeContext: seed.routeContext,
    riskClass: seed.riskClass,
    status: seed.status,
    scope: seed.scope,
    version: seed.version,
    source: seed.source,
    decisionScope: seed.decisionScope,
    observedRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    outcomeCounts: {},
    latestObservedAt: null,
    latestTaskRunId: null,
    evidenceRefs: new Map(),
    candidate: seed.candidate,
    candidateNeedKinds: seed.candidate ? new Set([seed.candidate.kind]) : new Set(),
    linkedNeedIds: new Set(),
    openNeedCount: 0,
    readiness: seed.readiness,
    activationProposed: seed.activationProposed,
    reviewState: null,
    activationCandidate: null,
    caseStaging: null,
    shadowTrials: [],
    shadowCurrentLevel: null,
    shadowRegulatoryCeiling: null,
    shadowRiskClass: null,
  };
}

function getOrCreate(
  summaries: Map<string, SummaryAccumulator>,
  seed: PatternSeed,
): SummaryAccumulator {
  const key = groupKey(seed);
  const existing = summaries.get(key);
  if (existing) {
    if (!existing.candidate && seed.candidate) existing.candidate = seed.candidate;
    existing.activationProposed = existing.activationProposed || seed.activationProposed;
    if (seed.readiness.blockers.length < existing.readiness.blockers.length) {
      existing.readiness = seed.readiness;
    }
    return existing;
  }
  const created = createAccumulator(seed);
  summaries.set(key, created);
  return created;
}

function findCompatibleSummaryForNeed(
  summaries: Map<string, SummaryAccumulator>,
  seed: PatternSeed,
): SummaryAccumulator | null {
  for (const summary of summaries.values()) {
    if (
      summary.patternKey !== seed.patternKey ||
      summary.agentId !== seed.agentId ||
      summary.routeContext !== seed.routeContext
    ) {
      continue;
    }
    if (seed.riskClass && summary.riskClass !== seed.riskClass) {
      continue;
    }
    return summary;
  }
  return null;
}

function evidenceKey(ref: WorkPatternEvidenceRef): string {
  return [
    ref.taskRunId ?? "",
    ref.toolExecutionId ?? "",
    ref.threadId ?? "",
    ref.agentMessageId ?? "",
    ref.capabilityNeedId ?? "",
    ref.backlogItemId ?? "",
    ref.workCaseRef ?? "",
    ref.receiptId ?? "",
    ref.decisionInteractionId ?? "",
  ].join("|");
}

function addEvidence(summary: SummaryAccumulator, refs: readonly WorkPatternEvidenceRef[]): void {
  for (const ref of refs) {
    const key = evidenceKey(ref);
    if (key.replaceAll("|", "").length === 0) continue;
    summary.evidenceRefs.set(key, ref);
  }
}

function metadataEvidence(row: WorkPatternReadModelTaskRunRow): WorkPatternEvidenceRef[] {
  const metadata = workPatternFromMetadata(row.a2aMetadata);
  const refs = metadata?.evidence?.length ? [...metadata.evidence] : [];
  if (refs.length === 0) {
    refs.push({ taskRunId: row.taskRunId });
  }
  return refs;
}

function needEvidence(row: WorkPatternReadModelNeedRow): WorkPatternEvidenceRef[] {
  const refs: WorkPatternEvidenceRef[] = [];
  const direct: WorkPatternEvidenceRef = {
    taskRunId: stringField(row.evidenceJson, "taskRunId") ?? undefined,
    toolExecutionId: stringField(row.evidenceJson, "toolExecutionId") ?? undefined,
    threadId: stringField(row.evidenceJson, "threadId") ?? undefined,
    agentMessageId: stringField(row.evidenceJson, "agentMessageId") ?? undefined,
    improvementSignalId: stringField(row.evidenceJson, "improvementSignalId") ?? undefined,
    capabilityNeedId: row.needId,
    backlogItemId: row.linkedBacklogItemId ?? undefined,
    workCaseRef: stringField(row.evidenceJson, "workCaseRef") ?? undefined,
    receiptId: stringField(row.evidenceJson, "receiptId") ?? undefined,
    decisionInteractionId: stringField(row.evidenceJson, "decisionInteractionId") ?? undefined,
  };
  refs.push(direct);
  for (const taskRunId of stringArrayField(row.evidenceJson, "taskRunIds")) {
    refs.push({ taskRunId, capabilityNeedId: row.needId });
  }
  for (const toolExecutionId of stringArrayField(row.evidenceJson, "toolExecutionIds")) {
    refs.push({ toolExecutionId, capabilityNeedId: row.needId });
  }
  return refs;
}

function maxDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return right.getTime() > left.getTime() ? right : left;
}

function reviewTimestamp(review: WorkPatternReviewState): number {
  const timestamp = Date.parse(review.reviewedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function newerReview(
  left: WorkPatternReviewState | null,
  right: WorkPatternReviewState,
): WorkPatternReviewState {
  if (!left) return right;
  return reviewTimestamp(right) >= reviewTimestamp(left) ? right : left;
}

function observeRun(summary: SummaryAccumulator, row: WorkPatternReadModelTaskRunRow): void {
  const status = row.status ?? "unknown";
  summary.observedRuns += 1;
  summary.outcomeCounts[status] = (summary.outcomeCounts[status] ?? 0) + 1;
  if (status === "completed") summary.completedRuns += 1;
  if (FAILED_RUN_STATUSES.has(status)) summary.failedRuns += 1;

  const metadataObservedAt = workPatternFromMetadata(row.a2aMetadata)?.observedAt;
  const observedAt =
    row.completedAt ??
    row.createdAt ??
    dateFrom(metadataObservedAt) ??
    null;
  const latest = maxDate(summary.latestObservedAt, observedAt);
  if (latest !== summary.latestObservedAt) {
    summary.latestObservedAt = latest;
    summary.latestTaskRunId = row.taskRunId;
  }
  addEvidence(summary, metadataEvidence(row));
}

function attachNeed(summary: SummaryAccumulator, row: WorkPatternReadModelNeedRow): void {
  const kind = knownKind(row.kind);
  const reviewState = parseWorkPatternReviewState(row.readinessJson);
  summary.candidateNeedKinds.add(kind);
  summary.linkedNeedIds.add(row.needId);
  if (OPEN_NEED_STATUSES.has(row.status)) {
    summary.openNeedCount += 1;
  }
  if (!summary.candidate) {
    summary.candidate = seedFromNeed(row)?.candidate ?? null;
  }
  if (reviewState) {
    summary.reviewState = newerReview(summary.reviewState, reviewState);
    summary.activationCandidate = summary.reviewState.activationCandidate;
    summary.caseStaging = summary.reviewState.caseStaging ?? null;
    summary.activationProposed = Boolean(summary.activationCandidate);
    addEvidence(summary, [{
      capabilityNeedId: row.needId,
      decisionInteractionId: reviewState.decisionInteractionId,
    }]);
  } else {
    summary.activationProposed =
      summary.activationProposed ||
      (booleanField(row.readinessJson, "activationProposed") ?? false);
  }
  summary.shadowTrials.push(...shadowTrialsFromNeed(row));
  summary.shadowCurrentLevel =
    summary.shadowCurrentLevel ?? autonomyLevelFromNeed(row, "currentAutonomyLevel");
  summary.shadowRegulatoryCeiling =
    summary.shadowRegulatoryCeiling ?? autonomyLevelFromNeed(row, "regulatoryCeiling");
  summary.shadowRiskClass =
    summary.shadowRiskClass ?? shadowRiskClassFromNeed(row);
  addEvidence(summary, needEvidence(row));
}

function serializeSummary(summary: SummaryAccumulator): WorkPatternSummary {
  const {
    candidateNeedKinds,
    evidenceRefs,
    linkedNeedIds,
    shadowCurrentLevel,
    shadowRegulatoryCeiling,
    shadowRiskClass,
    shadowTrials,
    ...base
  } = summary;
  const shadowEvaluation =
    shadowTrials.length > 0
      ? evaluateWorkPatternShadowEvidence({
          trials: shadowTrials,
          currentLevel: shadowCurrentLevel,
          regulatoryCeiling: shadowRegulatoryCeiling,
          riskClass: shadowRiskClass,
        })
      : null;

  return {
    ...base,
    evidenceRefs: [...evidenceRefs.values()],
    candidateNeedKinds: [...candidateNeedKinds].sort(),
    linkedNeedIds: [...linkedNeedIds].sort(),
    shadowEvaluation,
  };
}

function sortSummaries(left: WorkPatternSummary, right: WorkPatternSummary): number {
  if (left.openNeedCount !== right.openNeedCount) {
    return right.openNeedCount - left.openNeedCount;
  }
  const leftTime = left.latestObservedAt?.getTime() ?? 0;
  const rightTime = right.latestObservedAt?.getTime() ?? 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return left.patternKey.localeCompare(right.patternKey);
}

export async function getWorkPatternReadModel(
  input: GetWorkPatternReadModelInput,
  deps?: { db?: WorkPatternReadModelDb },
): Promise<WorkPatternReadModel> {
  const query = resolveQuery(input);
  const db = deps?.db ?? defaultDb();
  const [taskRuns, needs] = await Promise.all([
    db.listTaskRuns(query),
    db.listCapabilityNeeds(query),
  ]);

  const summaries = new Map<string, SummaryAccumulator>();
  for (const row of taskRuns) {
    const seed = seedFromTaskRun(row, query.agentId);
    if (!seed) continue;
    observeRun(getOrCreate(summaries, seed), row);
  }
  for (const row of needs) {
    const seed = seedFromNeed(row);
    if (!seed) continue;
    attachNeed(findCompatibleSummaryForNeed(summaries, seed) ?? getOrCreate(summaries, seed), row);
  }

  const patterns = [...summaries.values()].map(serializeSummary).sort(sortSummaries);
  return {
    generatedAt: query.until,
    window: {
      since: query.since,
      until: query.until,
    },
    summary: {
      totalPatterns: patterns.length,
      totalObservedRuns: patterns.reduce((sum, item) => sum + item.observedRuns, 0),
      openNeedCount: patterns.reduce((sum, item) => sum + item.openNeedCount, 0),
      readyForReviewCount: patterns.filter((item) => item.readiness.readyForReview).length,
      candidateOnlyCount: patterns.filter((item) => item.observedRuns === 0).length,
    },
    patterns,
  };
}
