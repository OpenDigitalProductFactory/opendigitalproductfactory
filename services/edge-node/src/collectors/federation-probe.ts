// Federation peer probe — ask one origin whether it is a DPF install.
//
// The whole zero-touch pairing chain (design §5.4-§5.10) waits on a nearby
// candidate, and nothing produced one: general host discovery and federation
// peer discovery are separate paths, and only the first was implemented. This is
// the smallest honest producer — a GET of the peer's discovery advertisement.
//
// What comes back is an UNTRUSTED setup suggestion. It never establishes trust:
// the Authority's decision layer independently requires a TLS chain that
// validates against the pinned organization root before a peer can enrol without
// a human (design §5.4, §5.6, §5.7). This module's only job is to turn a
// well-formed advertisement into a well-formed candidate, and to say nothing at
// all about anything else on the network.
//
// Design: docs/superpowers/specs/2026-08-23-zero-touch-organization-federation-design.md §5.11

import { Agent, fetch as undiciFetch } from "undici";

import {
  FEDERATION_ADVERTISEMENT_PATH,
  candidateFromAdvertisement,
  federationAdvertisementSchema,
  type FederationAdvertisement,
  type FederationCandidate,
} from "@dpf/validators";

/** Per-probe timeout. A peer that cannot answer promptly is not on this segment. */
export const PROBE_TIMEOUT_MS = 1_500;

/**
 * Longest advertisement body read. The descriptor is under 200 bytes; the cap
 * exists so a host that answers this path with a large unrelated document costs
 * one buffer rather than the scan.
 */
export const PROBE_MAX_BODY_BYTES = 4 * 1024;

/** Adapter for tests — replaces the HTTP call only. */
export type FederationProbeAdapter = {
  fetchAdvertisement: (
    url: string,
  ) => Promise<{ status: number; body: string } | null>;
};

/**
 * Parse an advertisement body against the shared contract.
 *
 * Strict by construction: an unexpected field, another protocol generation, or a
 * malformed id is not a peer this scanner reports. The Authority would refuse it
 * anyway, and a refused batch loses the good candidates in it too.
 */
export function parseAdvertisementBody(body: string): FederationAdvertisement | null {
  if (body.length === 0 || body.length > PROBE_MAX_BODY_BYTES) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = federationAdvertisementSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

/** Fetch and parse one origin's advertisement. Null for every non-answer. */
async function fetchAdvertisement(
  origin: string,
  adapter: FederationProbeAdapter,
): Promise<FederationAdvertisement | null> {
  let response: { status: number; body: string } | null;
  try {
    response = await adapter.fetchAdvertisement(`${origin}${FEDERATION_ADVERTISEMENT_PATH}`);
  } catch {
    return null;
  }
  if (!response || response.status !== 200) return null;
  return parseAdvertisementBody(response.body);
}

/**
 * Probe one origin.
 *
 * Returns the candidate when the origin serves a DPF advertisement, and null for
 * every other outcome — refused connection, timeout, 404, a web server that is
 * not DPF, or a descriptor this generation does not understand. A scan crosses
 * hundreds of hosts that are none of DPF's business; saying nothing about them
 * is the point.
 */
export async function probeFederationPeer(
  origin: string,
  adapter: FederationProbeAdapter,
): Promise<FederationCandidate | null> {
  const advertisement = await fetchAdvertisement(origin, adapter);
  return advertisement ? candidateFromAdvertisement(advertisement, origin) : null;
}

/**
 * Read just the install id an origin advertises.
 *
 * Separate from `probeFederationPeer` because the scanner asks this of the
 * Authority it is ENROLLED against, to recognise its own install among the peers
 * it finds — and that URL is routinely something no candidate could ever be, such
 * as the compose service name `http://portal:3000`. Going through the candidate
 * contract there returned null, which silently disabled self-exclusion in exactly
 * the deployment the Edge Node ships in.
 */
export async function probeAdvertisedInstallId(
  origin: string,
  adapter: FederationProbeAdapter,
): Promise<string | null> {
  return (await fetchAdvertisement(origin, adapter))?.install ?? null;
}

/**
 * The real HTTP adapter.
 *
 * Certificate validation is off for the PROBE, and only for the probe. This is
 * not the case CodeQL flagged in `observePeerCertificateChain`: that one turned a
 * fingerprint comparison into a claim of verification. Here nothing is claimed.
 * A peer's certificate is issued by a private organization CA that a freshly
 * installed Edge Node has no copy of, so validating here would find nothing but
 * the peers already trusted — and an HTTPS candidate is recorded as
 * `tls-validation-required`, which the Authority then resolves by opening its own
 * connection with the pinned organization root as the only acceptable issuer.
 * The verification path is unchanged, still runs, and is still the only thing
 * that can produce `certificateVerified`.
 */
export function buildFederationProbeAdapter(
  timeoutMs: number = PROBE_TIMEOUT_MS,
): FederationProbeAdapter {
  const dispatcher = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connections: 1,
    // Discovery only. See the note above: trust is decided elsewhere, against a
    // pinned root, over a connection this module does not open.
    connect: { rejectUnauthorized: false, timeout: timeoutMs },
  });
  return {
    fetchAdvertisement: async (url: string) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await undiciFetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          dispatcher,
          signal: controller.signal,
          redirect: "error",
        });
        // Read at most the cap: a peer that streams forever costs one buffer.
        const body = (await response.text()).slice(0, PROBE_MAX_BODY_BYTES + 1);
        return { status: response.status, body };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
