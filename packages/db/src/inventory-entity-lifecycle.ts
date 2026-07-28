export const INVENTORY_ENTITY_CANONICAL_WHERE = {
  mergedIntoId: null,
} as const;

export const INVENTORY_RELATIONSHIP_CANONICAL_WHERE = {
  mergedIntoId: null,
  status: { not: "superseded" },
} as const;
