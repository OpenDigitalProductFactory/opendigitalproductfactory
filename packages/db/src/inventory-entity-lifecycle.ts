export const INVENTORY_ENTITY_CANONICAL_WHERE = {
  mergedIntoId: null,
} as const;

export const INVENTORY_RELATIONSHIP_CANONICAL_WHERE = {
  mergedIntoId: null,
  status: { not: "superseded" },
} as const;

type InventoryEntityIdentityDb = {
  inventoryEntity: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; mergedIntoId: true };
    }): Promise<{ id: string; mergedIntoId: string | null } | null>;
  };
};

export async function resolveCanonicalInventoryEntityId(
  db: InventoryEntityIdentityDb,
  entityId: string,
): Promise<string | null> {
  let currentId = entityId;
  const visited = new Set<string>();

  while (!visited.has(currentId)) {
    visited.add(currentId);
    const row = await db.inventoryEntity.findUnique({
      where: { id: currentId },
      select: { id: true, mergedIntoId: true },
    });
    if (!row) return null;
    if (!row.mergedIntoId) return row.id;
    currentId = row.mergedIntoId;
  }

  throw new Error(`InventoryEntity merge lineage contains a cycle at ${currentId}`);
}
