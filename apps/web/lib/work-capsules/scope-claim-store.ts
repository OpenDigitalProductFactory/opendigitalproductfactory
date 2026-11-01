import { randomUUID } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { prisma } from "@dpf/db";
import { workCapsuleActor } from "./handler-actor";
import { commandPayloadBinding } from "./command-receipts";
import type { ReceiptedWorkroomToolOptions } from "./receipted-tool";
import { SCOPE_KIND_SET, parseScopeClaims, type ScopeClaim } from "@/lib/work-capsules";
import { replaceOwnershipClaims, scopeWriteWhere } from "./scope-input";
import { planCapsuleChangeImpact, type CapsuleChangeImpactContract } from "./change-impact-contract";
import { assertScopeClaimLease } from "./scope-claim-lease";
import { qualificationStateForScopeClaim } from "./qualification-scope-admission";
import { isTerminalCapsuleStatus, TERMINAL_CAPSULE_STATUSES } from "./work-capsule-branch-identity";
import { recordWorkCapsuleActivity as recordActivity } from "./work-capsule-activity-store";
import { intentsConflict, scopeValuesOverlap } from "./work-capsule-scope-overlap";
import { hasBoundCommandTransaction } from "./receipted-tool";
import { isScopeReleaseEpoch } from "./scope-release-targets";
import { assertScopeEpochEnrollmentReady, preparedScopeEpochEnrollment, retainPreparedScopeEpochEnrollment } from "./scope-epoch-enrollment.server";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

type ScopeClaimInput = Pick<ScopeClaim, "kind" | "value" | "intent">;

/**
 * A scope claim on another active capsule that conflicts with an incoming
 * claim â€” same `kind:value`, with at least one side claiming `edit` intent.
 */
export type ScopeConflict = {
  capsuleId: string;
  title: string;
  kind: ScopeClaim["kind"];
  value: string;
  existingIntent: ScopeClaim["intent"];
  incomingIntent: ScopeClaim["intent"];
  leaseHolderPrincipalId: string | null;
};

/**
 * Thrown by claimWorkCapsuleScope when an incoming claim overlaps an active
 * claim held by another capsule. Carries the conflicts so the MCP boundary can
 * surface them to the caller (who must coordinate, pick different scope, or pass
 * force to deliberately co-claim).
 */
export class ScopeOverlapError extends Error {
  readonly conflicts: ScopeConflict[];
  constructor(conflicts: ScopeConflict[]) {
    super(
      `Scope overlap with ${conflicts.length} active claim(s) on other Work Capsule(s): ` +
        conflicts.map((c) => `${c.kind}:${c.value} (held by ${c.capsuleId})`).join(", "),
    );
    this.name = "ScopeOverlapError";
    this.conflicts = conflicts;
  }
}

/**
 * Find active claims on OTHER capsules that conflict with `claims`. "Active" =
 * not archived, not in a terminal status, and (for lease-backed executors) the
 * lease has not expired â€” an expired-lease capsule has released its hold, so its
 * scope is reclaimable. Conflict detection is done in JS over the parsed
 * scopeClaims JSON (the active-capsule population is small), mirroring how the
 * rest of this store reasons about scope.
 */
export async function detectScopeConflicts(args: {
  db: CapsuleDb;
  capsuleId: string;
  claims: ScopeClaimInput[];
  now?: Date;
}): Promise<ScopeConflict[]> {
  if (args.claims.length === 0) return [];

  const now = args.now ?? new Date();
  const others = await args.db.workroom.findMany({
    where: {
      capsuleId: { not: args.capsuleId },
      archivedAt: null,
      status: { notIn: TERMINAL_CAPSULE_STATUSES },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { gt: now } }],
    },
    select: {
      capsuleId: true,
      title: true,
      scopeClaims: true,
      leaseHolderPrincipalId: true,
    },
  });

  const conflicts: ScopeConflict[] = [];
  for (const other of others ?? []) {
    for (const existing of parseScopeClaims(other.scopeClaims)) {
      // A `path` claim covers its whole subtree, so a directory claim conflicts
      // with a file/dir beneath it (and vice-versa) even though the kind:value
      // strings differ â€” without this, `path:dir/` and `path:dir/file.ts` were
      // treated as disjoint and two sessions could both "own" overlapping edit
      // scope. Non-path kinds keep exact-value matching.
      const incoming = args.claims.find(
        (c) =>
          c.kind === existing.kind &&
          scopeValuesOverlap(existing.kind, existing.value, c.value) &&
          intentsConflict(existing.intent, c.intent),
      );
      if (incoming) {
        conflicts.push({
          capsuleId: other.capsuleId,
          title: other.title,
          kind: existing.kind,
          value: existing.value,
          existingIntent: existing.intent,
          incomingIntent: incoming.intent,
          leaseHolderPrincipalId: other.leaseHolderPrincipalId ?? null,
        });
      }
    }
  }
  return conflicts;
}

function claimPlan(snapshot: { scopeClaims: unknown }, claims: ScopeClaimInput[], principalId: string) {
  const previous = new Map(parseScopeClaims(snapshot.scopeClaims).map(claim => [`${claim.kind}:${claim.value}`, claim]));
  const plans = new Map<string, { claim: ScopeClaimInput; epoch: string | null; existing: boolean }>();
  for (const claim of claims) {
    const key = `${claim.kind}:${claim.value}`;
    const matching = Array.isArray(snapshot.scopeClaims) ? snapshot.scopeClaims.filter(row => row
      && typeof row === "object" && row.kind === claim.kind && (typeof row.value === "string" ? row.value.trim() : row.value) === claim.value) : [];
    const stored = previous.get(key);
    if (matching.length > 1 || (matching.length && !stored)) throw new Error("Scope ownership is malformed or ambiguous.");
    if (stored && Object.prototype.hasOwnProperty.call(stored, "releaseEpoch") && !isScopeReleaseEpoch(stored.releaseEpoch)) {
      throw new Error("Present scope epoch metadata is malformed; it cannot be re-enrolled.");
    }
    const same = stored?.recordedByPrincipalId === principalId && stored.intent === claim.intent;
    plans.set(key, { claim, epoch: same && isScopeReleaseEpoch(stored?.releaseEpoch) ? stored.releaseEpoch : null,
      existing: Boolean(stored) });
  }
  return { previous, plans: [...plans.entries()] };
}

function assertClaimable(row: { status: string; archivedAt: unknown }, capsuleId: string) {
  if (isTerminalCapsuleStatus(row.status) || row.archivedAt != null) {
    throw new Error(`Work Capsule ${capsuleId} is ${row.status} and cannot accept scope claims.`);
  }
}

export async function claimWorkCapsuleScope(args: {
  db: CapsuleDb; capsuleId: string; claims: ScopeClaimInput[]; actor: WorkCapsuleActor; now?: Date;
  force?: boolean; qualificationAdmissionToken?: string;
  buildChangeImpactContract?: (paths: string[]) => Promise<CapsuleChangeImpactContract>;
}) {
  const before = await args.db.workroom.findUnique({ where: { capsuleId: args.capsuleId } });
  if (!before) throw new Error(`Work Capsule ${args.capsuleId} not found`);
  assertClaimable(before, args.capsuleId);
  const principalId = args.actor.principalId;
  if (!principalId) throw new Error("A proven principal is required to acquire protected scope.");
  const plan = claimPlan(before, args.claims, principalId);
  const conflicts = await detectScopeConflicts({ db: args.db, capsuleId: args.capsuleId, claims: args.claims, now: args.now });
  if (conflicts.length && !args.force) throw new ScopeOverlapError(conflicts);
  assertScopeClaimLease(before, principalId, args.force === true, args.now ?? new Date());
  const needsEnrollment = plan.plans.some(([, entry]) => entry.epoch === null);
  const retained = hasBoundCommandTransaction(args.db) ? preparedScopeEpochEnrollment(args.db) : undefined;
  if (needsEnrollment && hasBoundCommandTransaction(args.db) && !retained) {
    throw new Error("Protected acquisition needs qualification before its receipt transaction; no epoch was published.");
  }
  const enrollment = needsEnrollment ? retained ?? await assertScopeEpochEnrollmentReady() : null;
  // Impact is advisory and can perform reads; never hold the room lock for it.
  const preview = new Map(plan.previous);
  for (const [key, entry] of plan.plans) preview.set(key, { ...entry.claim,
    recordedAt: (args.now ?? new Date()).toISOString(), recordedByPrincipalId: principalId });
  const impact = await planCapsuleChangeImpact({ scopeClaims: [...preview.values()], incomingClaims: args.claims,
    verificationState: before.verificationState, build: args.buildChangeImpactContract });
  const write = async (tx: CapsuleDb) => {
    await enrollment?.assertCurrent(tx);
    if (tx.$queryRaw) await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "id" = ${before.id} FOR UPDATE`;
    const current = await tx.workroom.findUnique({ where: { capsuleId: args.capsuleId } });
    if (!current || current.id !== before.id || canonicalJson(current.scopeClaims) !== canonicalJson(before.scopeClaims)
      || current.updatedAt?.getTime() !== before.updatedAt?.getTime()
      || current.leaseHolderPrincipalId !== before.leaseHolderPrincipalId
      || current.leaseExpiresAt?.getTime() !== before.leaseExpiresAt?.getTime()) {
      throw new Error("Workroom scope or lease changed before acquisition; no epoch was published.");
    }
    const now = args.now ?? new Date();
    assertClaimable(current, args.capsuleId);
    assertScopeClaimLease(current, principalId, args.force === true, now);
    if (needsEnrollment && !args.force && (current.leaseHolderPrincipalId !== principalId
      || !current.leaseExpiresAt || current.leaseExpiresAt.getTime() <= now.getTime())) {
      throw new Error("A current owned lease is required for prospective scope enrollment.");
    }
    const qualification = args.qualificationAdmissionToken
      ? qualificationStateForScopeClaim({ room: current, token: args.qualificationAdmissionToken,
        accountablePrincipalRef: principalId, now }) : null;
    const next = new Map(plan.previous);
    const added: ScopeClaim[] = [], refreshed: ScopeClaim[] = [];
    for (const [key, entry] of plan.plans) {
      const normalized: ScopeClaim = { ...entry.claim, recordedAt: now.toISOString(),
        recordedByPrincipalId: principalId, releaseEpoch: entry.epoch ?? randomUUID() };
      (entry.existing ? refreshed : added).push(normalized);
      next.set(key, normalized);
    }
    const scopeClaims = replaceOwnershipClaims(current.scopeClaims, [...next.values()]);
    const updated = await tx.workroom.update({ where: { ...scopeWriteWhere(current), id: current.id,
      leaseHolderPrincipalId: current.leaseHolderPrincipalId, leaseExpiresAt: current.leaseExpiresAt },
      data: { scopeClaims,
        ...(qualification ? { workspaceState: { ...qualification.workspaceState,
          qualificationExperimentAdmission: qualification.state } } : {}),
        ...(impact.verificationState ? { verificationState: impact.verificationState } : {}) } });
    await recordActivity(tx, { workCapsuleId: current.id, kind: "scope-claimed",
      summary: conflicts.length ? `Force-claimed ${added.length} new scope item(s) over ${conflicts.length} active conflict(s); refreshed ${refreshed.length}.`
        : `Claimed ${added.length} new scope item(s); refreshed ${refreshed.length}.`,
      payload: { added, refreshed, ...(qualification ? { qualificationBindingDigest: qualification.state.bindingDigest } : {}),
        ...(conflicts.length ? { forcedOverConflicts: conflicts } : {}) }, actor: args.actor });
    if (impact.activity) await recordActivity(tx, { workCapsuleId: current.id, ...impact.activity, actor: args.actor });
    return { ...updated, changeImpactContract: impact.contract };
  };
  if (hasBoundCommandTransaction(args.db)) return write(args.db);
  if (!args.db.$transaction) throw new Error("Scope acquisition requires an atomic transaction.");
  return args.db.$transaction(write);
}

const SCOPE_INTENTS = new Set<ScopeClaim["intent"]>(["edit", "read"]);

export function parseClaimInputs(params: Record<string, unknown>): Array<Pick<ScopeClaim, "kind" | "value" | "intent">> | null {
  const claims = params.claims;
  if (!Array.isArray(claims)) return null;

  const parsed: Array<Pick<ScopeClaim, "kind" | "value" | "intent">> = [];
  for (const claim of claims) {
    if (!claim || typeof claim !== "object") return null;
    const candidate = claim as Record<string, unknown>;
    const kind = typeof candidate.kind === "string" ? candidate.kind : "";
    const value = typeof candidate.value === "string" ? candidate.value.trim() : "";
    const intent = typeof candidate.intent === "string" ? candidate.intent : "";
    if (!SCOPE_KIND_SET.has(kind as ScopeClaim["kind"]) || !SCOPE_INTENTS.has(intent as ScopeClaim["intent"]) || !value) {
      return null;
    }
    parsed.push({ kind: kind as ScopeClaim["kind"], value, intent: intent as ScopeClaim["intent"] });
  }

  return parsed.length > 0 ? parsed : null;
}


/** A keyed acquisition qualifies before any receipt/room lock, then uses the
 * same admission locks and transaction as its effect and published epoch. */
export const prepareScopeClaim: NonNullable<ReceiptedWorkroomToolOptions["prepareAsync"]> = async (params, userId, context) => {
  if (params.commandId === undefined) return undefined;
  const capsuleId = typeof params.capsuleId === "string" ? params.capsuleId.trim() : "";
  const commandId = typeof params.commandId === "string" ? params.commandId.trim() : "";
  const claims = parseClaimInputs(params);
  if (!capsuleId || !commandId || commandId.length > 200 || !claims) return { refusal: { success: false, error: "invalid_input",
    message: "A keyed scope claim requires its complete valid acquisition intent." } };
  const qualificationAdmissionToken = typeof params.qualificationAdmissionToken === "string" ? params.qualificationAdmissionToken.trim() : "";
  const payload = { capsuleId, claims, force: params.force === true, ...(qualificationAdmissionToken ? { qualificationAdmissionToken } : {}) };
  try {
    const actor = await workCapsuleActor(userId, context), room = await prisma.workroom.findUnique({ where: { capsuleId } });
    if (!room || !actor.principalId) throw new Error("Original claim room or accountable principal is unavailable.");
    assertClaimable(room, capsuleId);
    const needsEnrollment = claimPlan(room, claims, actor.principalId).plans.some(([, entry]) => entry.epoch === null);
    const now = new Date();
    assertScopeClaimLease(room, actor.principalId, payload.force, now);
    if (needsEnrollment && !payload.force && (room.leaseHolderPrincipalId !== actor.principalId
      || !room.leaseExpiresAt || room.leaseExpiresAt.getTime() <= now.getTime())) throw new Error("A current owned lease is required for prospective scope enrollment.");
    const proof = needsEnrollment ? await assertScopeEpochEnrollmentReady() : null;
    return { params: { ...payload, commandId }, payloadBinding: commandPayloadBinding(payload), expectedRoomRowId: room.id,
      ...(proof ? { beforeRoomLock: async tx => {
        await proof.assertCurrent(tx as unknown as CapsuleDb);
        retainPreparedScopeEpochEnrollment(tx, proof);
      } } : {}) };
  } catch (error) {
    return { refusal: { success: false, error: "scope_claim_precondition_failed",
      message: error instanceof Error ? error.message : "Scope acquisition qualification is unavailable." } };
  }
};
