// EP-MSP-FEDERATION · A4 + B4 — auto-diagnose-and-propose (the AI-MSP loop).
//
// When the MSP receives a federated incident (B3), diagnose it (deterministic
// suggestions, A4) and send a remediation PROPOSAL back to the sovereign customer
// over the same link (B4 outbound). The customer re-evaluates it through their own
// consent gate and decides — the MSP only proposes. Best-effort + DB/fetch injected.

import { diagnoseAndPropose } from "@/lib/service-desk/remediation-suggestions";

import { sendProposalToPeer } from "./client";
import { decryptPeerToken } from "./outbound";

export interface AutoProposeDb {
  federationLink: {
    findUnique(args: unknown): Promise<{
      linkId: string;
      peerAuthorityUrl: string;
      peerTokenEnc: string | null;
      role: string;
    } | null>;
  };
}

export interface ReceivedIncident {
  incidentKey: string;
  edgeNodeId?: string | null;
  summary: string;
  highestSeverity: string;
  eventClass?: string | null;
}

export async function autoDiagnoseAndSendProposal(
  db: AutoProposeDb,
  linkId: string,
  incident: ReceivedIncident,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ sent: boolean; reason?: string }> {
  const link = await db.federationLink.findUnique({
    where: { linkId },
    select: { linkId: true, peerAuthorityUrl: true, peerTokenEnc: true, role: true },
  });
  // Only the managing (MSP) side proposes to the managed customer.
  if (!link || link.role !== "manages") return { sent: false, reason: "not-managing-side" };
  const token = decryptPeerToken(link.peerTokenEnc);
  if (!token) return { sent: false, reason: "no-peer-token" };

  const proposal = diagnoseAndPropose(
    {
      incidentKey: incident.incidentKey,
      edgeNodeId: incident.edgeNodeId ?? "unknown",
      summary: incident.summary,
      highestSeverity: incident.highestSeverity,
      ...(incident.eventClass ? { eventClass: incident.eventClass } : {}),
    },
    undefined,
    linkId,
  );

  const res = await sendProposalToPeer(
    {
      peerAuthorityUrl: link.peerAuthorityUrl,
      linkToken: token,
      linkId,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    },
    proposal,
  );
  return res.ok ? { sent: true } : { sent: false, reason: `peer responded ${res.status}` };
}
