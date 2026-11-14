// BI-C64EDA33: the Workroom runtime's outbox (WorkroomEffect). Plain SQL over a
// one-method runner, so the same statements run inside a Prisma transaction in
// the portal and against a disposable database in the real-database test.
//
// A room's effects run one at a time, in the order they were decided: an
// effect waiting on its backoff blocks the room's later effects, so a retry
// never races ahead of the work it depends on (T3 Code's EffectOutbox rule,
// pingdotgg/t3code@24e77473, MIT; reproduced, not copied). Lease and attempt
// fields follow AsyncInferenceOp.

import { randomUUID } from "node:crypto";

import { isProcessBound, type EffectIntent, type EffectKind, type EffectSettlement } from "./runtime-decider";

export type SqlRunner = { query<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> };

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

const UNSETTLED = `('pending','running')`;
/** Times are stored as UTC timestamp(3) (Prisma's mapping); a JS Date arrives as timestamptz. */
const utc = (param: string) => `(${param}::timestamptz AT TIME ZONE 'UTC')`;

/** Insert a decision's effects; a replayed decision inserts nothing twice. */
export async function insertEffects(run: SqlRunner, input: {
  roomRowId: string; commandId: string; generation: string | null; effects: EffectIntent[]; now: Date;
}): Promise<void> {
  let ordinal = 0;
  for (const effect of input.effects) {
    const bound = isProcessBound(effect.kind);
    await run.query(
      `INSERT INTO "WorkroomEffect" ("id","workCapsuleId","commandKey","ordinal","kind","processBound","sessionGeneration","payload","status","availableAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5::"WorkroomEffectKind",$6,$7,$8::jsonb,'pending'::"WorkroomEffectStatus",${utc("$9")},${utc("$9")},${utc("$9")})
       ON CONFLICT ("workCapsuleId","commandKey","ordinal") DO NOTHING`,
      [randomUUID(), input.roomRowId, input.commandId, ordinal, effect.kind, bound, bound ? input.generation : null, JSON.stringify(effect.payload), input.now],
    );
    ordinal += 1;
  }
}

/** Retire the room's unsettled process-bound effects decided for any generation but `keepGeneration`. */
export async function retireEffects(run: SqlRunner, input: { roomRowId: string; keepGeneration: string | null; reason: string; now: Date }) {
  return run.query<{ id: string; kind: EffectKind }>(
    `UPDATE "WorkroomEffect" SET "status"='retired'::"WorkroomEffectStatus", "lastError"=$3, "settledAt"=${utc("$4")}, "updatedAt"=${utc("$4")}, "leaseOwner"=NULL, "leaseExpiresAt"=NULL
     WHERE "workCapsuleId"=$1 AND "processBound"=true AND "status"::text IN ${UNSETTLED}
       AND ($2::text IS NULL OR "sessionGeneration" IS DISTINCT FROM $2::text)
     RETURNING "id", "kind"::text AS "kind"`,
    [input.roomRowId, input.keepGeneration, input.reason, input.now],
  );
}

/**
 * Settle a running effect. Guarded by its attempt, so a report from an attempt
 * whose lease already expired (and was claimed again) changes nothing.
 */
export async function settleEffect(run: SqlRunner, settlement: EffectSettlement, now: Date): Promise<boolean> {
  const retry = settlement.status === "pending";
  const rows = await run.query<{ id: string }>(
    `UPDATE "WorkroomEffect" SET "status"=$2::"WorkroomEffectStatus", "lastError"=$3, "leaseOwner"=NULL, "leaseExpiresAt"=NULL, "updatedAt"=${utc("$4")},
       "availableAt"=CASE WHEN $5::boolean THEN ${utc("$4")} + ($6::int * interval '1 millisecond') ELSE "availableAt" END,
       "settledAt"=CASE WHEN $5::boolean THEN NULL ELSE ${utc("$4")} END
     WHERE "id"=$1 AND "status"='running'::"WorkroomEffectStatus" AND "attemptCount"=$7
     RETURNING "id"`,
    [settlement.effectId, settlement.status, settlement.error ?? null, now, retry, settlement.retryAfterMs ?? 0, settlement.attempt],
  );
  return rows.length > 0;
}

/**
 * Lease the oldest runnable effect of each room. Process-bound effects run only
 * in the process that holds their generation, so another portal never answers
 * a provider process it does not own.
 */
export async function claimEffects(run: SqlRunner, input: { owner: string; liveGenerations: string[]; limit: number; leaseMs: number; now: Date }): Promise<ClaimedEffect[]> {
  const rows = await run.query<ClaimedEffect & { payload: unknown }>(
    `WITH candidate AS (
       SELECT e."id" FROM "WorkroomEffect" e
       WHERE e."status"='pending'::"WorkroomEffectStatus" AND e."availableAt" <= ${utc("$5")}
         AND (e."processBound"=false OR e."sessionGeneration" = ANY($2::text[]))
         AND NOT EXISTS (SELECT 1 FROM "WorkroomEffect" p WHERE p."workCapsuleId"=e."workCapsuleId"
           AND p."sequence" < e."sequence" AND p."status"::text IN ${UNSETTLED})
       ORDER BY e."sequence" LIMIT $3 FOR UPDATE OF e SKIP LOCKED)
     UPDATE "WorkroomEffect" w SET "status"='running'::"WorkroomEffectStatus", "leaseOwner"=$1,
       "leaseExpiresAt"=${utc("$5")} + ($4::int * interval '1 millisecond'), "attemptCount"=w."attemptCount"+1, "updatedAt"=${utc("$5")}
     FROM candidate, "WorkCapsule" r WHERE w."id"=candidate."id" AND r."id"=w."workCapsuleId"
     RETURNING w."id", w."workCapsuleId", r."capsuleId", w."commandKey", w."kind"::text AS "kind", w."processBound",
       w."sessionGeneration", w."payload", w."attemptCount", w."maxAttempts"`,
    [input.owner, input.liveGenerations, input.limit, input.leaseMs, input.now],
  );
  return rows.map((row) => ({ ...row, payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown> }));
}

/** An effect whose worker died mid-run goes back to pending; its attempt was already counted. */
export async function recoverExpiredLeases(run: SqlRunner, now: Date): Promise<number> {
  const rows = await run.query<{ id: string }>(
    `UPDATE "WorkroomEffect" SET "status"='pending'::"WorkroomEffectStatus", "leaseOwner"=NULL, "leaseExpiresAt"=NULL, "updatedAt"=${utc("$1")}
     WHERE "status"='running'::"WorkroomEffectStatus" AND "leaseExpiresAt" < ${utc("$1")} RETURNING "id"`,
    [now],
  );
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
export async function retireOrphanedEffects(run: SqlRunner, now: Date): Promise<number> {
  const rows = await run.query<{ id: string }>(
    `UPDATE "WorkroomEffect" e SET "status"='retired'::"WorkroomEffectStatus", "lastError"='the provider process ended with the portal',
       "settledAt"=${utc("$1")}, "updatedAt"=${utc("$1")}, "leaseOwner"=NULL, "leaseExpiresAt"=NULL
     FROM "WorkCapsule" r
     WHERE r."id"=e."workCapsuleId" AND e."processBound"=true AND e."status"::text IN ${UNSETTLED}
       AND (COALESCE(r."workspaceState"->'runtimeSession'->>'status', '') NOT IN ('supervised', 'open')
         OR (r."workspaceState"->'runtimeSession'->>'generation') IS DISTINCT FROM e."sessionGeneration")
     RETURNING e."id"`,
    [now],
  );
  return rows.length;
}
