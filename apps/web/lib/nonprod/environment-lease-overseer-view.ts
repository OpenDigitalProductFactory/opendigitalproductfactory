import { prisma } from "@dpf/db";
import {
  buildServiceHistory,
  classifyLease,
  decideHoldBound,
  explainQueue,
  orderWaiters,
  OVERSEER_POLICY_VERSION,
  SERVICE_LOOKBACK_MS,
  type QueueExplanation,
} from "./environment-lease-overseer";
import { admittedLeaseTtlMs, DEFAULT_LEASE_TTL_MS } from "./environment-lease-timing";

type ViewDb = Pick<typeof prisma, "nonProductionEnvironmentLease">;

export type OverseerHoldView = {
  leaseId: string;
  holdClass: string;
  ownerProvider: string;
  ownerSessionId: string;
  admittedAt: string | null;
  /** When this hold must yield if someone else is waiting; null = unbounded. */
  holdBoundAt: string | null;
  contended: boolean;
};

export type OverseerEnvironmentView = {
  environmentKey: string;
  policyVersion: typeof OVERSEER_POLICY_VERSION;
  holding: OverseerHoldView[];
  queue: Array<QueueExplanation & { ownerProvider: string; ownerSessionId: string; purpose: string }>;
};

/**
 * Who holds each shared environment, who waits, in what order and why
 * (BI-218A4555 AC-OVS-7). Read-only; the same policy functions that order
 * admission produce it, so the view cannot disagree with the planner.
 */
export async function readOverseerQueues(input: { db?: ViewDb; now?: Date } = {}): Promise<OverseerEnvironmentView[]> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const rows = await db.nonProductionEnvironmentLease.findMany({
    where: {
      OR: [
        { status: { in: ["active", "queued"] }, expiresAt: { gt: now } },
        { admittedAt: { gte: new Date(now.getTime() - SERVICE_LOOKBACK_MS) } },
      ],
    },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
  });
  const environments = [...new Set(rows
    .filter((row) => row.status === "active" || row.status === "queued")
    .map((row) => row.environmentKey))].sort();
  return environments.map((environmentKey) => {
    const envRows = rows.filter((row) => row.environmentKey === environmentKey);
    const history = buildServiceHistory(envRows, now);
    const livenessWindowMs = admittedLeaseTtlMs(environmentKey, DEFAULT_LEASE_TTL_MS);
    const active = envRows.filter((row) => row.status === "active" && row.expiresAt > now);
    const waiters = envRows.filter((row) => row.status === "queued" && row.expiresAt > now);
    const ordered = orderWaiters(waiters, history, environmentKey);
    const byId = new Map(ordered.map((row) => [row.id, row]));
    const explanations = explainQueue({
      ordered,
      active,
      capacity: Math.max(1, active.length),
      history,
      waiterLivenessWindowMs: livenessWindowMs,
    });
    return {
      environmentKey,
      policyVersion: OVERSEER_POLICY_VERSION,
      holding: active.map((holder) => {
        const decision = decideHoldBound({ holder, waiters, now, waiterLivenessWindowMs: livenessWindowMs });
        return {
          leaseId: holder.leaseId,
          holdClass: classifyLease(holder).holdClass,
          ownerProvider: holder.ownerProvider,
          ownerSessionId: holder.ownerSessionId,
          admittedAt: holder.admittedAt?.toISOString() ?? null,
          holdBoundAt: decision.kind === "unbounded" ? null : decision.holdBoundAt.toISOString(),
          contended: decision.contended,
        };
      }),
      queue: explanations.map((entry) => {
        const row = byId.get(entry.leaseId)!;
        return {
          ...entry,
          leaseId: row.leaseId,
          ownerProvider: row.ownerProvider,
          ownerSessionId: row.ownerSessionId,
          purpose: row.purpose,
        };
      }),
    };
  });
}
