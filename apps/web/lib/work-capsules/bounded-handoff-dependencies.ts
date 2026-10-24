import type { Prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { NONPROD_TERMINAL_LEASE_STATUSES } from "@/lib/nonprod/environment-lease-lock";
import { BoundedHandoffRefusal } from "./bounded-handoff-command";

type DependencyDb = Pick<Prisma.TransactionClient, "$queryRaw" | "nonProductionEnvironmentLease" | "externalEvidenceRecord">;
export type HandoffDependencyCapsule = {
  id: string; capsuleId: string; featureBuildId: string | null;
  repositoryFullName: string | null; headSha: string | null; headBranch: string | null;
  executorKind: string | null; executorRef: string | null;
};
const MAX_CURRENT_EXEMPTIONS = 100;
const unavailable = () => new BoundedHandoffRefusal("handoff-dependency-unavailable",
  "The room's lease or policy evidence could not be completely checked. Restore that dependency before requesting the handoff.");

/** Called after the canonical environment locks and room lock. Preview calls
 * use the same reads, but are never proof that the transactional writer may act. */
export async function assertBoundedHandoffDependencies(db: DependencyDb, input: {
  capsule: HandoffDependencyCapsule; sourceExecutorRef: string; destinationExecutorRef: string;
}): Promise<void> {
  const { capsule } = input;
  if (capsule.featureBuildId) throw new BoundedHandoffRefusal("handoff-build-dependency",
    "This room has a Build Studio association. Use its governed executor handover.");
  const refs = [...new Set([input.sourceExecutorRef, input.destinationExecutorRef])];
  try {
    // TTL never proves absence: queued, expired-but-active and unknown states
    // all refuse. A single match is sufficient; no relevant history is dropped.
    const lease = await db.nonProductionEnvironmentLease.findFirst({
      where: { ownerSessionId: { in: refs }, status: { notIn: [...NONPROD_TERMINAL_LEASE_STATUSES] } },
      select: { leaseId: true, ownerSessionId: true, status: true, environmentKey: true },
    });
    if (lease) throw new BoundedHandoffRefusal("handoff-lease-dependency",
      "Executor " + lease.ownerSessionId + " still holds lease " + lease.leaseId + ". Its owner must release or cancel that lease before the handoff.");
    // An exemption cannot bind an absent repository/head. Its publisher takes
    // this room lock and rechecks both before inserting a record.
    if (!capsule.headSha || !capsule.repositoryFullName) return;
    const [clock] = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime())) throw unavailable();
    const candidates = await db.externalEvidenceRecord.findMany({
      where: { workCapsuleId: capsule.id, operationType: "semantic-change-review.exemption",
        details: { path: ["sourceHeadSha"], equals: capsule.headSha } },
      orderBy: { id: "asc" }, take: MAX_CURRENT_EXEMPTIONS + 1,
      select: { id: true, details: true },
    });
    if (candidates.length > MAX_CURRENT_EXEMPTIONS) throw unavailable();
    for (const candidate of candidates) {
      const value = candidate.details;
      if (!isRecord(value)) throw unavailable();
      // Only positively different bindings prove irrelevance. Missing binding
      // fields on a current-head candidate are potentially applicable.
      if (typeof value.sourceRepository === "string" && value.sourceRepository !== capsule.repositoryFullName) continue;
      if (typeof value.sourceBranch === "string" && value.sourceBranch !== capsule.headBranch) continue;
      if (typeof value.sourceExecutorRef === "string" && !refs.includes(value.sourceExecutorRef)) continue;
      const expiry = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : NaN;
      if (!Number.isFinite(expiry)) throw unavailable();
      if (expiry <= clock.now.getTime()) continue;
      if (value.sourceRepository !== capsule.repositoryFullName || value.sourceBranch !== capsule.headBranch
        || typeof value.sourceExecutorRef !== "string") throw unavailable();
      throw new BoundedHandoffRefusal("handoff-policy-exemption-dependency",
        "Current policy exception " + candidate.id + " depends on this executor. Reconcile that exception through its owner before changing the executor.");
    }
  } catch (error) {
    if (error instanceof BoundedHandoffRefusal) throw error;
    throw unavailable();
  }
}
