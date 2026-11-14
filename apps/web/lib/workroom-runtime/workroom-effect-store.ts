// BI-C64EDA33: the Workroom runtime's outbox (WorkroomEffect). Each statement is
// one static tagged template over `$queryRaw`, so it runs inside a Prisma
// transaction in the portal, against a disposable database in the
// real-database test, and stays statically readable by the raw-SQL guards.
//
// A room's effects run one at a time, in the order they were decided: an
// effect waiting on its backoff blocks the room's later effects, so a retry
// never races ahead of the work it depends on (T3 Code's EffectOutbox rule,
// pingdotgg/t3code@24e77473, MIT; reproduced, not copied). Lease and attempt
// fields follow AsyncInferenceOp. Times are stored as UTC timestamp(3)
// (Prisma's mapping); a JS Date arrives as timestamptz and is converted.

import { randomUUID } from "node:crypto";

import { isProcessBound, type EffectIntent, type EffectKind, type EffectSettlement } from "./runtime-decider";

/** Prisma's client or transaction; the real-database test passes a pg adapter with the same shape. */
export type EffectSqlDb = { $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> };

export type ClaimedEffect = {
  id: string;
  workCapsuleId: string;
  capsuleId: string;
  commandKey: string;
  kind: EffectKind;
  processBound: boolean;
  sessionGeneration: string | null;
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
};

/** Insert a decision's effects; a replayed decision inserts nothing twice. */
export async function insertEffects(db: EffectSqlDb, input: {
  roomRowId: string; commandId: string; generation: string | null; effects: EffectIntent[]; now: Date;
}): Promise<void> {
  let ordinal = 0;
  for (const effect of input.effects) {
    const bound = isProcessBound(effect.kind);
    const generation = bound ? input.generation : null;
    await db.$queryRaw`
      INSERT INTO "WorkroomEffect" ("id","workCapsuleId","commandKey","ordinal","kind","processBound","sessionGeneration","payload","status","availableAt","createdAt","updatedAt")
      VALUES (${randomUUID()}, ${input.roomRowId}, ${input.commandId}, ${ordinal}, ${effect.kind}::"WorkroomEffectKind", ${bound}, ${generation},
        ${JSON.stringify(effect.payload)}::jsonb, 'pending'::"WorkroomEffectStatus",
        (${input.now}::timestamptz AT TIME ZONE 'UTC'), (${input.now}::timestamptz AT TIME ZONE 'UTC'), (${input.now}::timestamptz AT TIME ZONE 'UTC'))
      ON CONFLICT ("workCapsuleId","commandKey","ordinal") DO NOTHING
      RETURNING "id"`;
    ordinal += 1;
  }
}

/** Retire the room's unsettled process-bound effects decided for any generation but `keepGeneration`. */
export async function retireEffects(db: EffectSqlDb, input: { roomRowId: string; keepGeneration: string | null; reason: string; now: Date }) {
  return db.$queryRaw<Array<{ id: string; kind: EffectKind }>>`
    UPDATE "WorkroomEffect" SET "status"='retired'::"WorkroomEffectStatus", "lastError"=${input.reason},
      "settledAt"=(${input.now}::timestamptz AT TIME ZONE 'UTC'), "updatedAt"=(${input.now}::timestamptz AT TIME ZONE 'UTC'),
      "leaseOwner"=NULL, "leaseExpiresAt"=NULL
    WHERE "workCapsuleId"=${input.roomRowId} AND "processBound"=true AND "status"::text IN ('pending','running')
      AND (${input.keepGeneration}::text IS NULL OR "sessionGeneration" IS DISTINCT FROM ${input.keepGeneration}::text)
    RETURNING "id", "kind"::text AS "kind"`;
}

/**
 * Settle a running effect. Guarded by its attempt, so a report from an attempt
 * whose lease already expired (and was claimed again) changes nothing.
 */
export async function settleEffect(db: EffectSqlDb, settlement: EffectSettlement, now: Date): Promise<boolean> {
  const retry = settlement.status === "pending";
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "WorkroomEffect" SET "status"=${settlement.status}::"WorkroomEffectStatus", "lastError"=${settlement.error ?? null},
      "leaseOwner"=NULL, "leaseExpiresAt"=NULL, "updatedAt"=(${now}::timestamptz AT TIME ZONE 'UTC'),
      "availableAt"=CASE WHEN ${retry}::boolean THEN (${now}::timestamptz AT TIME ZONE 'UTC') + (${settlement.retryAfterMs ?? 0}::int * interval '1 millisecond') ELSE "availableAt" END,
      "settledAt"=CASE WHEN ${retry}::boolean THEN NULL ELSE (${now}::timestamptz AT TIME ZONE 'UTC') END
    WHERE "id"=${settlement.effectId} AND "status"='running'::"WorkroomEffectStatus" AND "attemptCount"=${settlement.attempt}
    RETURNING "id"`;
  return rows.length > 0;
}

/**
 * Lease the oldest runnable effect of each room. Process-bound effects run only
 * in the process that holds their generation, so another portal never answers
 * a provider process it does not own.
 */
export async function claimEffects(db: EffectSqlDb, input: { owner: string; liveGenerations: string[]; limit: number; leaseMs: number; now: Date }): Promise<ClaimedEffect[]> {
  const rows = await db.$queryRaw<Array<ClaimedEffect & { payload: unknown }>>`
    WITH candidate AS (
      SELECT e."id" FROM "WorkroomEffect" e
      WHERE e."status"='pending'::"WorkroomEffectStatus" AND e."availableAt" <= (${input.now}::timestamptz AT TIME ZONE 'UTC')
        AND (e."processBound"=false OR e."sessionGeneration" = ANY(${input.liveGenerations}::text[]))
        AND NOT EXISTS (SELECT 1 FROM "WorkroomEffect" p WHERE p."workCapsuleId"=e."workCapsuleId"
          AND p."sequence" < e."sequence" AND p."status"::text IN ('pending','running'))
      ORDER BY e."sequence" LIMIT ${input.limit} FOR UPDATE OF e SKIP LOCKED)
    UPDATE "WorkroomEffect" w SET "status"='running'::"WorkroomEffectStatus", "leaseOwner"=${input.owner},
      "leaseExpiresAt"=(${input.now}::timestamptz AT TIME ZONE 'UTC') + (${input.leaseMs}::int * interval '1 millisecond'),
      "attemptCount"=w."attemptCount"+1, "updatedAt"=(${input.now}::timestamptz AT TIME ZONE 'UTC')
    FROM candidate, "WorkCapsule" r WHERE w."id"=candidate."id" AND r."id"=w."workCapsuleId"
    RETURNING w."id", w."workCapsuleId", r."capsuleId", w."commandKey", w."kind"::text AS "kind", w."processBound",
      w."sessionGeneration", w."payload", w."attemptCount", w."maxAttempts"`;
  return rows.map((row) => ({ ...row, payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown> }));
}

/** An effect whose worker died mid-run goes back to pending; its attempt was already counted. */
export async function recoverExpiredLeases(db: EffectSqlDb, now: Date): Promise<number> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "WorkroomEffect" SET "status"='pending'::"WorkroomEffectStatus", "leaseOwner"=NULL, "leaseExpiresAt"=NULL,
      "updatedAt"=(${now}::timestamptz AT TIME ZONE 'UTC')
    WHERE "status"='running'::"WorkroomEffectStatus" AND "leaseExpiresAt" < (${now}::timestamptz AT TIME ZONE 'UTC')
    RETURNING "id"`;
  return rows.length;
}

/**
 * Boot: no provider process survived the restart, so every unsettled
 * process-bound effect of a room whose session is not supervised any more, or
 * that belongs to another generation than the room's current one, is retired.
 * Without this a stop decided just before a crash would leave its
 * close-session unclaimable and the revoke behind it blocked for good. A
 * supervised room's current-generation effects are left to its re-attach,
 * which retires them as it opens the new generation and requeues its input.
 */
export async function retireOrphanedEffects(db: EffectSqlDb, now: Date): Promise<number> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "WorkroomEffect" e SET "status"='retired'::"WorkroomEffectStatus", "lastError"='the provider process ended with the portal',
      "settledAt"=(${now}::timestamptz AT TIME ZONE 'UTC'), "updatedAt"=(${now}::timestamptz AT TIME ZONE 'UTC'),
      "leaseOwner"=NULL, "leaseExpiresAt"=NULL
    FROM "WorkCapsule" r
    WHERE r."id"=e."workCapsuleId" AND e."processBound"=true AND e."status"::text IN ('pending','running')
      AND (COALESCE(r."workspaceState"->'runtimeSession'->>'status', '') NOT IN ('supervised', 'open')
        OR (r."workspaceState"->'runtimeSession'->>'generation') IS DISTINCT FROM e."sessionGeneration")
    RETURNING e."id"`;
  return rows.length;
}
