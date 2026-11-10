import localCiSlotResources from "./local-ci-slot-resources.json";

type NonprodSlotKey = keyof typeof localCiSlotResources.slots;
const NONPROD_SLOT_KEYS = Object.freeze(
  Object.keys(localCiSlotResources.slots) as NonprodSlotKey[],
);

export type NonprodSlotBinding = {
  manifestVersion: 1;
  slotKey: "slot-0" | "slot-1";
  url: string;
  ports: number[];
  cleanupCommand: string;
};

function expectedLocalCiSlotBinding(slotKey: NonprodSlotKey) {
  const resources = localCiSlotResources.slots[slotKey];
  return {
    manifestVersion: localCiSlotResources.schemaVersion,
    slotKey,
    url: `http://localhost:${resources.portalPort}`,
    ports: [resources.portalPort, resources.postgresPort],
    cleanupCommand: `node scripts/local-ci-slot-cleanup.mjs --slot-key ${slotKey}`,
  };
}

/**
 * A slot-aware runner may renew only under the exact manifest binding the
 * lease was admitted with. Throws the same contract errors the renewal path
 * always has; extracted from environment-lease.ts unchanged.
 */
export function assertRenewalSlotBinding(
  lease: { slotKey: string | null; slotManifestVersion: number | null },
  slotBinding: NonprodSlotBinding,
): void {
  const slotKey = lease.slotKey as NonprodSlotKey | null;
  if (
    !slotKey
    || !NONPROD_SLOT_KEYS.includes(slotKey)
    || lease.slotManifestVersion !== slotBinding.manifestVersion
    || slotKey !== slotBinding.slotKey
  ) {
    throw new Error("nonprod_slot_binding_mismatch");
  }
  const expected = expectedLocalCiSlotBinding(slotKey);
  if (
    slotBinding.manifestVersion !== expected.manifestVersion
    || slotBinding.url !== expected.url
    || slotBinding.cleanupCommand !== expected.cleanupCommand
    || slotBinding.ports.length !== expected.ports.length
    || slotBinding.ports.some((port, index) => port !== expected.ports[index])
  ) {
    throw new Error("nonprod_slot_resource_binding_mismatch");
  }
}
