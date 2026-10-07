import type { Prisma } from "@dpf/db";
import { deriveAuthoritativeReadinessProfile, type InitiativeProfileSignals } from "./profiles";
import type { ReadinessProfile } from "./types";

/** Shared dispatch advice and transaction-time validation; history cannot downgrade scope. */
export function deriveReviewerProfile(
  item: InitiativeProfileSignals & { activeBuild?: { kind: string } | null; featureBuilds: { kind: string }[] },
  history: readonly { payload: unknown }[],
): ReadinessProfile | null {
  const recordedProfiles = history.flatMap(({ payload }) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const row = payload as Record<string, unknown>;
    const profile = row.profile ?? row.selectedProfile;
    return (["doc-only", "fix", "feature", "cross-domain", "archetype"] as const).includes(profile as never)
      ? [profile as ReadinessProfile] : [];
  });
  return deriveAuthoritativeReadinessProfile({ ...item, activeBuildKind: item.activeBuild?.kind,
    recordedProfiles: [...recordedProfiles, ...item.featureBuilds.flatMap((build) =>
      build.kind === "fix" ? ["fix" as const] : build.kind === "feature" ? ["feature" as const] : [])],
  });
}

/** Read-only advice. The writer repeats the derivation under its existing lock. */
export async function loadReviewerProfile(db: Pick<Prisma.TransactionClient, "backlogItem">, itemId: string) {
  const item = await db.backlogItem.findUnique({ where: { itemId }, select: {
    type: true, source: true, workType: true, scopeKind: true, archetypeCategories: true, archetypeIds: true,
    activeBuild: { select: { kind: true } }, featureBuilds: { select: { kind: true } },
    activities: { where: { OR: [{ kind: "initiative_scope_baseline" },
      { kind: "initiative_gate_receipt", gateKey: "classification" }] }, select: { payload: true } },
  } });
  return item ? deriveReviewerProfile(item, item.activities) : null;
}
