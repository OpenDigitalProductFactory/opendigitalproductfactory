// The delivered build's proof, recorded on the item it originated (BI-05AFEB9A).
//
// Objective mapping maps the baseline's criteria to the item's own evidence
// recorded at or after that baseline (selectEligibleObjectiveEvidenceActivityIds).
// A Build Studio item had none: verification, the merged PR and the deployed
// runtime are all facts of the build. Recorded in the transaction that minted
// the baseline, so it always falls inside the eligible window. It is delivery
// evidence, never acceptance: the steward coworker still verifies the criteria
// on the live install.

type DeliveryEvidenceClient = {
  backlogItemActivity: {
    findMany(args: unknown): Promise<Array<{ kind: string; recordedAt: Date; payload: unknown }>>;
    create(args: unknown): Promise<unknown>;
  };
  featurePack: { findFirst(args: unknown): Promise<{ prUrl: string | null } | null> };
};

function deliveredBuildId(payload: unknown): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>).deliveredBuildId : undefined;
}

/** Record the build's delivery once per baseline. Returns whether a row was written. */
export async function recordBuildDeliveryEvidence(client: DeliveryEvidenceClient, args: {
  itemRowId: string;
  buildRowId: string;
  buildId: string;
  recordedById: string;
  deployedSha: string | null;
}): Promise<boolean> {
  const baselines = await client.backlogItemActivity.findMany({
    where: { backlogItemId: args.itemRowId, kind: "initiative_scope_baseline" },
    select: { kind: true, recordedAt: true, payload: true },
  });
  const latest = baselines.reduce<Date | null>((at, row) => (!at || row.recordedAt > at ? row.recordedAt : at), null);
  if (!latest) return false;
  const evidence = await client.backlogItemActivity.findMany({
    where: { backlogItemId: args.itemRowId, kind: "evidence", recordedAt: { gte: latest } },
    select: { kind: true, recordedAt: true, payload: true },
  });
  if (evidence.some((row) => deliveredBuildId(row.payload) === args.buildId)) return false;
  const pack = await client.featurePack.findFirst({
    where: { buildId: args.buildRowId, prUrl: { not: null } },
    select: { prUrl: true },
  });
  const deployed = args.deployedSha ? `the deployed runtime ${args.deployedSha.slice(0, 12)} contains its merge` : "its merge is deployed";
  await client.backlogItemActivity.create({
    data: {
      backlogItemId: args.itemRowId,
      kind: "evidence",
      summary: `${args.buildId} delivered: verification passed, its pull request merged, and ${deployed}.`,
      payload: {
        evidenceKind: "build_pass",
        url: pack?.prUrl ?? null,
        body: `Build Studio ${args.buildId} passed review verification, merged${pack?.prUrl ? ` (${pack.prUrl})` : ""}, and ${deployed}. Delivery evidence only; acceptance is verified on the live install by an independent coworker.`,
        toolExecutionId: null,
        deliveredBuildId: args.buildId,
      },
      recordedById: args.recordedById,
      recordedByAgentId: null,
    },
  });
  return true;
}
