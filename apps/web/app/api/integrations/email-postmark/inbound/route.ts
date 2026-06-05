// Postmark inbound webhook receiver.
//
// Postmark POSTs a JSON envelope per inbound email. We:
//   1. Verify HMAC signature against the operator's stored signing secret.
//      On mismatch: 401, no DB write.
//   2. Parse the payload, create one InboundChannelMessage(domain=marketing).
//   3. Fire-and-forget the responder (classify + maybe draft a reply).
//   4. Ack with 200 so Postmark doesn't retry.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import { parseInboundPayload, verifyInboundSignature } from "@/lib/marketing/channels/email-postmark/client";
import { runInboundResponder } from "@/lib/marketing/channels/email-postmark/responder";

export const dynamic = "force-dynamic";

const INTEGRATION_ID = "email-postmark";

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();

  const credential = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });
  if (!credential || credential.status !== "connected") {
    return NextResponse.json({ error: "integration_not_connected" }, { status: 503 });
  }

  const fields = decryptJson<{ signingSecret?: string }>(credential.fieldsEnc) ?? {};
  const signingSecret = typeof fields.signingSecret === "string" ? fields.signingSecret : "";
  if (!signingSecret) {
    return NextResponse.json({ error: "signing_secret_missing" }, { status: 500 });
  }

  const signatureHeader = req.headers.get("x-postmark-signature");
  const verified = verifyInboundSignature({
    rawBody,
    signatureHeader,
    signingSecret,
  });
  if (!verified) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseInboundPayload(payload);
  if (!parsed) {
    return NextResponse.json({ error: "malformed_payload" }, { status: 400 });
  }

  const organization = await prisma.organization.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!organization) {
    return NextResponse.json({ error: "no_organization" }, { status: 500 });
  }

  const inbound = await prisma.inboundChannelMessage.create({
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

  // Fire-and-forget responder. Errors get logged but never block the ack
  // back to Postmark — at-least-once delivery semantics.
  runInboundResponder({ inboundId: inbound.inboundId }).catch((err) => {
    console.error("[email-postmark-inbound] responder failed:", err);
  });

  return NextResponse.json({ ok: true, inboundId: inbound.inboundId }, { status: 200 });
}
