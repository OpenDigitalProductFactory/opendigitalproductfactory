// BI-C7151B1B — read this installation's device id WITHOUT minting one.
//
// `resolveFederationIdentity` creates the identity row if it is absent, which is
// right for a federation call and wrong for an MCP handshake: a read-shaped
// operation that a client performs on every connect must not have a side effect,
// and an install that has never federated must still be able to say which
// installation it is.
//
// So this reads the stored value and reports null when there is none. The
// handshake names the installation by estate and role either way; the device id
// is the extra, unforgeable discriminator when it exists.

import {
  isDeviceId,
  shortDeviceId,
} from "@/lib/federation/instance-identity";

/** PlatformConfig key holding the federation identity blob. */
export const FEDERATION_IDENTITY_KEY = "federation.identity";

export interface DeviceIdStore {
  readConfig(key: string): Promise<unknown>;
}

/**
 * The short, human-comparable device id for this installation, or null.
 *
 * Never throws: every failure path — no row, malformed row, unreachable
 * PlatformConfig — returns null, because failing to read an optional
 * discriminator must never fail the handshake that carries it.
 */
export async function readShortDeviceId(store: DeviceIdStore): Promise<string | null> {
  try {
    const raw = await store.readConfig(FEDERATION_IDENTITY_KEY);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const deviceId = (raw as Record<string, unknown>)["deviceId"];
    return isDeviceId(deviceId) ? shortDeviceId(deviceId) : null;
  } catch {
    return null;
  }
}
