// EP-MSP-FEDERATION · B1/B3/B4 — federation outbound client.
//
// Pushes a CloudEvents-wrapped payload to a peer DPF's /api/v1/federation/*
// receiving routes, authenticating with the peer-issued link token. Outbound-
// only HTTPS; the peer token is supplied by the caller (its encrypted-at-rest
// storage is a separate slice). Injected `fetchImpl` keeps it unit-testable.

import { toCloudEvent } from "@dpf/db/projection-serialization";
import type { DemandActivity } from "@dpf/db/federated-demand-contract";

import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { assertSafeOutboundUrl } from "@/lib/security/safe-fetch";

// peerAuthorityUrl is operator-supplied → an SSRF sink (CWE-918). Validate it at
// this single chokepoint that every outbound federation call funnels through
// (incident / proposal / enroll / approval-relay). Safe-by-default: https +
// public hosts only. Local/LAN federation — two on-prem DPF instances or dev —
// opts in explicitly via DPF_FEDERATION_ALLOW_INSECURE_PEERS (permits http +
// private/loopback networks). The peer route `path` is our own constant, not
// user input, so it is appended to the validated origin.
function safePeerRequestUrl(peerAuthorityUrl: string, path: string): string {
  const allowInsecure = envFlagEnabled(process.env, "DPF_FEDERATION_ALLOW_INSECURE_PEERS");
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
}): Promise<PeerPostResult> {
  const f = input.fetchImpl ?? fetch;
  let url: string;
  try {
    url = safePeerRequestUrl(input.peerAuthorityUrl, input.path);
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
  return postToPeer({
    peerAuthorityUrl: target.peerAuthorityUrl,
    linkToken: target.linkToken,
    path: "/api/v1/federation/demand",
    cloudEvent: toCloudEvent({
      id: options.eventId ?? `${target.linkId}:${activity}:${Date.now()}`,
      source: "/dpf",
      type: activity,
      time: (options.now ?? new Date()).toISOString(),
      linkId: target.linkId,
      data: demandEnvelope,
    }),
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
    ...(target.fetchImpl ? { fetchImpl: target.fetchImpl } : {}),
  });
}
