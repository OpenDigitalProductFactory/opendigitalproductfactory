import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@dpf/db";

import { readStoredEmailPostmarkCredential } from "@/lib/integrations/connectors/email-postmark";
import {
  createDurableConnectorAudit,
  executeCallbackTransaction,
  type ConnectorCallbackClient,
  type ConnectorCallbackTransaction,
  type ExecuteCallbackInput,
} from "@/lib/integrations/kernel/audit";
import { parseInboundPayload, verifyInboundSignature } from "@/lib/marketing/channels/email-postmark/client";
import { runInboundResponder } from "@/lib/marketing/channels/email-postmark/responder";

export const dynamic = "force-dynamic";
const INTEGRATION_ID = "email-postmark";
type PostmarkCallbackTransaction = ConnectorCallbackTransaction & {
  inboundChannelMessage: typeof prisma.inboundChannelMessage;
};
type PostmarkAcknowledgment = { ok: true; inboundId: string };

function json(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function auditTerminal(responseKind: string, errorCode: "authentication" | "invalid_payload" | "configuration") {
  await createDurableConnectorAudit({ repository: prisma.integrationToolCallLog }).record({
    connectorId: INTEGRATION_ID,
    actor: { coworkerId: "external-webhook", userId: null },
    operation: "callback",
    redactedInput: { event: "inbound-email" },
    responseKind,
    durationMs: 0,
    error: { kind: errorCode, safeMessage: responseKind },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  // The raw body is intentionally read exactly once and authenticated before parsing.
  const rawBody = await req.text();
  const credential = await prisma.integrationCredential.findUnique({ where: { integrationId: INTEGRATION_ID } });
  if (!credential || credential.status !== "connected") return json("integration_not_connected", 503);

  const stored = readStoredEmailPostmarkCredential(credential);
  if (!stored?.signingSecret) {
    await auditTerminal("signing_secret_missing", "configuration");
    return json("signing_secret_missing", 500);
  }
  if (!verifyInboundSignature({ rawBody, signatureHeader: req.headers.get("x-postmark-signature"), signingSecret: stored.signingSecret })) {
    await auditTerminal("invalid_signature", "authentication");
    return json("invalid_signature", 401);
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); }
  catch {
    await auditTerminal("invalid_json", "invalid_payload");
    return json("invalid_json", 400);
  }
  const parsed = parseInboundPayload(payload);
  if (!parsed) {
    await auditTerminal("malformed_payload", "invalid_payload");
    return json("malformed_payload", 400);
  }
  const organization = await prisma.organization.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!organization) return json("no_organization", 500);

  const callbackInput: ExecuteCallbackInput<PostmarkCallbackTransaction, PostmarkAcknowledgment> = {
    client: prisma as unknown as ConnectorCallbackClient<PostmarkCallbackTransaction>,
    connectorId: INTEGRATION_ID,
    deliveryKey: parsed.externalMessageId!,
    redactedRequest: { externalMessageId: parsed.externalMessageId, externalThreadId: parsed.externalThreadId },
    performDomainWrite: async (transaction) => {
      const inbound = await transaction.inboundChannelMessage.create({
        data: {
          organizationId: organization.id,
          domain: "marketing",
          channelId: INTEGRATION_ID,
          externalThreadId: parsed.externalThreadId,
          externalMessageId: parsed.externalMessageId,
          fromAddress: parsed.fromAddress,
          fromDisplayName: parsed.fromDisplayName,
          subject: parsed.subject,
          body: parsed.textBody,
          receivedAt: parsed.receivedAt,
          metadata: parsed.metadata as import("@dpf/db").Prisma.InputJsonValue,
        },
        select: { inboundId: true },
      });
      const acknowledgment = { ok: true as const, inboundId: inbound.inboundId };
      return { domainEntityId: inbound.inboundId, responseCode: 200, acknowledgment, dispatchPending: true };
    },
  };
  const callback = await executeCallbackTransaction(callbackInput);
  // Acknowledge independently of responder latency. Re-entering the completed
  // receipt drains dispatchPending; a crash before/during this call leaves it
  // recoverable by the next delivery or the pending-dispatch sweeper.
  void executeCallbackTransaction({
    ...callbackInput,
    responder: async (inboundId) => { await runInboundResponder({ inboundId }); },
  }).catch((error) => console.error("[email-postmark-inbound] responder dispatch failed:", error));
  return NextResponse.json(callback.acknowledgment, { status: callback.responseCode });
}
