import { commandPayloadBinding } from "./command-receipts";
import type { ReceiptedWorkroomToolOptions } from "./receipted-tool";
import { parseScopeClaims, SCOPE_KIND_SET, type ScopeClaim } from "@/lib/work-capsules";

/** A caller's original precondition, never an authority grant. */
export type ScopeReleaseTarget = Pick<ScopeClaim, "kind" | "value" | "intent" | "recordedByPrincipalId"> & {
  releaseEpoch: string;
};
export type ScopeReleaseRequest = {
  capsuleId: string; expectedRoomId: string; claims: ScopeReleaseTarget[]; commandId?: string;
};

/** Normalize original intent only; never read or substitute current targets. */
export function parseScopeReleaseRequest(params: Record<string, unknown>): ScopeReleaseRequest | null {
  if (Object.keys(params).some(key => !["capsuleId", "expectedRoomId", "claims", "commandId"].includes(key))) return null;
  const capsuleId = typeof params.capsuleId === "string" ? params.capsuleId.trim() : "";
  const expectedRoomId = typeof params.expectedRoomId === "string" ? params.expectedRoomId.trim() : "";
  const claims = parseOriginalScopeReleaseTargets(params.claims);
  if (!capsuleId || !expectedRoomId || !claims) return null;
  if (params.commandId !== undefined && (typeof params.commandId !== "string"
    || !params.commandId.trim() || params.commandId.trim().length > 200)) return null;
  return { capsuleId, expectedRoomId, claims,
    ...(typeof params.commandId === "string" ? { commandId: params.commandId.trim() } : {}) };
}

export function isScopeReleaseEpoch(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}

function targetOf(value: unknown): ScopeReleaseTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.kind !== "string" || !SCOPE_KIND_SET.has(row.kind as ScopeClaim["kind"])
    || typeof row.value !== "string" || !row.value.trim()
    || (row.intent !== "edit" && row.intent !== "read")
    || typeof row.recordedByPrincipalId !== "string" || !row.recordedByPrincipalId.trim()
    || !isScopeReleaseEpoch(row.releaseEpoch)) return null;
  return { kind: row.kind as ScopeClaim["kind"], value: row.value.trim(), intent: row.intent,
    recordedByPrincipalId: row.recordedByPrincipalId.trim(), releaseEpoch: row.releaseEpoch };
}

const keyOf = (target: Pick<ScopeClaim, "kind" | "value">) => `${target.kind}:${target.value}`;

/** Keep the complete finite batch; only identical duplicates may coalesce. */
export function parseOriginalScopeReleaseTargets(value: unknown): ScopeReleaseTarget[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const targets = new Map<string, ScopeReleaseTarget>();
  for (const entry of value) {
    const target = targetOf(entry);
    if (!target) return null;
    const key = keyOf(target);
    const previous = targets.get(key);
    if (previous && (previous.releaseEpoch !== target.releaseEpoch
      || previous.recordedByPrincipalId !== target.recordedByPrincipalId
      || previous.intent !== target.intent)) return null;
    targets.set(key, target);
  }
  return [...targets.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, target]) => target);
}

/** Compare the original full target set with one authoritative write snapshot. */
export function originalScopeReleaseTargetsMatch(
  room: { id?: string; scopeClaims: unknown }, expectedRoomId: unknown, targets: readonly ScopeReleaseTarget[],
): boolean {
  if (typeof expectedRoomId !== "string" || !expectedRoomId || room.id !== expectedRoomId
    || !Array.isArray(room.scopeClaims) || targets.length === 0) return false;
  const requested = new Set(targets.map(keyOf));
  const current = new Map<string, ScopeReleaseTarget>();
  for (const entry of room.scopeClaims) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const key = `${row.kind}:${typeof row.value === "string" ? row.value.trim() : row.value}`;
    if (!requested.has(key)) continue;
    const target = targetOf(row);
    // Malformed or duplicated ownership cannot disappear from eligibility.
    if (!target || !parseScopeClaims([row])[0] || current.has(key)) return false;
    current.set(key, target);
  }
  return targets.every(target => {
    const stored = current.get(keyOf(target));
    return stored?.releaseEpoch === target.releaseEpoch && stored.intent === target.intent
      && stored.recordedByPrincipalId === target.recordedByPrincipalId;
  });
}

/** Maintenance needs positive obsolescence, not merely a failed precondition.
 * Issuance and never-started approval proof are separately required by its caller. */
export function classifyOriginalScopeReleaseTargets(
  room: { id?: string; scopeClaims: unknown }, expectedRoomId: string, targets: readonly ScopeReleaseTarget[],
): "current" | "obsolete" | "unknown" {
  const originals = parseOriginalScopeReleaseTargets(targets);
  if (!originals || !expectedRoomId || room.id !== expectedRoomId || !Array.isArray(room.scopeClaims)) return "unknown";
  const current = new Map<string, ScopeReleaseTarget>();
  for (const entry of room.scopeClaims) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "unknown";
    const row = entry as Record<string, unknown>;
    if (!["kind", "value", "intent", "recordedByPrincipalId", "releaseEpoch"].some(key => key in row)) continue;
    const target = targetOf(row);
    if (!target || !parseScopeClaims([row])[0] || current.has(keyOf(target))) return "unknown";
    current.set(keyOf(target), target);
  }
  let obsolete = false;
  for (const target of originals) {
    const stored = current.get(keyOf(target));
    if (!stored) { obsolete = true; continue; }
    if (stored.releaseEpoch !== target.releaseEpoch) { obsolete = true; continue; }
    if (stored.intent !== target.intent || stored.recordedByPrincipalId !== target.recordedByPrincipalId) return "unknown";
  }
  return obsolete ? "obsolete" : "current";
}


/** Validate before receipt replay; absence of a key keeps the normal writer. */
export const prepareScopeRelease: NonNullable<ReceiptedWorkroomToolOptions["prepare"]> = params => {
  const request = parseScopeReleaseRequest(params);
  if (!request) return { refusal: { success: false, error: "invalid_input",
    message: "Release needs the original persistent room and complete claim targets. Obtain fresh targets for a new intent; do not retry or substitute current claims for an old request." } };
  if (!request.commandId) return undefined;
  const { commandId, ...payload } = request;
  return { params: { ...payload, commandId }, payloadBinding: commandPayloadBinding(payload),
    expectedRoomRowId: request.expectedRoomId };
};
