import { err, ok, type ActionResult } from "@/lib/shared/action-result";

import { evidenceKindMetadata, isExecutionEvidenceKind } from "../execution-evidence";
import type { ReadinessEvidenceState } from "./types";

export type ObjectiveReconciliationActivity = {
  id: string;
  kind: string;
  recordedAt: Date;
  payload: unknown;
  backlogItemId?: string;
};

export type ObjectiveReconciliationResult = {
  state: ReadinessEvidenceState | "conflict";
  baselineId: string | null;
  evidenceRefs: string[];
  requiredStatementIds: string[];
};

type Baseline = {
  baselineId: string;
  supersedesBaselineId: string | null;
  artifactDigest: string;
  recordedAt: Date;
  statementIds: string[];
};

export const MAX_OBJECTIVE_MAPPING_EVIDENCE_ACTIVITIES = 500;

export function objectiveEvidenceKindState(value: unknown): "pass" | "fail" | "missing" {
  if (!isExecutionEvidenceKind(value)) return "missing";
  const metadata = evidenceKindMetadata(value);
  if (metadata.gateEligible && metadata.polarity === "pass") return "pass";
  if (metadata.polarity === "fail") return "fail";
  return "missing";
}

export function selectEligibleObjectiveEvidenceActivityIds(args: {
  itemId: string;
  itemRowId?: string;
  baselineRecordedAt: Date;
  activities: readonly ObjectiveReconciliationActivity[];
  maximumActivityCount?: number;
}): ActionResult<{ activityIds: string[] }> {
  const maximum = args.maximumActivityCount ?? MAX_OBJECTIVE_MAPPING_EVIDENCE_ACTIVITIES;
  if (args.activities.length > maximum) return err("evidence-limit-exceeded");
  const ids = args.activities.map((activity) => activity.id);
  if (new Set(ids).size !== ids.length) return err("duplicate-evidence-id");
  const belongsToItem = (activity: ObjectiveReconciliationActivity) => activity.backlogItemId === args.itemId
    || activity.backlogItemId === args.itemRowId;
  const activityIds = args.activities
    .filter((activity) => activity.kind === "evidence"
      && belongsToItem(activity)
      && activity.recordedAt >= args.baselineRecordedAt
      && objectiveEvidenceKindState(object(activity.payload)?.evidenceKind) === "pass")
    .map((activity) => activity.id)
    .sort();
  return ok({ activityIds });
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function statementIds(value: unknown, key: "objectiveId" | "acceptanceId"): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map((entry) => object(entry)?.[key]);
  if (ids.some((id) => typeof id !== "string" || !id.trim())) return null;
  const normalized = ids.map((id) => String(id).trim());
  return new Set(normalized).size === normalized.length ? normalized : null;
}

function parseBaseline(activity: ObjectiveReconciliationActivity, itemId: string): Baseline | null {
  const payload = object(activity.payload);
  const subject = object(payload?.subject);
  const objectives = statementIds(payload?.objectiveStatements, "objectiveId");
  const acceptance = statementIds(payload?.acceptanceStatements, "acceptanceId");
  if (!payload || payload.schemaVersion !== 1
    || typeof payload.baselineId !== "string"
    || (payload.supersedesBaselineId !== null && typeof payload.supersedesBaselineId !== "string")
    || typeof payload.artifactDigest !== "string" || !payload.artifactDigest
    || subject?.kind !== "backlog-item" || subject.id !== itemId
    || !objectives || !acceptance) return null;
  const required = [...objectives, ...acceptance];
  if (required.length === 0 || new Set(required).size !== required.length) return null;
  return {
    baselineId: payload.baselineId,
    supersedesBaselineId: payload.supersedesBaselineId as string | null,
    artifactDigest: payload.artifactDigest,
    recordedAt: activity.recordedAt,
    statementIds: required.sort(),
  };
}

function currentBaseline(
  activities: readonly ObjectiveReconciliationActivity[],
  itemId: string,
): { baseline: Baseline | null; malformed: boolean; conflict: boolean } {
  const rows = activities.filter((activity) => activity.kind === "initiative_scope_baseline");
  const parsed = rows.map((activity) => parseBaseline(activity, itemId));
  if (parsed.some((baseline) => !baseline)) return { baseline: null, malformed: true, conflict: false };
  const baselines = parsed as Baseline[];
  const ids = new Set(baselines.map((entry) => entry.baselineId));
  if (ids.size !== baselines.length
    || baselines.some((entry) => entry.supersedesBaselineId && !ids.has(entry.supersedesBaselineId))) {
    return { baseline: null, malformed: true, conflict: false };
  }
  const superseded = new Set(baselines.flatMap((entry) => entry.supersedesBaselineId ? [entry.supersedesBaselineId] : []));
  const heads = baselines.filter((entry) => !superseded.has(entry.baselineId));
  return {
    baseline: heads.length === 1 ? heads[0]! : null,
    malformed: false,
    conflict: heads.length > 1,
  };
}

export function reconcileInitiativeObjectives(args: {
  itemId: string;
  itemRowId?: string;
  activities: readonly ObjectiveReconciliationActivity[];
}): ObjectiveReconciliationResult {
  const current = currentBaseline(args.activities, args.itemId);
  if (current.malformed) return { state: "malformed", baselineId: null, evidenceRefs: [], requiredStatementIds: [] };
  if (current.conflict) return { state: "conflict", baselineId: null, evidenceRefs: [], requiredStatementIds: [] };
  const baseline = current.baseline;
  if (!baseline) return { state: "missing", baselineId: null, evidenceRefs: [], requiredStatementIds: [] };

  const mappingActivity = [...args.activities]
    .filter((activity) => activity.kind === "initiative_objective_mapping")
    .sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime() || right.id.localeCompare(left.id))[0];
  if (!mappingActivity) {
    return { state: "missing", baselineId: baseline.baselineId, evidenceRefs: [], requiredStatementIds: baseline.statementIds };
  }
  const mapping = object(mappingActivity.payload);
  const subject = object(mapping?.subject);
  if (!mapping || mapping.schemaVersion !== 1 || mapping.proposalId !== mappingActivity.id
    || mapping.baselineId !== baseline.baselineId || mapping.artifactDigest !== baseline.artifactDigest
    || subject?.kind !== "backlog-item" || subject.id !== args.itemId || !Array.isArray(mapping.mappings)) {
    return { state: "missing", baselineId: baseline.baselineId, evidenceRefs: [], requiredStatementIds: baseline.statementIds };
  }
  const byStatement = new Map<string, string[]>();
  for (const raw of mapping.mappings) {
    const entry = object(raw);
    if (!entry || typeof entry.objectiveId !== "string" || !baseline.statementIds.includes(entry.objectiveId)
      || !Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.length === 0
      || entry.evidenceRefs.some((ref) => typeof ref !== "string" || !ref.trim())
      || byStatement.has(entry.objectiveId)) {
      return { state: "missing", baselineId: baseline.baselineId, evidenceRefs: [], requiredStatementIds: baseline.statementIds };
    }
    byStatement.set(entry.objectiveId, [...new Set(entry.evidenceRefs as string[])]);
  }
  if (baseline.statementIds.some((id) => !byStatement.has(id))) {
    return { state: "missing", baselineId: baseline.baselineId, evidenceRefs: [], requiredStatementIds: baseline.statementIds };
  }

  const evidenceById = new Map(args.activities
    .filter((activity) => activity.kind === "evidence")
    .map((activity) => [activity.id, activity]));
  const evidenceRefs = [...new Set([...byStatement.values()].flat())].sort();
  for (const evidenceRef of evidenceRefs) {
    const evidence = evidenceById.get(evidenceRef);
    const payload = object(evidence?.payload);
    const evidenceState = objectiveEvidenceKindState(payload?.evidenceKind);
    if (!evidence || (evidence.backlogItemId != null
        && evidence.backlogItemId !== args.itemId && evidence.backlogItemId !== args.itemRowId)
      || evidence.recordedAt < baseline.recordedAt) {
      return { state: "missing", baselineId: baseline.baselineId, evidenceRefs, requiredStatementIds: baseline.statementIds };
    }
    if (evidenceState === "fail") {
      return { state: "fail", baselineId: baseline.baselineId, evidenceRefs, requiredStatementIds: baseline.statementIds };
    }
    if (evidenceState !== "pass") {
      return { state: "missing", baselineId: baseline.baselineId, evidenceRefs, requiredStatementIds: baseline.statementIds };
    }
  }
  return { state: "pass", baselineId: baseline.baselineId, evidenceRefs, requiredStatementIds: baseline.statementIds };
}
