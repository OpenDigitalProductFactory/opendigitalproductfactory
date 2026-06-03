// Postmark integration config — credential read/write helpers.
//
// Postmark uses an API-key flow (server token + signing secret), not OAuth.
// fieldsEnc holds the From address + reply-to + signing secret + verified
// flag; tokenCacheEnc holds the server token itself so token rotation is
// idempotent without touching the operator-supplied From address.

import { prisma } from "@dpf/db";
import { encryptJson, decryptJson } from "@/lib/govern/credential-crypto";

const INTEGRATION_ID = "email-postmark";
const PROVIDER = "postmark";

export type EmailPostmarkConnectInput = {
  serverToken: string;
  signingSecret: string;
  fromAddress: string;
  replyToAddress?: string;
};

export type EmailPostmarkConnectionState = {
  status: "unconfigured" | "connected" | "error";
  fromAddress: string | null;
  replyToAddress: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
};

export async function saveEmailPostmarkCredential(
  input: EmailPostmarkConnectInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.serverToken || !input.signingSecret || !input.fromAddress) {
    return { ok: false, error: "Missing server token, signing secret, or From address." };
  }
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(input.fromAddress)) {
    return { ok: false, error: "From address must be a valid email." };
  }
  await prisma.integrationCredential.upsert({
    where: { integrationId: INTEGRATION_ID },
    create: {
      integrationId: INTEGRATION_ID,
      provider: PROVIDER,
      status: "connected",
      fieldsEnc: encryptJson({
        fromAddress: input.fromAddress,
        replyToAddress: input.replyToAddress ?? null,
        signingSecret: input.signingSecret,
      }),
      tokenCacheEnc: encryptJson({ server_token: input.serverToken }),
      lastTestedAt: new Date(),
    },
    update: {
      provider: PROVIDER,
      status: "connected",
      fieldsEnc: encryptJson({
        fromAddress: input.fromAddress,
        replyToAddress: input.replyToAddress ?? null,
        signingSecret: input.signingSecret,
      }),
      tokenCacheEnc: encryptJson({ server_token: input.serverToken }),
      lastTestedAt: new Date(),
      lastErrorAt: null,
      lastErrorMsg: null,
    },
  });
  return { ok: true };
}

export async function disconnectEmailPostmark(): Promise<void> {
  await prisma.integrationCredential.deleteMany({
    where: { integrationId: INTEGRATION_ID },
  });
}

export async function readEmailPostmarkConnectionState(): Promise<EmailPostmarkConnectionState> {
  const row = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });
  if (!row) {
    return {
      status: "unconfigured",
      fromAddress: null,
      replyToAddress: null,
      lastErrorMsg: null,
      lastTestedAt: null,
    };
  }
  const fields = decryptJson<{ fromAddress?: string; replyToAddress?: string | null }>(row.fieldsEnc) ?? {};
  return {
    status: row.status === "connected" || row.status === "error" ? row.status : "unconfigured",
    fromAddress: typeof fields.fromAddress === "string" ? fields.fromAddress : null,
    replyToAddress: typeof fields.replyToAddress === "string" ? fields.replyToAddress : null,
    lastErrorMsg: row.lastErrorMsg,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
  };
}
