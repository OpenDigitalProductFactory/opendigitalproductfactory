// apps/web/lib/ea/reconcile-network-bridge.ts
//
// Reconcile discovered network reality into the Network Topology SysML projection
// (Parity Engine, living-graph Phase D). Thin IO shell: read EdgeNode hosts +
// InventoryEntity/InventoryRelationship, join relationship FKs to stable entity keys,
// build the desired model (pure extractor), apply via the shared idempotent seeder.
// Re-derives every run, so it cannot drift. Skips cleanly when no discovery data
// exists. db is injectable for tests.

import { prisma } from "@dpf/db";
import {
  buildNetworkTopologyModel,
  type EdgeNodeFact,
  type InventoryEntityFact,
  type InventoryRelFact,
} from "./network-bridge-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

export async function reconcileNetworkTopology(opts: { db?: typeof prisma } = {}): Promise<SysmlSeedResult> {
  const db = opts.db ?? prisma;

  const [edgeRows, entityRows] = await Promise.all([
    db.edgeNode.findMany({
      select: { nodeId: true, platform: true, installMode: true, version: true, status: true, trustState: true, lastSeenAt: true },
    }),
    db.inventoryEntity.findMany({
      select: { id: true, entityKey: true, entityType: true, name: true, technicalClass: true, manufacturer: true, productModel: true, status: true },
    }),
  ]);

  if (edgeRows.length === 0 && entityRows.length === 0) {
    console.warn("[network-topology] no EdgeNode/InventoryEntity rows — skipping");
    return { status: "skipped", created: 0, updated: 0, removed: 0 };
  }

  const idToKey = new Map(entityRows.map((e) => [e.id, e.entityKey]));
  const relRows = entityRows.length
    ? await db.inventoryRelationship.findMany({ select: { fromEntityId: true, toEntityId: true, relationshipType: true } })
    : [];

  const edgeNodes: EdgeNodeFact[] = edgeRows.map((r) => ({
    nodeId: r.nodeId,
    platform: r.platform,
    installMode: r.installMode,
    version: r.version,
    status: r.status,
    trustState: r.trustState,
    lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
  }));
  const entities: InventoryEntityFact[] = entityRows.map((e) => ({
    entityKey: e.entityKey,
    entityType: e.entityType,
    name: e.name,
    technicalClass: e.technicalClass,
    manufacturer: e.manufacturer,
    productModel: e.productModel,
    status: e.status,
  }));
  const relationships: InventoryRelFact[] = relRows.flatMap((r) => {
    const fromEntityKey = idToKey.get(r.fromEntityId);
    const toEntityKey = idToKey.get(r.toEntityId);
    return fromEntityKey && toEntityKey ? [{ fromEntityKey, toEntityKey, relationshipType: r.relationshipType }] : [];
  });

  const result = await applySysmlModel(buildNetworkTopologyModel({ edgeNodes, entities, relationships }), { db: opts.db });
  console.info(
    `[network-topology] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed} (hosts=${edgeNodes.length} entities=${entities.length})`,
  );
  return result;
}
