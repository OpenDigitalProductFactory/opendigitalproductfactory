import { parseScopeClaims } from "@/lib/work-capsules";
import { replaceOwnershipClaims, scopeWriteWhere } from "./scope-input";
import { recordWorkCapsuleActivity } from "./work-capsule-activity-store";
import { classifyScopeRelease, parseScopeReleaseClaims, type ScopeReleaseInput } from "./scope-release-authorization";
import { originalScopeReleaseTargetsMatch } from "./scope-release-targets";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

/** Revalidate the ordinary effect against the write snapshot, then CAS that snapshot. */
export async function releaseWorkCapsuleScope(args: {
  db: CapsuleDb; capsuleId: string; expectedRoomId: string; claims: ScopeReleaseInput[]; actor: WorkCapsuleActor;
  /** Internal result of the current monitor-bound decision, never a tool parameter. */
  ownScopeOnly?: boolean; now?: Date;
}) {
  const write = async (tx: CapsuleDb) => {
    if (tx.$queryRaw) await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "id" = ${args.expectedRoomId} FOR UPDATE`;
    const capsule = await tx.workroom.findUnique({ where: { capsuleId: args.capsuleId } });
    if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);
    const targets = parseScopeReleaseClaims(args.claims);
    if (!targets || !originalScopeReleaseTargetsMatch(capsule, args.expectedRoomId, targets)) {
      throw new Error("Original scope-release target is missing or changed. This request cannot release the current claim.");
    }
    if (args.ownScopeOnly && classifyScopeRelease({ room: capsule, capsuleId: args.capsuleId, expectedRoomId: args.expectedRoomId,
      claims: args.claims, callerPrincipalId: args.actor.principalId, now: args.now ?? new Date() }).consequence) {
      throw new Error("Owned scope or lease changed. Read this Workroom before requesting another release.");
    }
    const keys = new Set(args.claims.map(claim => `${claim.kind}:${claim.value}`));
    const existing = parseScopeClaims(capsule.scopeClaims);
    const scopeClaims = replaceOwnershipClaims(capsule.scopeClaims, existing.filter(claim => !keys.has(`${claim.kind}:${claim.value}`)));
    const released = existing.filter(claim => keys.has(`${claim.kind}:${claim.value}`));
    const updated = await tx.workroom.update({ where: scopeWriteWhere(capsule), data: { scopeClaims } });
    await recordWorkCapsuleActivity(tx, { workCapsuleId: capsule.id, kind: "scope-released",
      summary: `Released ${released.length} scope item(s).`, payload: { released }, actor: args.actor });
    return updated;
  };
  return args.db.$transaction ? args.db.$transaction(write) : write(args.db);
}
