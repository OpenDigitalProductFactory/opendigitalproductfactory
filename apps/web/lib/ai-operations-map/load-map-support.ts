// Pure row-shaping helpers backing loadOperationsMapData. Extracted from
// load-map-data.ts to keep that module under the size ceiling; no behavior
// lives here that touches Prisma — everything is pure and unit-testable.

/**
 * Fold per-table min/max timestamp bounds into a single global evidence
 * range. Null-safe: tables with no rows contribute nothing; a fully empty
 * install yields { earliest: null, latest: null }.
 */
export function resolveEvidenceRange(
  bounds: Array<{ min: Date | null; max: Date | null }>,
): { earliest: string | null; latest: string | null } {
  let earliest: Date | null = null;
  let latest: Date | null = null;
  for (const bound of bounds) {
    if (bound.min && (!earliest || bound.min < earliest)) earliest = bound.min;
    if (bound.max && (!latest || bound.max > latest)) latest = bound.max;
  }
  return {
    earliest: earliest ? earliest.toISOString() : null,
    latest: latest ? latest.toISOString() : null,
  };
}

/**
 * Recover a deliberation branch's model/provider from its persisted
 * `TaskNode.routeDecision` JSON. Provider falls back to the endpoint-id prefix
 * ("provider:model") when not stored explicitly — consistent with the routing
 * topology projector's provider resolution. Returns nulls for non-diverse runs
 * (single-model-multi-persona branches share one model and may carry neither).
 */
export function extractBranchModelProvider(value: unknown): { modelId: string | null; providerId: string | null } {
  const parsed = typeof value === "string" ? safeJsonObject(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { modelId: null, providerId: null };
  }
  const record = parsed as Record<string, unknown>;
  const modelId = typeof record.selectedModelId === "string" ? record.selectedModelId : null;
  let providerId = typeof record.providerId === "string" ? record.providerId : null;
  if (!providerId && typeof record.selectedEndpoint === "string" && record.selectedEndpoint.includes(":")) {
    providerId = record.selectedEndpoint.split(":")[0] || null;
  }
  return { modelId, providerId };
}

function safeJsonObject(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Resolve a PhaseHandoff.gateResult JSON blob into a pass/fail signal + a
 * short label. Conservative: an explicit boolean wins; otherwise a status
 * string is pattern-matched; otherwise the gate state is unknown (null).
 */
export function resolveGateResult(value: unknown): { passed: boolean | null; label: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { passed: null, label: null };
  }
  const record = value as Record<string, unknown>;
  const explicit = record.passed ?? record.allowed ?? record.advanced;
  const statusText = [record.result, record.status, record.outcome, record.decision]
    .find((entry): entry is string => typeof entry === "string");

  let passed: boolean | null = null;
  if (typeof explicit === "boolean") {
    passed = explicit;
  } else if (statusText) {
    if (/pass|advanc|approv|ok|success/i.test(statusText)) passed = true;
    else if (/fail|block|reject|deny|error/i.test(statusText)) passed = false;
  }

  return { passed, label: statusText ?? null };
}

/**
 * Union two coworker-node lists by agentId, preserving the provider-topology
 * entry when an agent appears in both. Keeps a stable label sort.
 */
export function mergeCoworkersById<T extends { agentId: string; label: string }>(
  primary: T[],
  secondary: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const coworker of primary) byId.set(coworker.agentId, coworker);
  for (const coworker of secondary) {
    if (!byId.has(coworker.agentId)) byId.set(coworker.agentId, coworker);
  }
  return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function getActivationProfileType(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profileType = (value as { profileType?: unknown }).profileType;
  return typeof profileType === "string" ? profileType : null;
}

/**
 * Merge the recent-40 task-run window with the stalled-200 window,
 * keeping each cuid id once. Exported so the unit test can lock in the
 * dedup behavior — the AI Operations Map's correctness depends on a row
 * appearing exactly once in the projection set.
 *
 * Both inputs share the same row shape (the Prisma select clauses match).
 * Recent rows are inserted first, then stalled rows that haven't already
 * appeared — this keeps existing test snapshots stable and matches the
 * mental model "stalled is added on top of recent."
 */
export function mergeTaskRunsDedupeById<T extends { id: string }>(
  recent: T[],
  stalled: T[],
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const row of recent) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  for (const row of stalled) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}
