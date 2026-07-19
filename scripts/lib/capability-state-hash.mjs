import { createHash } from "node:crypto";

/**
 * Compute the canonical capability snapshot hash.
 * @param {string} catalogHash
 * @param {Readonly<Record<string, string>> | readonly string[]} statesOrEnabled
 * @param {readonly string[]} [catalogCapabilityIds]
 */
export function computeCapabilityStateVersion(catalogHash, statesOrEnabled, catalogCapabilityIds) {
  let states;
  if (Array.isArray(statesOrEnabled)) {
    if (!catalogCapabilityIds) throw new Error("capability_catalog_ids_required");
    if (new Set(statesOrEnabled).size !== statesOrEnabled.length) throw new Error("duplicate_capability_state");
    const enabled = new Set(statesOrEnabled);
    states = Object.fromEntries(catalogCapabilityIds.map((id) => [id, enabled.has(id) ? "active" : "disabled"]));
  } else {
    states = statesOrEnabled;
  }
  const stateLines = Object.entries(states).map(([id, state]) => `${id}=${state}`).sort().join("\n");
  return createHash("sha256").update(`${catalogHash}\n${stateLines}`).digest("hex");
}
