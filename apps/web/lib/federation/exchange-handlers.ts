// EP-MSP-FEDERATION · B3 + B4 — federation exchange handlers (receiving side).
//
// What a peer DPF sends us, turned into local records:
//   - handleIncomingIncident (B3): a peer's correlated incident becomes a
//     FederatedRecordMirror + a local ServiceTicket. The peer is canonical;
//     reconcileMirror does idempotency + conflict detection.
//   - handleIncomingProposal (B4): an MSP's remediation proposal lands on us
//     (the customer) as a FederatedRemediationProposal, routed by the consent
//     gate. Conservative default (§15.4): nothing auto-executes until the
//     customer opts in; above-band lands for human approval.
//
// DB-injected so the logic is unit-tested with a mock. The route layer supplies
// the real prisma client. Control-runner execution is intentionally a boundary
// stub (EP-CTRL-5E21A4 is the executing substrate, separate).

import { createHash } from "crypto";

import { reconcileMirror, type MirrorSyncStatus } from "@dpf/db/federated-record-sync";
import { priorityFromSeverity } from "@dpf/db/service-ticket-types";

import {
  buildFederatedProposalRecord,
  routeRemediationProposal,
  type ProposalLanding,
} from "@/lib/federation/remediation-consent";
import type { RemediationProposalDraft } from "@/lib/service-desk/remediation-authority";

// ── B3: incoming incident → mirror + ticket ──────────────────────────────────

export interface IncomingIncident {
  /** The peer's incident key (canonical id on the peer side). */
  incidentKey: string;
  summary: string;
  highestSeverity: string;
  alertCount: number;
  /** Hash of the projected (minimized) incident payload — drives idempotency. */
  payloadHash: string;
  /** The peer's version this update is based on (optimistic concurrency). */
  baseVersion?: number;
}

export interface IncidentExchangeDb {
  federatedRecordMirror: {
    findFirst(args: unknown): Promise<{ version: bigint; syncStatus: string; payloadHash?: string | null } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  serviceTicket: { upsert(args: unknown): Promise<unknown> };
}

/** Deterministic, link-scoped ticket id for a federated incident. */
export function federatedTicketId(linkId: string, incidentKey: string): string {
  return "ST-FED-" + createHash("sha1").update(`${linkId}:${incidentKey}`).digest("hex").slice(0, 8).toUpperCase();
}

export type IncidentExchangeResult =
  | { action: "created" | "updated"; ticketId: string }
  | { action: "noop"; ticketId: string }
  | { action: "conflict"; ticketId: string; reason: string };

export async function handleIncomingIncident(
  db: IncidentExchangeDb,
  linkId: string,
  incident: IncomingIncident,
): Promise<IncidentExchangeResult> {
  const ticketId = federatedTicketId(linkId, incident.incidentKey);
  const existing = await db.federatedRecordMirror.findFirst({
    where: { federationLinkId: linkId, recordType: "incident", localRecordRef: ticketId },
  });

  const decision = reconcileMirror(
    existing
      ? {
          version: Number(existing.version),
          syncStatus: existing.syncStatus as MirrorSyncStatus,
          canonicalSide: "peer",
          payloadHash: existing.payloadHash ?? null,
        }
      : null,
    {
      fromSide: "peer",
      baseVersion: incident.baseVersion ?? (existing ? Number(existing.version) : 1),
      payloadHash: incident.payloadHash,
    },
  );

  if (decision.action === "conflict") return { action: "conflict", ticketId, reason: decision.reason };
  if (decision.action === "noop") return { action: "noop", ticketId };

  const nextVersion = decision.action === "update" ? decision.nextVersion : 1;
  const priority = priorityFromSeverity(incident.highestSeverity);

  await db.serviceTicket.upsert({
    where: { ticketId },
    create: {
      ticketId,
      ticketKind: "incident",
      status: "open",
      priority,
      severity: incident.highestSeverity,
      title: incident.summary,
      description: `Federated incident from peer (link ${linkId}). ${incident.alertCount} alerts.`,
      correlatedIncidentKey: incident.incidentKey,
    },
    update: { priority, severity: incident.highestSeverity, title: incident.summary },
  });

  await db.federatedRecordMirror.upsert({
    where: {
      federationLinkId_recordType_localRecordRef: {
        federationLinkId: linkId,
        recordType: "incident",
        localRecordRef: ticketId,
      },
    },
    create: {
      mirrorId: `mir_${ticketId}`,
      federationLinkId: linkId,
      recordType: "incident",
      canonicalSide: "peer",
      localRecordRef: ticketId,
      peerRecordRef: incident.incidentKey,
      syncStatus: "synced",
      version: nextVersion,
      payload: { payloadHash: incident.payloadHash },
      lastSyncedAt: new Date(),
    },
    update: {
      syncStatus: "synced",
      version: nextVersion,
      payload: { payloadHash: incident.payloadHash },
      lastSyncedAt: new Date(),
    },
  });

  return { action: decision.action === "create" ? "created" : "updated", ticketId };
}

// ── B4: incoming remediation proposal → consent gate ─────────────────────────

export interface ProposalExchangeDb {
  federatedRemediationProposal: { create(args: unknown): Promise<{ proposalId: string }> };
}

export interface ProposalExchangePolicy {
  /** The CUSTOMER's own policy: does it permit auto-execution for this band?
   *  Default false (§15.4) — nothing auto-executes until the customer opts in. */
  customerAllowsAuto?: boolean;
}

export interface ProposalExchangeResult {
  proposalId: string;
  landing: ProposalLanding;
  status: "proposed" | "rejected";
}

export async function handleIncomingProposal(
  db: ProposalExchangeDb,
  linkId: string,
  proposal: RemediationProposalDraft,
  policy: ProposalExchangePolicy = {},
): Promise<ProposalExchangeResult> {
  // The link auth already proved the link is trusted before we get here.
  const landing = routeRemediationProposal({
    proposal,
    linkTrusted: true,
    customerAllowsAuto: policy.customerAllowsAuto ?? false,
  });

  const record = buildFederatedProposalRecord(linkId, proposal, landing);
  const status: "proposed" | "rejected" = landing === "refused" ? "rejected" : "proposed";
  const proposalId = `frp_${createHash("sha1").update(`${linkId}:${proposal.incidentKey}`).digest("hex").slice(0, 12)}`;

  await db.federatedRemediationProposal.create({
    data: {
      proposalId,
      federationLinkId: linkId,
      incidentKey: record.incidentKey,
      edgeNodeId: record.edgeNodeId,
      actions: record.actions as unknown as object,
      overallDecision: record.overallDecision,
      status,
      // attentionItemRef stays null until the Attention Surface posting lands
      // (EP-ATTENTION-SURFACE); execution stays gated on the control runner
      // (EP-CTRL-5E21A4). The MSP never gains standing execute rights here.
    },
  });

  return { proposalId, landing, status };
}
