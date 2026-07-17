import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { randomUUID } from "node:crypto";

import { readStoredEmailPostmarkCredential } from "@/lib/integrations/connectors/email-postmark";
import {
  createDurableConnectorAudit,
  executeCallbackTransaction,
  type ConnectorCallbackClient,
  type ConnectorCallbackTransaction,
  type ExecuteCallbackInput,
} from "@/lib/integrations/kernel/audit";
import { parseInboundPayload, verifyInboundSignature } from "@/lib/marketing/channels/email-postmark/client";
import { inngest } from "@/lib/queue/inngest-client";

export const dynamic = "force-dynamic";
const INTEGRATION_ID = "email-postmark";
type PostmarkCallbackTransaction = ConnectorCallbackTransaction & {
  inboundChannelMessage: typeof prisma.inboundChannelMessage;
};
type PostmarkAcknowledgment = { ok: true; inboundId: string };

function json(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function auditTerminal(responseKind: string, errorCode: "authentication" | "invalid_payload" | "configuration" | "not_connected") {
  const eventKey = `${INTEGRATION_ID}:${responseKind}:${randomUUID()}`;
  try {
    await createDurableConnectorAudit({ repository: prisma.integrationToolCallLog }).record({
      connectorId: INTEGRATION_ID, actor: { coworkerId: "external-webhook", userId: null },
      operation: "callback", redactedInput: { event: "inbound-email" }, responseKind,
      resultCount: 0, durationMs: 0, error: { kind: errorCode, safeMessage: responseKind },
    });
  } catch {
    // Independent durable queue fallback when the database outbox is briefly
    // unavailable. The event contains only the safe terminal projection.
    await Promise.race([
      inngest.send({ name: "integrations/postmark-callback.received", data: {
        terminalAudit: { eventKey, responseKind, errorCode },
      } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("enqueue timeout")), 2_000)),
    ]).catch(() => undefined);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  // The raw body is intentionally read exactly once and authenticated before parsing.
  const rawBody = await req.text();
  const credential = await prisma.integrationCredential.findUnique({ where: { integrationId: INTEGRATION_ID } });
  if (!credential || credential.status !== "connected") {
    await auditTerminal("integration_not_connected", "not_connected");
    return json("integration_not_connected", 503);
  }

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
  if (!organization) {
    await auditTerminal("no_organization", "configuration");
    return json("no_organization", 500);
  }

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
  // The receipt + responder job are already durable. A bounded event enqueue
  // lowers latency; the registered cron worker recovers any missed event.
  await Promise.race([
    inngest.send({ name: "integrations/postmark-callback.received", data: { deliveryKey: parsed.externalMessageId! } }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("enqueue timeout")), 2_000)),
  ]).catch(() => undefined);
  return NextResponse.json(callback.acknowledgment, { status: callback.responseCode });
}
