// EP-MSP-FEDERATION · B1/B3/B4 — federation outbound client.
//
// Pushes a CloudEvents-wrapped payload to a peer DPF's /api/v1/federation/*
// receiving routes, authenticating with the peer-issued link token. Outbound-
// only HTTPS; the peer token is supplied by the caller (its encrypted-at-rest
// storage is a separate slice). Injected `fetchImpl` keeps it unit-testable.

import { toCloudEvent } from "@dpf/db/projection-serialization";

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
  const url = input.peerAuthorityUrl.replace(/\/+$/, "") + input.path;
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
