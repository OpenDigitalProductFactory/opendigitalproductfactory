// EP-MSP-FEDERATION · BI-105966A1 — what this install says about itself when a
// nearby Edge Node asks.
//
// The zero-touch chain (design §5.4-§5.10) is complete and waits on an input
// nothing produced: a nearby candidate. A candidate needs two halves — something
// to find, and something looking. This is the half that is findable.
//
// It rides the portal's ordinary HTTP surface rather than multicast, because on
// the host classes DPF actually ships to (Docker Desktop on Windows and macOS,
// per the edge-node deployment matrix) a container cannot reach the LAN's
// multicast groups at all, while the portal's published port is by definition
// reachable — it is how anyone uses the install.
//
// Everything published here is already published: the field set is the DNS-SD
// TXT allow-list the Go advertiser carries, and the estate name's own contract
// states it is "published in an mDNS TXT record". Nothing else is added — no
// hostname, no organization id, no device id, no capability list.
//
// Pure and Node-crypto only. The route composes it with the stored identity.

import { createHash, createHmac } from "node:crypto";

import {
  FEDERATION_CAPABILITY_VERSION,
  FEDERATION_PAIR_PATH,
  FEDERATION_PROTOCOL_VERSION,
  type FederationAdvertisement,
} from "@dpf/validators";

import { normalizeEstateName } from "@/lib/install/estate-identity-contract";
import { envFlagDisabled } from "@/lib/runtime/env-flags";

/**
 * How long one discovery id stands before it rotates.
 *
 * Fifteen minutes, matching the Go advertiser. Short enough that an observer
 * cannot follow one install across a day; long enough that a scanner polling on
 * a 90-second cadence sees a stable id, and that the candidate cache's
 * two-minute TTL never straddles more than one rotation.
 */
export const FEDERATION_ROTATION_WINDOW_MS = 15 * 60_000;

/** HMAC context, so this derivation can never collide with another use of the secret. */
const DISCOVERY_ID_PURPOSE = "federation-discovery";

/**
 * Derive the window-scoped public identifier for this install.
 *
 * Unlinkable by construction: it is an HMAC under an installation-local secret
 * that never leaves the install, so two windows produce ids no observer can tie
 * together, and no observer can produce an id for an install it does not run.
 *
 * Twelve bytes of base64url is sixteen characters, the shortest form the
 * discovery-id grammar accepts.
 */
export function rotatingDiscoveryId(
  secret: string,
  now: Date,
  windowMs: number = FEDERATION_ROTATION_WINDOW_MS,
): string {
  const window = windowMs > 0 ? windowMs : FEDERATION_ROTATION_WINDOW_MS;
  const bucket = Math.floor(now.getTime() / window);
  return createHmac("sha256", secret)
    .update(`${DISCOVERY_ID_PURPOSE}\u0000${bucket}`)
    .digest()
    .subarray(0, 12)
    .toString("base64url");
}

/**
 * Digest of the capability generation this install offers a peer.
 *
 * Four bytes of the SHA-256 of the capability version — the same eight hex
 * characters the Go advertiser puts in its TXT record for the same version
 * string, so the two advertisers describe one capability generation identically.
 */
export function federationCapabilityDigest(
  capabilityVersion: string = FEDERATION_CAPABILITY_VERSION,
): string {
  return createHash("sha256").update(capabilityVersion).digest("hex").slice(0, 8);
}

/**
 * Build the descriptor this install publishes.
 *
 * An install with no estate name advertises no organization. That is the honest
 * answer, and the receiving decision already treats it correctly: an absent ref
 * cannot prove same-organization membership, so the pairing routes to a human
 * rather than auto-enrolling.
 */
export function buildFederationAdvertisement(input: {
  /** Installation-local secret; never published, only used as the HMAC key. */
  projectionSecret: string;
  /** The estate name in force, or null when this install has never been named. */
  estateName: string | null;
  now: Date;
  rotationWindowMs?: number;
  capabilityVersion?: string;
}): FederationAdvertisement {
  const organization = normalizeEstateName(input.estateName);
  return {
    protocol: FEDERATION_PROTOCOL_VERSION,
    install: rotatingDiscoveryId(input.projectionSecret, input.now, input.rotationWindowMs),
    caps: federationCapabilityDigest(input.capabilityVersion),
    pair: FEDERATION_PAIR_PATH,
    ...(organization ? { organization } : {}),
  };
}

/**
 * Whether this install answers discovery probes at all.
 *
 * Advertising is on by default: an install that cannot be found cannot be paired
 * with, and the unattended lifecycle this exists for has nobody to switch it on.
 * An operator who needs an install to stay unfindable sets the variable to any
 * of the shared off tokens; anything else, unset included, advertises.
 */
export function federationAdvertisingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !envFlagDisabled(env, "DPF_FEDERATION_ADVERTISE");
}
