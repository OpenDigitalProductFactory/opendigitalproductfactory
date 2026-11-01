import "server-only";

import { objectRecord, originalToolParameters, envelopeIdFromExecutionResult } from "@/lib/attention/coworker-envelope-decision";
import { fingerprintCoworkerInput, fingerprintCoworkerApprovalBinding, type CoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";
import { isNonprodEnvironmentKey, lockNonprodEnvironment } from "@/lib/nonprod/environment-lease-lock";
import { canTransition, type EnvelopeStatus } from "./envelope-state-machine";

const TOOL = "release_nonprod_environment_lease";
export const OBSOLETE_RELEASE_PAGE_SIZE = 200;
const EXECUTION_LIMIT = 25;

type ParkedCall = {
  envelopeId: string | null; toolName: string; userId: string; agentId: string;
  taskRunId: string | null; success: boolean; parameters: unknown; result: unknown;
};
export type ObsoleteReleaseEnvelope = {
  id: string; status: string; resolvedAt: Date | null; taskRunId: string | null;
  manifestActionId: string; delegatingUserId: string; coworkerAgentId: string;
  argsJson: unknown; inputFingerprint: string | null; approvalBindingFingerprint: string | null;
  toolExecutions: ParkedCall[];
};
export type ObsoleteReleaseTarget = {
  leaseId: string; environmentKey: string; ownerSessionId: string; status: string;
  releasedAt: Date | null; admittedAt: Date | null; slotManifestVersion: number | null;
  activeKey: string | null; slotKey: string | null; ownerPid: number | null;
  ownerProcessIdentity: string | null; cleanupCommand: string | null;
  resourceClass: string | null; expectedMemoryBytes: bigint | null;
};
type SettlementTx = {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  nonProductionEnvironmentLease: { findUnique(args: unknown): Promise<ObsoleteReleaseTarget | null> };
  coworkerActionEnvelope: { updateMany(args: unknown): Promise<{ count: number }> };
};
export type ObsoleteReleaseDb = Omit<SettlementTx, "$executeRaw"> & {
  coworkerActionEnvelope: SettlementTx["coworkerActionEnvelope"] & {
    findMany(args: unknown): Promise<ObsoleteReleaseEnvelope[]>;
  };
  $transaction<T>(run: (tx: SettlementTx) => Promise<T>): Promise<T>;
};
export type ObsoleteReleaseSummary = {
  scanned: number; cancelled: number; skipped: number; inconclusive: number;
  hasMore: boolean; nextCursor: string | null;
  reason: "target-reservation-ended-before-admission";
  settled: Array<{ envelopeId: string; leaseId: string }>;
};

function exactReleaseTarget(row: ObsoleteReleaseEnvelope): { leaseId: string; ownerSessionId: string } | null {
  if (!row.delegatingUserId.trim() || !row.coworkerAgentId.trim()
    || row.manifestActionId !== TOOL || row.taskRunId !== null || row.resolvedAt !== null
    || !["proposed", "approved"].includes(row.status)
    || !canTransition(row.status as EnvelopeStatus, "cancelled")) return null;
  const binding = objectRecord(objectRecord(row.argsJson)?.approvalBinding);
  if (!binding || binding.toolName !== TOOL || binding.actingHumanUserId !== row.delegatingUserId
    || binding.actingAgentId !== row.coworkerAgentId || binding.taskRunId !== null
    || binding.inputFingerprint !== row.inputFingerprint || !row.inputFingerprint
    || !row.approvalBindingFingerprint || !row.toolExecutions.length
    || row.toolExecutions.length > EXECUTION_LIMIT) return null;
  const typed = binding as CoworkerApprovalBinding;
  if (fingerprintCoworkerApprovalBinding(typed) !== row.approvalBindingFingerprint) return null;
  let target: { leaseId: string; ownerSessionId: string } | null = null;
  for (const call of row.toolExecutions) {
    const result = objectRecord(call.result);
    const params = originalToolParameters(call.parameters);
    if (call.envelopeId !== row.id || call.toolName !== TOOL || call.userId !== row.delegatingUserId
      || call.agentId !== row.coworkerAgentId || call.taskRunId !== null || call.success !== false
      || result?.success !== false || result.error !== "approval_required"
      || envelopeIdFromExecutionResult(result) !== row.id || !params
      || fingerprintCoworkerInput(params, typed.authorResearchBinding) !== row.inputFingerprint
      || typeof params.leaseId !== "string" || !params.leaseId.trim()
      || typeof params.ownerSessionId !== "string" || !params.ownerSessionId.trim()) return null;
    target = { leaseId: params.leaseId, ownerSessionId: params.ownerSessionId };
  }
  return target;
}

function endedWithoutResources(lease: ObsoleteReleaseTarget, target: { leaseId: string; ownerSessionId: string }, now: Date): boolean {
  return lease.leaseId === target.leaseId && lease.ownerSessionId === target.ownerSessionId
    && ["cancelled", "expired"].includes(lease.status) && lease.slotManifestVersion === 1
    && lease.releasedAt instanceof Date && Number.isFinite(lease.releasedAt.getTime()) && lease.releasedAt <= now
    && lease.admittedAt === null && lease.activeKey === null && lease.slotKey === null
    && lease.ownerPid === null && lease.ownerProcessIdentity === null && lease.cleanupCommand === null
    && lease.resourceClass === null && lease.expectedMemoryBytes === null;
}

/** Settle lifecycle only: never authorizes a request or invokes a release handler.
 * The cursor is checkpointed by the existing concierge activity, so unchanged
 * malformed/active prefixes cannot monopolise every bounded pass. */
export async function settleObsoleteLeaseReleaseEnvelopes(
  db: ObsoleteReleaseDb, now: Date, afterId?: string | null,
): Promise<ObsoleteReleaseSummary> {
  const rows = await db.coworkerActionEnvelope.findMany({
    where: { manifestActionId: TOOL, taskRunId: null, status: { in: ["proposed", "approved"] }, resolvedAt: null,
      ...(afterId ? { id: { gt: afterId } } : {}) },
    orderBy: { id: "asc" }, take: OBSOLETE_RELEASE_PAGE_SIZE + 1,
    select: { id: true, status: true, resolvedAt: true, taskRunId: true, manifestActionId: true,
      delegatingUserId: true, coworkerAgentId: true, argsJson: true, inputFingerprint: true,
      approvalBindingFingerprint: true,
      toolExecutions: { orderBy: { id: "asc" }, take: EXECUTION_LIMIT + 1,
        select: { envelopeId: true, toolName: true, userId: true, agentId: true, taskRunId: true,
          success: true, parameters: true, result: true } } },
  });
  const page = rows.slice(0, OBSOLETE_RELEASE_PAGE_SIZE);
  const summary: ObsoleteReleaseSummary = { scanned: page.length, cancelled: 0, skipped: 0, inconclusive: 0,
    hasMore: rows.length > page.length, nextCursor: rows.length > page.length ? page.at(-1)!.id : null,
    reason: "target-reservation-ended-before-admission", settled: [] };
  for (const row of page) {
    try {
      if (row.toolExecutions.length > EXECUTION_LIMIT) { summary.inconclusive++; continue; }
      const target = exactReleaseTarget(row);
      if (!target) { summary.skipped++; continue; }
      const snapshot = await db.nonProductionEnvironmentLease.findUnique({ where: { leaseId: target.leaseId } });
      if (!snapshot || !isNonprodEnvironmentKey(snapshot.environmentKey) || !endedWithoutResources(snapshot, target, now)) {
        summary.skipped++; continue;
      }
      const count = await db.$transaction(async tx => {
        // Claims can revive terminal gate rows. Share their lock, then re-read.
        await lockNonprodEnvironment(tx, snapshot.environmentKey);
        const lease = await tx.nonProductionEnvironmentLease.findUnique({ where: { leaseId: target.leaseId } });
        if (!lease || lease.environmentKey !== snapshot.environmentKey || !endedWithoutResources(lease, target, now)) return 0;
        return (await tx.coworkerActionEnvelope.updateMany({
          where: { id: row.id, status: row.status, resolvedAt: null, taskRunId: null, manifestActionId: TOOL,
            inputFingerprint: row.inputFingerprint, approvalBindingFingerprint: row.approvalBindingFingerprint,
            argsJson: { equals: row.argsJson } },
          data: { status: "cancelled", resolvedAt: now },
        })).count;
      });
      if (count === 1) { summary.cancelled++; summary.settled.push({ envelopeId: row.id, leaseId: target.leaseId }); }
      else summary.skipped++;
    } catch {
      // No failed proof is authority. The failed transaction changes nothing.
      summary.inconclusive++;
    }
  }
  return summary;
}
