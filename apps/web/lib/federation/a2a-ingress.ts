// Receiver side of the federation A2A ingress (BI-B45BBD8A; A2A design §18.3,
// §19.4–19.5; dialog broker design §8).
//
// A peer's signed request is checked in a fixed order, and nothing is written
// until every check has passed:
//   flag → trusted same-organization link with an attested peer DID → shape →
//   CloudEvent type matches the operation → signature by the key that hashes to
//   the link's DID → addressed to this installation and this organization →
//   inbox (a duplicate returns the existing task; changed content is a conflict) →
//   notAfter and lifetime → the operation's handler.
//
// The handler and the inbox row run in one transaction, so a crash leaves either
// both or neither, and a concurrent duplicate loses on the inbox's unique key and
// rolls its work back. The `requestId` inbox row is a FederatedRecordMirror with
// canonicalSide "peer", keyed (link, "a2a-request", requestId); no new table.
//
// Application refusals are answered as a receipt with outcome "rejected", never
// as 401/403: those statuses quarantine the sender's link (demand-delivery.ts).

import {
  A2A_REQUEST_MAX_LIFETIME_MS,
  A2A_REQUEST_RECORD_TYPE,
  a2aActivityForOperation,
  a2aRequestDigest,
  validateA2aRequestV1,
  type A2aRequestOperation,
  type A2aRequestReceiptV1,
  type A2aRequestRejection,
  type A2aRequestV1,
} from "@dpf/db/federated-a2a-contract";

import { verifyA2aRequestSignature } from "./a2a-request-signing";

type Link = {
  linkId: string;
  role: string;
  linkState: string;
  revokedAt: Date | null;
  quarantinedAt: Date | null;
  peerDeviceId: string | null;
  peerOrganizationRef: string | null;
};

type InboxRow = { mirrorId: string; localRecordRef: string | null; payload: unknown };

export interface A2aIngressDb {
  federationLink: { findUnique(args: unknown): Promise<Link | null> };
  federatedRecordMirror: {
    findUnique(args: unknown): Promise<InboxRow | null>;
    create(args: unknown): Promise<unknown>;
  };
  $transaction<T>(work: (tx: A2aIngressDb) => Promise<T>): Promise<T>;
}

export type A2aOperationStart =
  | { ok: true; receiverTaskId: string; state: string }
  | { ok: false; reason: A2aRequestRejection };

export interface A2aOperationHandler {
  /** Create the receiver-owned work. Runs inside the inbox transaction, on `tx`. */
  start(request: A2aRequestV1, context: { linkId: string; tx: A2aIngressDb; now: Date }): Promise<A2aOperationStart>;
  /** The current state of a task this ingress created earlier, for a duplicate. */
  readState(receiverTaskId: string, context: { linkId: string }): Promise<string | null>;
}

export type A2aOperationHandlers = Partial<Record<A2aRequestOperation, A2aOperationHandler>>;

export interface A2aIngressContext {
  selfInstallationDid: string;
  now: Date;
  a2aEnabled: boolean;
}

function rejected(requestId: string, reason: A2aRequestRejection): A2aRequestReceiptV1 {
  return { specVersion: "dpf.a2a-receipt/1", requestId, outcome: "rejected", reason };
}

function inboxWhere(linkId: string, requestId: string) {
  return {
    federationLinkId_recordType_peerRecordRef: {
      federationLinkId: linkId,
      recordType: A2A_REQUEST_RECORD_TYPE,
      peerRecordRef: requestId,
    },
  };
}

function storedDigest(row: InboxRow): string | null {
  const payload = row.payload as { digest?: unknown } | null;
  return typeof payload?.digest === "string" ? payload.digest : null;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

export function linkEligibleForA2a(link: Link | null): link is Link & { peerDeviceId: string } {
  return Boolean(link
    && link.role === "same-org-peer"
    && link.linkState === "trusted"
    && !link.revokedAt
    && !link.quarantinedAt
    && link.peerDeviceId);
}

async function duplicateReceipt(
  row: InboxRow,
  request: A2aRequestV1,
  linkId: string,
  handler: A2aOperationHandler,
): Promise<A2aRequestReceiptV1> {
  if (storedDigest(row) !== a2aRequestDigest(request) || !row.localRecordRef) {
    return rejected(request.requestId, "request-id-conflict");
  }
  const state = await handler.readState(row.localRecordRef, { linkId }) ?? "unknown";
  return {
    specVersion: "dpf.a2a-receipt/1",
    requestId: request.requestId,
    outcome: "duplicate",
    receiverTaskId: row.localRecordRef,
    state,
  };
}

export async function handleIncomingA2aRequest(
  db: A2aIngressDb,
  input: { linkId: string; activity: string; record: unknown },
  context: A2aIngressContext,
  handlers: A2aOperationHandlers,
): Promise<A2aRequestReceiptV1> {
  const requestId = typeof (input.record as { requestId?: unknown } | null)?.requestId === "string"
    ? (input.record as { requestId: string }).requestId
    : "";
  if (!context.a2aEnabled) return rejected(requestId, "disabled");

  const link = await db.federationLink.findUnique({
    where: { linkId: input.linkId },
    select: {
      linkId: true, role: true, linkState: true, revokedAt: true, quarantinedAt: true,
      peerDeviceId: true, peerOrganizationRef: true,
    },
  });
  if (!linkEligibleForA2a(link)) return rejected(requestId, "link-not-eligible");

  if (validateA2aRequestV1(input.record).length > 0) return rejected(requestId, "malformed");
  const request = input.record as A2aRequestV1;
  if (input.activity !== a2aActivityForOperation(request.operation)) return rejected(requestId, "malformed");
  const handler = handlers[request.operation];
  if (!handler) return rejected(requestId, "unsupported-operation");

  if (request.sourceInstallationDid !== link.peerDeviceId) return rejected(requestId, "bad-signature");
  if (!verifyA2aRequestSignature(request, link.peerDeviceId)) return rejected(requestId, "bad-signature");
  if (request.targetInstallationDid !== context.selfInstallationDid) return rejected(requestId, "not-for-this-installation");
  if (!link.peerOrganizationRef || request.organizationRef !== link.peerOrganizationRef) {
    return rejected(requestId, "organization-mismatch");
  }

  const existing = await db.federatedRecordMirror.findUnique({ where: inboxWhere(link.linkId, requestId) });
  if (existing) return duplicateReceipt(existing, request, link.linkId, handler);

  const createdAt = Date.parse(request.createdAt);
  const notAfter = Date.parse(request.notAfter);
  if (notAfter - createdAt > A2A_REQUEST_MAX_LIFETIME_MS) return rejected(requestId, "lifetime-too-long");
  if (context.now.getTime() > notAfter) return rejected(requestId, "expired");

  try {
    return await db.$transaction(async (tx) => {
      const started = await handler.start(request, { linkId: link.linkId, tx, now: context.now });
      if (!started.ok) return rejected(requestId, started.reason);
      await tx.federatedRecordMirror.create({
        data: {
          mirrorId: `fa2a_${a2aRequestDigest(request).slice(7, 31)}`,
          federationLinkId: link.linkId,
          recordType: A2A_REQUEST_RECORD_TYPE,
          canonicalSide: "peer",
          localRecordRef: started.receiverTaskId,
          peerRecordRef: requestId,
          syncStatus: "synced",
          lastSyncedAt: context.now,
          payload: {
            digest: a2aRequestDigest(request),
            operation: request.operation,
            senderTaskId: request.senderTaskId,
            contextId: request.contextId,
            notAfter: request.notAfter,
            receivedAt: context.now.toISOString(),
          },
        },
      });
      const receipt: A2aRequestReceiptV1 = {
        specVersion: "dpf.a2a-receipt/1",
        requestId,
        outcome: "accepted",
        receiverTaskId: started.receiverTaskId,
        state: started.state,
      };
      return receipt;
    });
  } catch (error) {
    // A concurrent copy of this request won the inbox key; its work stands and
    // this one rolled back. Answer as the duplicate it is.
    if (!isUniqueViolation(error)) throw error;
    const winner = await db.federatedRecordMirror.findUnique({ where: inboxWhere(link.linkId, requestId) });
    if (!winner) throw error;
    return duplicateReceipt(winner, request, link.linkId, handler);
  }
}
