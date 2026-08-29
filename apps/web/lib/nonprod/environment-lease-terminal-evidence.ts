import { prisma } from "@dpf/db";
import { resolveLocalCiTerminalEvidence } from "@/lib/gates/gate-run-identity";
import type { LocalCiTerminalEvidenceProjection } from "@/lib/gates/gate-run-identity";

type LeaseModel = typeof prisma.nonProductionEnvironmentLease;
type LeaseRow = NonNullable<Awaited<ReturnType<LeaseModel["findUnique"]>>>;
type EvidenceTx = Pick<
  typeof prisma,
  "nonProductionEnvironmentLease" | "externalEvidenceRecord"
>;

/**
 * What a terminal local-CI lease means for the claim standing in front of it.
 *
 * `revived` — the prior run left no usable evidence, so the dead row has been
 * reset and the caller should continue into a normal claim with the returned
 * lease. `settled` — the prior run reached a real conclusion; the projection is
 * the caller's answer.
 */
/** Everything except `rerunnable`, which this module resolves rather than returns. */
type SettledProjection = Exclude<
  LocalCiTerminalEvidenceProjection,
  { status: "rerunnable" }
>;

export type TerminalGateLeaseOutcome =
  | { kind: "revived"; lease: LeaseRow }
  | { kind: "settled"; projection: SettledProjection };

/**
 * Decide whether a terminal gate lease still speaks for its tree (BI-C59AC8AF).
 *
 * `claimKey` is unique, so a terminal row IS that tree's only route back to the
 * gate — and the key hashes the integration tree, not the commit, so a fresh
 * commit of identical content lands on the same row. When the run died without
 * recording anything there is no verdict to protect, and refusing forever
 * bricked the tree. Reset it in place instead. Evidence that exists and does not
 * fit (mismatched, expired) is a real conclusion and still settles the claim.
 */
export async function settleTerminalGateLease(input: {
  tx: EvidenceTx;
  lease: LeaseRow;
  claimKey: string;
  now: Date;
  ttlMs: number;
}): Promise<TerminalGateLeaseOutcome> {
  const projection = await resolveLocalCiTerminalEvidence({
    claimKey: input.claimKey,
    evidenceRecordId: input.lease.evidenceRecordId,
    now: input.now,
    loadEvidence: async (id) => input.tx.externalEvidenceRecord
      ? input.tx.externalEvidenceRecord.findUnique({
        where: { id },
        select: { id: true, operationType: true, details: true },
      })
      : null,
  });

  if (projection.status !== "rerunnable") {
    return { kind: "settled", projection };
  }

  return {
    kind: "revived",
    lease: await input.tx.nonProductionEnvironmentLease.update({
      where: { id: input.lease.id },
      data: {
        status: "queued",
        phase: "waiting",
        admittedAt: null,
        releasedAt: null,
        slotKey: null,
        activeKey: null,
        evidenceRecordId: null,
        requestedTtlMs: input.ttlMs,
        heartbeatAt: input.now,
        expiresAt: new Date(input.now.getTime() + input.ttlMs),
      },
    }),
  };
}
