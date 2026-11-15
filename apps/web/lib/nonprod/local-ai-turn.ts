import { prisma } from "@dpf/db";
import { lockNonprodEnvironment } from "./environment-lease-lock";
import { freshLeaseBirthFields } from "./environment-lease-provenance";
import { AI_TURN_CLAIM_PREFIX, AI_TURN_TTL_MS } from "./environment-lease-overseer";

// BI-218A4555: local AI work (semantic reviews above all) never took a lease.
// It deferred whenever a gate was active and rechecked on a 30 s to 5 min
// backoff, so back-to-back gates could starve it indefinitely: nothing in the
// queue said a review was waiting.
//
// Now a deferred local AI dispatch puts ONE queued "AI turn" lease in the
// local-integration-ci queue. The overseer orders it like any waiter (gates
// and AI turns alternate). While it is live and first, no gate admits itself
// past it, so the slot drains; the next local AI dispatch finds the host free,
// proceeds, and settles the turn. If nobody comes back for it, it stops
// blocking after AI_TURN_LIVENESS_MS and expires after AI_TURN_TTL_MS.

const ENVIRONMENT_KEY = "local-integration-ci";
const OWNER_SESSION_ID = "local-inference";

type TurnTx = Pick<typeof prisma, "$executeRaw" | "nonProductionEnvironmentLease"> & Partial<Pick<typeof prisma, "$queryRaw">>;
type TurnDb = Pick<typeof prisma, "$transaction">;

async function inTurnTransaction<T>(db: TurnDb, body: (tx: TurnTx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await lockNonprodEnvironment(tx as TurnTx, ENVIRONMENT_KEY);
    return body(tx as TurnTx);
  }, { isolationLevel: "ReadCommitted" });
}

/** Record that local AI work is waiting for the shared host. Idempotent: one turn row at a time. */
export async function recordLocalAiDemand(input: { db?: TurnDb; now?: Date } = {}): Promise<{ leaseId: string; created: boolean }> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  return inTurnTransaction(db, async (tx) => {
    const existing = await tx.nonProductionEnvironmentLease.findFirst({
      where: { environmentKey: ENVIRONMENT_KEY, status: "queued", claimKey: { startsWith: AI_TURN_CLAIM_PREFIX } },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
      select: { id: true, leaseId: true },
    });
    const expiresAt = new Date(now.getTime() + AI_TURN_TTL_MS);
    if (existing) {
      await tx.nonProductionEnvironmentLease.update({
        where: { id: existing.id },
        data: { heartbeatAt: now, expiresAt, phase: "waiting" },
      });
      return { leaseId: existing.leaseId, created: false };
    }
    const birth = await freshLeaseBirthFields(tx);
    await tx.nonProductionEnvironmentLease.create({
      data: {
        ...birth,
        claimKey: `${AI_TURN_CLAIM_PREFIX}local:${birth.leaseId}`,
        environmentKey: ENVIRONMENT_KEY,
        status: "queued",
        ownerProvider: "coworker",
        ownerSessionId: OWNER_SESSION_ID,
        purpose: "AI review turn: local AI work (such as a semantic review) is waiting for the shared host",
        url: "local-inference://host",
        ports: [],
        requestedTtlMs: AI_TURN_TTL_MS,
        expiresAt,
        queuedAt: now,
        heartbeatAt: now,
        phase: "waiting",
      },
    });
    return { leaseId: birth.leaseId, created: true };
  });
}

/**
 * The host was free and local AI work is proceeding: close the turn. Recording
 * admittedAt makes the class turn favour gates next.
 */
export async function settleLocalAiTurn(input: { db?: TurnDb; now?: Date } = {}): Promise<{ settled: number }> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const result = await inTurnTransaction(db, (tx) => tx.nonProductionEnvironmentLease.updateMany({
    where: { environmentKey: ENVIRONMENT_KEY, status: "queued", claimKey: { startsWith: AI_TURN_CLAIM_PREFIX } },
    data: { status: "released", admittedAt: now, releasedAt: now, phase: "served" },
  }));
  return { settled: result.count };
}
