// EP-MSP-FEDERATION · R4 — outbound incident push (building block).
//
// When THIS deployment is the managed-by (customer) side of a trusted link, push
// our correlated incidents to the managing peer (MSP). DB + fetch injected so the
// routing is unit-tested. Wiring this into the correlation job is gated on a
// trusted link, which in turn needs the dual-approval relay (a separate slice).

import { createHash } from "crypto";

import { sendIncidentToPeer } from "./client";
import { decryptPeerToken } from "./outbound";

export interface OutboundPushDb {
  federationLink: {
    findFirst(args: unknown): Promise<{
      linkId: string;
      peerAuthorityUrl: string;
      peerTokenEnc: string | null;
    } | null>;
  };
}

export interface PushableIncident {
  incidentKey: string;
  summary: string;
  highestSeverity: string;
  alertCount: number;
}

/** Stable hash of the minimized incident payload — the peer uses it for idempotency. */
export function incidentPayloadHash(i: PushableIncident): string {
  return createHash("sha1")
    .update(`${i.incidentKey}|${i.summary}|${i.highestSeverity}|${i.alertCount}`)
    .digest("hex");
}

export async function pushIncidentsToManagingPeer(
  db: OutboundPushDb,
  incidents: PushableIncident[],
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ pushed: number; skipped: number; reason?: string }> {
  if (incidents.length === 0) return { pushed: 0, skipped: 0 };

  // A trusted (dual-approved) link where WE are managed by a peer.
  const link = await db.federationLink.findFirst({
    where: { role: "managed-by", linkState: "trusted" },
  });
  if (!link) return { pushed: 0, skipped: incidents.length, reason: "no-trusted-managing-link" };

  const token = decryptPeerToken(link.peerTokenEnc);
  if (!token) return { pushed: 0, skipped: incidents.length, reason: "no-peer-token" };

  let pushed = 0;
  for (const incident of incidents) {
    const res = await sendIncidentToPeer(
      {
        peerAuthorityUrl: link.peerAuthorityUrl,
        linkToken: token,
        linkId: link.linkId,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      },
      { ...incident, payloadHash: incidentPayloadHash(incident) },
    );
    if (res.ok) pushed++;
  }
  return { pushed, skipped: incidents.length - pushed };
}
