import { normalizeWorkCapsuleScopeInput, parseScopeClaims, type ScopeClaim, type WorkCapsuleScopeInput } from "@/lib/work-capsules";
import { readWorkShapeClaim, readWorkroomShapeClaim, resolveWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

/** Persistence accepts only an executable, exact definition version. */
export function normalizePersistedScope(input?: WorkCapsuleScopeInput | null) {
  const scope = normalizeWorkCapsuleScopeInput(input);
  if (scope.workShape && !resolveWorkShapeClaim([{ workShape: scope.workShape }])) {
    throw new Error(`workShape ${scope.workShape} is not an available execution definition version.`);
  }
  return scope;
}

export function scopeClaimEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

/** Compare-and-set the snapshot so a concurrent claim or ownership change wins. */
export function scopeWriteWhere(snapshot: Record<string, unknown>): Record<string, unknown> {
  return {
    capsuleId: snapshot.capsuleId,
    ...(snapshot.scopeClaims !== undefined ? { scopeClaims: { equals: snapshot.scopeClaims } } : {}),
    ...(snapshot.updatedAt !== undefined ? { updatedAt: snapshot.updatedAt } : {}),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function shapeValue(entry: Record<string, unknown>, key: "workShape" | "workroomShape"): unknown {
  return key === "workShape" && !(key in entry) && "workShapeKey" in entry
    ? `${entry.workShapeKey}@${entry.workShapeVersion}` : entry[key];
}

function replaceShape(claims: unknown[], key: "workShape" | "workroomShape", value: unknown, now: Date): unknown[] | null {
  const keys = key === "workShape" ? [key, "workShapeKey", "workShapeVersion"] : [key];
  const matching = claims.map(record).filter((entry): entry is Record<string, unknown> => entry !== null && keys.some((field) => field in entry));
  if (matching.length === 1 && shapeValue(matching[0], key) === value) return null;
  if (!matching.length && value == null) return null;
  const result = claims.flatMap((entry) => {
    const row = record(entry);
    if (!row || !keys.some((field) => field in row)) return [entry];
    const rest = Object.fromEntries(Object.entries(row).filter(([field]) => !keys.includes(field)));
    return Object.keys(rest).some((field) => field !== "recordedAt") ? [rest] : [];
  });
  if (value) result.push({ [key]: value, recordedAt: now.toISOString() });
  return result;
}

/** Replace ownership claims without discarding shape or extension records. */
export function replaceOwnershipClaims(value: unknown, next: ScopeClaim[]): unknown[] {
  const pending = new Map(next.map((claim) => [`${claim.kind}:${claim.value}`, claim]));
  const result: unknown[] = [];
  for (const entry of scopeClaimEntries(value)) {
    const claim = parseScopeClaims([entry])[0];
    if (!claim) { result.push(entry); continue; }
    const key = `${claim.kind}:${claim.value}`;
    const replacement = pending.get(key);
    if (replacement) result.push({ ...(entry as object), ...replacement });
    else {
      const rest = Object.fromEntries(Object.entries(entry as object).filter(([field]) =>
        !["kind", "value", "intent", "recordedByPrincipalId"].includes(field),
      ));
      if (Object.keys(rest).some((field) => field !== "recordedAt")) result.push(rest);
    }
    pending.delete(key);
  }
  return [...result, ...pending.values()];
}

/** One ingress contract for creation and adoption; omission stays omission. */
export function parseScopeInput(params: Record<string, unknown>): WorkCapsuleScopeInput {
  return {
    workroomShape: params.workroomShape,
    workShape: params.workShape,
    decisionScope: params.decisionScope,
    portfolioRole: params.portfolioRole,
    servedPersona: params.servedPersona,
    activityKind: params.activityKind,
    outcomeAnchor: params.outcomeAnchor,
    servesPortfolioRoles: params.servesPortfolioRoles,
    dependsOnPortfolioRoles: params.dependsOnPortfolioRoles,
  };
}

/** Patch only supplied fields. Claims owned by other subsystems survive. */
export function adoptionScopePatch(existing: Record<string, unknown>, input: WorkCapsuleScopeInput | null | undefined, now: Date): Record<string, unknown> {
  if (!input) return {};
  const normalized = normalizeWorkCapsuleScopeInput(input);
  const patch: Record<string, unknown> = {};
  let claims = [...scopeClaimEntries(existing.scopeClaims)];
  for (const key of Object.keys(normalized) as Array<keyof typeof normalized>) {
    if (input[key] === undefined) continue;
    const value = normalized[key];
    if (key === "workShape" || key === "workroomShape") {
      const replaced = replaceShape(claims, key, value, now);
      if (!replaced) continue;
      claims = replaced;
      patch.scopeClaims = claims;
    } else {
      const stored = key === "outcomeAnchor" ? value ?? {} : value;
      if (JSON.stringify(existing[key]) !== JSON.stringify(stored)) patch[key] = stored;
    }
  }
  return patch;
}

export function assertScopeReadback(existing: Record<string, unknown>, input?: WorkCapsuleScopeInput | null): void {
  if (Object.keys(adoptionScopePatch(existing, input, new Date())).length) {
    throw new Error(`Work Capsule ${existing.capsuleId} has different persisted scope; read it and retry through adoption using its owning session.`);
  }
}

export function scopeChangeEvidence(before: Record<string, unknown>, after: Record<string, unknown>) {
  const view = (row: Record<string, unknown>) => {
    const ref = readWorkShapeClaim(row.scopeClaims);
    return { ...row, workShape: ref ? `${ref.key}@${ref.version}` : null, workroomShape: readWorkroomShapeClaim(row.scopeClaims) };
  };
  const previous = view(before) as Record<string, unknown>;
  const next = view(after) as Record<string, unknown>;
  return Object.fromEntries(Object.keys(normalizeWorkCapsuleScopeInput()).filter((key) =>
    JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
  ).map((key) => [key, { before: previous[key] ?? null, after: next[key] ?? null }]));
}
