// Federation discovery — the one contract both halves of nearby-peer discovery
// speak.
//
// A DPF install advertises itself at `/.well-known/dpf-federation.json`; an Edge
// Node probes its segment for that descriptor and submits what it found to
// `POST /api/v1/edge/federation-candidates`. Producer and acceptor therefore have
// to agree on the same field set, the same grammar, and the same endpoint scope.
// Defining that once here is what makes the agreement real rather than a comment
// in two files.
//
// The field set is the SAME closed allow-list the DNS-SD advertisement already
// carries (services/edge-node-go/internal/federation/discovery.go
// `AdvertisementTXT`): protocol, install, caps, pair — plus the organization the
// peer belongs to, which the estate-identity contract already sanctions
// publishing in a discovery record. No hostname, no device id, no token, no
// organization id. Discovery is secret-free; pairing separately requires TLS and
// a chain that validates against the pinned organization root.
//
// Design: docs/superpowers/specs/2026-08-23-zero-touch-organization-federation-design.md §5.11

import { z } from "zod";

/** Discovery protocol generation. A peer speaking anything else is not parsed. */
export const FEDERATION_PROTOCOL_VERSION = "1";

/** Where a peer accepts a pairing request. Fixed; advertised for explicitness. */
export const FEDERATION_PAIR_PATH = "/connect/pair";

/**
 * The capability set a DPF install offers a federated peer. Digested rather than
 * listed so the advertisement stays a fixed size. Kept byte-identical to the Go
 * advertiser's `CapabilityVersion` so a Go-advertised and a portal-advertised
 * peer produce the same digest for the same capability generation.
 */
export const FEDERATION_CAPABILITY_VERSION = "dpf.demand/1";

/** Path the descriptor is served from, on the install's ordinary HTTP surface. */
export const FEDERATION_ADVERTISEMENT_PATH = "/.well-known/dpf-federation.json";

/** Rotating public identifier: 16-64 URL-safe characters. */
export const FEDERATION_DISCOVERY_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Capability digest: 8-64 lowercase hex characters. */
export const FEDERATION_CAPABILITY_DIGEST_RE = /^[a-f0-9]{8,64}$/;

/** Longest endpoint a candidate may carry. */
export const FEDERATION_ENDPOINT_MAX_LENGTH = 512;

/** Most candidates one snapshot may report. */
export const FEDERATION_CANDIDATE_SNAPSHOT_MAX = 50;

const IPV4_OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_CHARS = /^[0-9A-Fa-f:.]+$/;
const IPV6_GROUP = /^[0-9A-Fa-f]{1,4}$/;

/** True for a dotted-quad IPv4 literal. Leading zeros are rejected, as `net.isIP` does. */
export function isIpv4Literal(host: string): boolean {
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => IPV4_OCTET.test(part));
}

/**
 * True for an IPv6 literal, including the `::ffff:1.2.3.4` embedded-v4 form.
 *
 * Written without `node:net` on purpose: `@dpf/validators` is re-exported through
 * one barrel and reaches at least one `"use client"` component, so a `node:`
 * import anywhere in the package lands in a browser bundle. The unit test proves
 * this agrees with `net.isIP` over a corpus, which is where that dependency
 * belongs.
 */
export function isIpv6Literal(host: string): boolean {
  if (host.length === 0 || !IPV6_CHARS.test(host) || host.includes(":::")) return false;
  const halves = host.split("::");
  if (halves.length > 2) return false;
  const compressed = halves.length === 2;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = compressed && halves[1] ? halves[1].split(":") : [];
  const groups = [...head, ...tail];

  // An embedded IPv4 tail occupies the last two 16-bit groups.
  let capacity = 8;
  const last = groups[groups.length - 1];
  if (last !== undefined && last.includes(".")) {
    if (!isIpv4Literal(last)) return false;
    groups.pop();
    capacity -= 2;
  }
  if (groups.some((group) => !IPV6_GROUP.test(group))) return false;
  // `::` stands for at least one omitted group, so a compressed address is short.
  return compressed ? groups.length < capacity : groups.length === capacity;
}

/** 4, 6, or 0 for a host that is not an IP literal. */
export function ipLiteralVersion(host: string): 0 | 4 | 6 {
  if (isIpv4Literal(host)) return 4;
  if (isIpv6Literal(host)) return 6;
  return 0;
}

/**
 * True when an endpoint is inside the scope federation discovery may report.
 *
 * Discovery describes a peer on the local segment. A routable address is
 * therefore out of scope no matter how well-formed the rest of the record is:
 * accepting one would let an Edge Node nominate an arbitrary internet host as a
 * pairing candidate. Credentials, a path, a query or a fragment are refused for
 * the same reason — an endpoint is an origin, and anything more is a redirect
 * waiting to happen.
 */
export function isFederationScopedEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return false;
  }
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (host.endsWith(".local")) return true;
  const version = ipLiteralVersion(host);
  if (version === 4) {
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const match172 = /^172\.(\d{1,3})\./.exec(host);
    if (match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31) return true;
    return /^169\.254\./.test(host);
  }
  if (version !== 6) return false;
  const firstHextet = Number.parseInt(host.split(":", 1)[0] ?? "", 16);
  return (
    host === "::1" ||
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
    (firstHextet >= 0xfc00 && firstHextet <= 0xfdff)
  );
}

/**
 * The descriptor an install publishes about itself.
 *
 * `.strict()` on purpose. The TXT-record parser this mirrors refuses an
 * unexpected key outright, and the same reasoning holds here: the field set IS
 * the privacy boundary, so a peer that wants to say more has to say it under a
 * new `protocol`, where a scanner can decide whether to listen.
 */
export const federationAdvertisementSchema = z
  .object({
    protocol: z.literal(FEDERATION_PROTOCOL_VERSION),
    /** Rotating, window-scoped public id. Unlinkable across rotation windows. */
    install: z.string().regex(FEDERATION_DISCOVERY_ID_RE),
    caps: z.string().regex(FEDERATION_CAPABILITY_DIGEST_RE),
    pair: z.literal(FEDERATION_PAIR_PATH),
    /**
     * The estate this install belongs to, when it has been named. Absent is a
     * real state, not a degraded one: an unnamed install cannot prove which
     * trust root it belongs to, and the enrolment decision routes it to a human.
     */
    organization: z.string().min(1).max(48).optional(),
  })
  .strict();

export type FederationAdvertisement = z.infer<typeof federationAdvertisementSchema>;

/** One nearby peer, as an Edge Node reports it to the Authority. */
export const federationCandidateSchema = z
  .object({
    discoveryId: z.string().regex(FEDERATION_DISCOVERY_ID_RE),
    endpoint: z
      .string()
      .url()
      .max(FEDERATION_ENDPOINT_MAX_LENGTH)
      .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      }, "endpoint must use HTTP or HTTPS"),
    protocol: z.literal(FEDERATION_PROTOCOL_VERSION),
    capabilityDigest: z.string().regex(FEDERATION_CAPABILITY_DIGEST_RE),
    pairPath: z.literal(FEDERATION_PAIR_PATH),
    /**
     * The estate the peer advertises. Optional so an Edge Node that predates the
     * field keeps submitting successfully; the decision layer treats an absent
     * ref as "cannot prove same organization" and routes that pairing to a
     * human. Never trusted on its own, because the same decision also requires a
     * certificate chain validating against the pinned organization root.
     */
    organizationRef: z.string().min(1).max(48).optional(),
  })
  .strict()
  .refine((value) => isFederationScopedEndpoint(value.endpoint), {
    message: "endpoint must be link-local or private-network scoped",
    path: ["endpoint"],
  });

export type FederationCandidate = z.infer<typeof federationCandidateSchema>;

/** A whole observation: what the Edge Node saw, and when it saw it. */
export const federationCandidateSnapshotSchema = z
  .object({
    observedAt: z.string().datetime(),
    candidates: z.array(federationCandidateSchema).max(FEDERATION_CANDIDATE_SNAPSHOT_MAX),
  })
  .strict();

export type FederationCandidateSnapshot = z.infer<typeof federationCandidateSnapshotSchema>;

/**
 * Turn a peer's descriptor into a candidate for the endpoint it was served from.
 *
 * The endpoint is the origin the SCANNER dialled, never a value the peer chose:
 * a descriptor able to nominate its own address would let one host enrol a
 * candidate for another.
 */
export function candidateFromAdvertisement(
  advertisement: FederationAdvertisement,
  endpoint: string,
): FederationCandidate | null {
  const parsed = federationCandidateSchema.safeParse({
    discoveryId: advertisement.install,
    endpoint,
    protocol: advertisement.protocol,
    capabilityDigest: advertisement.caps,
    pairPath: advertisement.pair,
    ...(advertisement.organization ? { organizationRef: advertisement.organization } : {}),
  });
  return parsed.success ? parsed.data : null;
}
