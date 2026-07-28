export type InventoryEntityHeapIntegrityTx = {
  $executeRawUnsafe(query: string): Promise<number>;
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
};

export class InventoryEntityIntegrityError extends Error {
  readonly code = "INVENTORY_ENTITY_HEAP_INTEGRITY";
}

export async function assertInventoryEntityHeapIntegrity(
  _tx: InventoryEntityHeapIntegrityTx,
  _entityKeys: readonly string[],
): Promise<void> {}
