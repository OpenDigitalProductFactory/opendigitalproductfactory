export type InventoryEntityMergeReference = {
  model: string;
  table: string;
  field: string;
};

export const INVENTORY_ENTITY_MERGE_REFERENCES: {
  hard: readonly InventoryEntityMergeReference[];
  soft: readonly InventoryEntityMergeReference[];
} = {
  hard: [],
  soft: [],
};
