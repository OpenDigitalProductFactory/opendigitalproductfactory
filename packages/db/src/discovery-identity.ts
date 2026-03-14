export type DiscoveredKeyInput = {
  sourceKind: string;
  itemType: string;
  externalRef: string;
};

export type InventoryEntityKeyInput = {
  entityType: string;
  naturalKey: string;
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
  return [
    normalizeKeyPart(input.entityType),
    normalizeKeyPart(input.naturalKey),
  ].join(":");
}
