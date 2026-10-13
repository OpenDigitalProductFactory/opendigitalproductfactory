import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { prisma } from "@dpf/db";
import type { BacklogCompletionDependencies } from "@/lib/backlog/initiative-readiness/backlog-completion-evaluation";
import { resolveBacklogDeploymentClosure } from "@/lib/backlog/initiative-readiness/deployment-closure";
import { mergeSignalRoots, refreshMergeSignalTrunk, resolveMergeDeliveryFromDb } from "@/lib/backlog/initiative-readiness/merge-delivery-signal";

type SignalDb = Pick<typeof prisma, "backlogItem" | "backlogItemActivity" | "workroom" | "selfUpgradeRun" | "contributorInventorySnapshot">;
type Model = keyof SignalDb;
type ReadMethod = "findUnique" | "findFirst" | "findMany";
type Read = { model: Model; method: ReadMethod; args: unknown; value: string };
type ReadDelegate = Record<ReadMethod, (args: unknown) => Promise<unknown>>;
// Canonical JSON intentionally does not call Date.toJSON; normalize DB dates
// first so completedAt/recordedAt remain load-bearing comparison inputs.
const fingerprint = (value: unknown) => canonicalJson(JSON.parse(JSON.stringify(value)));

/**
 * Prepare slow external signals without holding task/backlog locks. Replay the
 * exact database reads inside the terminal transaction before using the signal.
 * A changed input fails closed; no cached verdict crosses a changed delivery
 * attempt, tenant, work shape or evidence input. All other readiness is still
 * evaluated by the existing terminal service on its transaction client.
 */
export async function prepareSweepCompletionSignals(db: SignalDb, rowId: string): Promise<{
  dependencies: BacklogCompletionDependencies;
  assertCurrent(tx: SignalDb): Promise<void>;
}> {
  const reads: Read[] = [];
  let readFailed = false;
  const capture = Object.fromEntries((["backlogItem", "backlogItemActivity", "workroom", "selfUpgradeRun", "contributorInventorySnapshot"] as const).map(model => [model,
    Object.fromEntries((["findUnique", "findFirst", "findMany"] as const).map(method => [method, async (args: unknown) => {
      try {
        const value = await (db[model] as unknown as ReadDelegate)[method](args);
        reads.push({ model, method, args: structuredClone(args), value: fingerprint(value) });
        return value;
      } catch (error) { readFailed = true; throw error; }
    }])),
  ])) as unknown as SignalDb;
  const item = await capture.backlogItem.findUnique({ where: { id: rowId }, select: { id: true, itemId: true, workType: true } });
  if (!item) throw new Error("Acceptance completion item disappeared");
  await refreshMergeSignalTrunk();
  const identity = { itemRowId: item.id, itemId: item.itemId, workType: item.workType };
  const merge = await resolveMergeDeliveryFromDb(capture, identity);
  const deployment = await resolveBacklogDeploymentClosure({ itemId: item.itemId, workType: item.workType, roots: mergeSignalRoots(), db: capture });
  if (readFailed) throw new Error("Acceptance completion signal inputs unavailable");
  const preparedAt = Date.now();
  const sameItem = (args: { itemId: string; workType?: string | null }) => {
    if (args.itemId !== item.itemId || args.workType !== item.workType
      || ("itemRowId" in args && args.itemRowId !== item.id)) throw new Error("Acceptance completion identity changed");
  };
  return {
    dependencies: {
      resolveMergeDelivery: async args => { sameItem(args); return merge; },
      resolveDeploymentClosure: async args => { sameItem(args); return deployment; },
    },
    assertCurrent: async tx => {
      if (Date.now() - preparedAt > 30_000) throw new Error("Acceptance completion signals expired");
      for (const read of reads) {
        const value = await (tx[read.model] as unknown as ReadDelegate)[read.method](read.args);
        if (fingerprint(value) !== read.value) throw new Error("Acceptance completion signal inputs changed");
      }
    },
  };
}
