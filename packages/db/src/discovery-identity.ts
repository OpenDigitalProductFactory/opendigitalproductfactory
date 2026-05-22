export type DiscoveredKeyInput = {
  sourceKind: string;
  itemType: string;
  externalRef: string;
};

export type InventoryEntityKeyInput = {
  entityType: string;
  naturalKey: string;
  scopeKey?: string | null;
};

function normalizeKeyPart(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}

export function buildDiscoveredKey(input: DiscoveredKeyInput): string {
  return [
    normalizeKeyPart(input.sourceKind),
    normalizeKeyPart(input.itemType),
    normalizeKeyPart(input.externalRef),
  ].join(":");
}

export function buildInventoryEntityKey(input: InventoryEntityKeyInput): string {
  const parts = [
    input.scopeKey ? normalizeKeyPart(input.scopeKey) : null,
    normalizeKeyPart(input.entityType),
    normalizeKeyPart(input.naturalKey),
  ].filter((part): part is string => Boolean(part));

  return parts.join(":");
}
