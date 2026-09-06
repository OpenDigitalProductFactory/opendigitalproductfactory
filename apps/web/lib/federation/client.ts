// EP-MSP-FEDERATION · B1/B3/B4 — federation outbound client.
//
// Pushes a CloudEvents-wrapped payload to a peer DPF's /api/v1/federation/*
// receiving routes, authenticating with the peer-issued link token. Outbound-
// only HTTPS; the peer token is supplied by the caller (its encrypted-at-rest
// storage is a separate slice). Injected `fetchImpl` keeps it unit-testable.

import { toCloudEvent } from "@dpf/db/projection-serialization";
import type { DemandActivity } from "@dpf/db/federated-demand-contract";
import type { OperationalPostureActivity } from "@dpf/db/federated-operational-posture-contract";

import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { assertSafeOutboundUrl } from "@/lib/security/safe-fetch";

// True only for an IP-LITERAL private/loopback/link-local host, or localhost /
// *.local. Arbitrary DNS hostnames return false on purpose: we must not relax the
// SSRF guard for a name an attacker could rebind to an internal address. Used to
// scope the same-org LAN allowance below to addresses that are unambiguously LAN.
export function isPrivateOrLoopbackFederationHost(peerAuthorityUrl: string): boolean {
  let host: string;
  try {
    host = new URL(peerAuthorityUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".local")) return true;
  const v6 = host.replace(/^\[|\]$/g, "");
  if (v6 === "::1") return true;
  if (host.startsWith("127.")) return true;
  if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
  const m = /^172\.(\d{1,3})\./.exec(host);
  if (m) {
    const octet = Number(m[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  return false;
}

// peerAuthorityUrl is operator-supplied → an SSRF sink (CWE-918). Validate it at
// this single chokepoint that every outbound federation call funnels through
// (incident / proposal / enroll / approval-relay). Safe-by-default: https +
// public hosts only.
//
// Two opt-ins permit http + private/loopback networks for on-prem LAN federation:
//   1. DPF_FEDERATION_ALLOW_INSECURE_PEERS=1 — global operator flag (unchanged).
//   2. `sameOrgLan` — a SCOPED, per-call allowance for same-organization LAN
//      pairing that needs no typed flag. It permits http/private ONLY when the
//      peer address is itself an IP-literal private/loopback host
//      (isPrivateOrLoopbackFederationHost). This is strictly NARROWER than the
//      global flag: public and DNS-named peers still require HTTPS even when
//      sameOrgLan is set, so a same-org channel/reseller on a public host is
//      unaffected. Callers set sameOrgLan from an operator-declared same-org
//      link (role "same-org-peer") or an operator-initiated same-org connect.
//
// The peer route `path` is our own constant, not user input, so it is appended
// to the validated origin.
function safePeerRequestUrl(
  peerAuthorityUrl: string,
  path: string,
  sameOrgLan = false,
): string {
  const globalFlag = envFlagEnabled(process.env, "DPF_FEDERATION_ALLOW_INSECURE_PEERS");
  const scopedLan = sameOrgLan && isPrivateOrLoopbackFederationHost(peerAuthorityUrl);
  const allowInsecure = globalFlag || scopedLan;
  const validated = assertSafeOutboundUrl(peerAuthorityUrl, {
    allowedSchemes: allowInsecure ? ["https:", "http:"] : ["https:"],
    blockPrivateNetworks: !allowInsecure,
  });
  return validated.href.replace(/\/+$/, "") + path;
}

export interface PeerPostResult {
  ok: boolean;
  status: number;
  body?: unknown;
  error?: string;
}

export async function postToPeer(input: {
  peerAuthorityUrl: string;
  linkToken: string;
  path: string;
  cloudEvent: unknown;
  fetchImpl?: typeof fetch;
  /** Scoped same-org LAN allowance — see safePeerRequestUrl. Default false. */
  sameOrgLan?: boolean;
}): Promise<PeerPostResult> {
  const f = input.fetchImpl ?? fetch;
  let url: string;
  try {
    url = safePeerRequestUrl(input.peerAuthorityUrl, input.path, input.sameOrgLan ?? false);
  } catch (err) {
    // A peer URL that fails the SSRF guard is never dialed.
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "unsafe peer url" };
  }
  try {
    const res = await f(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.linkToken}`,
      },
      body: JSON.stringify(input.cloudEvent),
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "network error" };
  }
}

export interface PeerLinkTarget {
  peerAuthorityUrl: string;
  /** Plaintext peer-issued link token (we authenticate to them with it). */
  linkToken: string;
  linkId: string;
  fetchImpl?: typeof fetch;
  /** Set when this link is a same-organization peer, so a private-LAN address is
   *  reachable over http without the global insecure-peers flag. See
   *  safePeerRequestUrl. Default false. */
  sameOrgLan?: boolean;
}

function envelope(linkId: string, type: string, data: unknown) {
  return toCloudEvent({
    id: `${linkId}:${type}:${Date.now()}`,
    source: "/dpf",
    type,
    time: new Date().toISOString(),
    linkId,
    data,
  });
}

/** Push a (minimized, source-correlated) incident to the managing peer (B3). */
export async function sendIncidentToPeer(target: PeerLinkTarget, incident: unknown): Promise<PeerPostResult> {
  return postToPeer({
    peerAuthorityUrl: target.peerAuthorityUrl,
    linkToken: target.linkToken,
    path: "/api/v1/federation/incident",
    cloudEvent: envelope(target.linkId, "dpf.federation.incident", incident),
    sameOrgLan: target.sameOrgLan ?? false,
    ...(target.fetchImpl ? { fetchImpl: target.fetchImpl } : {}),
  });
}

/** Push a remediation proposal to the sovereign customer (B4). */
export async function sendProposalToPeer(target: PeerLinkTarget, proposal: unknown): Promise<PeerPostResult> {
  return postToPeer({
    peerAuthorityUrl: target.peerAuthorityUrl,
    linkToken: target.linkToken,
    path: "/api/v1/federation/proposal",
    cloudEvent: envelope(target.linkId, "dpf.federation.proposal", proposal),
    sameOrgLan: target.sameOrgLan ?? false,
    ...(target.fetchImpl ? { fetchImpl: target.fetchImpl } : {}),
  });
}

/** Deliver one versioned, already-minimized demand envelope to a trusted peer. */
export async function sendDemandToPeer(
  target: PeerLinkTarget,
  activity: DemandActivity,
  demandEnvelope: unknown,
  options: { eventId?: string; now?: Date } = {},
): Promise<PeerPostResult> {
  const cloudEvent = toCloudEvent({
    id: options.eventId ?? `${target.linkId}:${activity}:${Date.now()}`,
    source: "/dpf",
    type: activity,
    time: (options.now ?? new Date()).toISOString(),
    linkId: target.linkId,
    data: demandEnvelope,
  });
  const inbox = await postToPeer({
    peerAuthorityUrl: target.peerAuthorityUrl,
    linkToken: target.linkToken,
    path: "/api/v1/federation/inbox",
    cloudEvent,
    sameOrgLan: target.sameOrgLan ?? false,
    ...(target.fetchImpl ? { fetchImpl: target.fetchImpl } : {}),
  });
  // Rolling-upgrade compatibility only: older peers predate the inbox alias.
  if (inbox.status !== 404) return inbox;
  return postToPeer({
    peerAuthorityUrl: target.peerAuthorityUrl,
    linkToken: target.linkToken,
    path: "/api/v1/federation/demand",
    cloudEvent,
    sameOrgLan: target.sameOrgLan ?? false,
    ...(target.fetchImpl ? { fetchImpl: target.fetchImpl } : {}),
  });
}

/** Deliver one minimized, read-only operational-posture record to a trusted
 *  same-organization peer's inbox (BI-648F01A0 Slice 2). No legacy route alias:
 *  a peer that predates the posture type answers 422 and the outbox retries
 *  until it upgrades. */
export async function sendOperationalPostureToPeer(
  target: PeerLinkTarget,
  activity: OperationalPostureActivity,
  record: unknown,
  options: { eventId?: string; now?: Date } = {},
): Promise<PeerPostResult> {
  return postToPeer({
    peerAuthorityUrl: target.peerAuthorityUrl,
    linkToken: target.linkToken,
    path: "/api/v1/federation/inbox",
    cloudEvent: toCloudEvent({
      id: options.eventId ?? `${target.linkId}:${activity}:${Date.now()}`,
      source: "/dpf",
      type: activity,
      time: (options.now ?? new Date()).toISOString(),
      linkId: target.linkId,
      data: record,
    }),
    sameOrgLan: target.sameOrgLan ?? false,
    ...(target.fetchImpl ? { fetchImpl: target.fetchImpl } : {}),
  });
}

/** Compare bounded demand inventories so a lost send or acknowledgment self-heals. */
export async function sendDemandDigestToPeer(
  target: PeerLinkTarget,
  digest: unknown,
  options: { eventId?: string; now?: Date } = {},
): Promise<PeerPostResult> {
  return postToPeer({
    peerAuthorityUrl: target.peerAuthorityUrl,
    linkToken: target.linkToken,
    path: "/api/v1/federation/demand/reconcile",
    cloudEvent: toCloudEvent({
      id: options.eventId ?? `${target.linkId}:dpf.demand.reconcile:${Date.now()}`,
      source: "/dpf",
      type: "dpf.demand.reconcile",
      time: (options.now ?? new Date()).toISOString(),
      linkId: target.linkId,
      data: digest,
    }),
    sameOrgLan: target.sameOrgLan ?? false,
    ...(target.fetchImpl ? { fetchImpl: target.fetchImpl } : {}),
  });
}

/** Authenticated GET against a peer's federation surface (same SSRF/LAN rules
 *  as postToPeer). Work sync PULLS: the receiving side asks for the page it is
 *  missing instead of waiting on the sender's outbox. */
export async function getFromPeer(input: {
  peerAuthorityUrl: string;
  linkToken: string;
  path: string;
  fetchImpl?: typeof fetch;
  sameOrgLan?: boolean;
}): Promise<PeerPostResult> {
  const f = input.fetchImpl ?? fetch;
  let url: string;
  try {
    url = safePeerRequestUrl(input.peerAuthorityUrl, input.path, input.sameOrgLan ?? false);
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "unsafe peer url" };
  }
  try {
    const res = await f(url, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${input.linkToken}` },
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "network error" };
  }
}

/** Pull one page of a same-organization peer's share-safe backlog (BI-FF8A57EF). */
export async function fetchWorkPageFromPeer(
  target: PeerLinkTarget,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<PeerPostResult> {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.toString();
  return getFromPeer({
    peerAuthorityUrl: target.peerAuthorityUrl,
    linkToken: target.linkToken,
    path: `/api/v1/federation/work${query ? `?${query}` : ""}`,
    sameOrgLan: target.sameOrgLan ?? false,
    ...(target.fetchImpl ? { fetchImpl: target.fetchImpl } : {}),
  });
}
