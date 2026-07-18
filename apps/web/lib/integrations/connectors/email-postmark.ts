import { z } from "zod";

import { decryptJson } from "@/lib/govern/credential-crypto";
import { parseConnectorDefinition } from "../kernel/definition";
import type { SuccessfulConnectorCredential } from "../kernel/credential-store";
import { ConnectorError } from "../kernel/error";

export const EMAIL_POSTMARK_CONNECTOR_ID = "email-postmark";

export const emailPostmarkDefinition = parseConnectorDefinition({
  schemaVersion: 1,
  key: EMAIL_POSTMARK_CONNECTOR_ID,
  displayName: "Email (Postmark)",
  capabilities: ["communications.email.send", "communications.email.receive"],
  auth: { kind: "api-key" },
  callback: { kind: "webhook" },
  operations: [
    { id: "email.send", capability: "communications.email.send", retry: { maxAttempts: 3, initialDelayMs: 250, maxDelayMs: 5_000 } },
    { id: "email.receive", capability: "communications.email.receive", retry: { maxAttempts: 3, initialDelayMs: 250, maxDelayMs: 5_000 } },
  ],
  health: { probeIntervalSeconds: 300 },
  sync: { kind: "none" },
  authorities: [{ resource: "postmark.email", mode: "shared" }],
});

export const EmailPostmarkConnectInputSchema = z.object({
  serverToken: z.string().trim().min(1, "server token required").max(1024),
  signingSecret: z.string().trim().min(1, "signing secret required").max(1024),
  fromAddress: z.string().trim().email("From address must be a valid email."),
  replyToAddress: z.string().trim().email("Reply-to address must be a valid email.").optional().or(z.literal("")),
}).strict();

export type EmailPostmarkConnectInput = z.infer<typeof EmailPostmarkConnectInputSchema>;

export function createEmailPostmarkConnectorAdapter() {
  return {
    definition: emailPostmarkDefinition,
    async connect(raw: unknown): Promise<{ credential: SuccessfulConnectorCredential }> {
      const parsed = EmailPostmarkConnectInputSchema.safeParse(raw);
      if (!parsed.success) throw new ConnectorError("configuration", parsed.error.issues[0]?.message ?? "invalid input");
      const input = parsed.data;
      const replyToAddress = input.replyToAddress || null;
      return { credential: {
        integrationId: EMAIL_POSTMARK_CONNECTOR_ID,
        provider: "postmark",
        reconnectFields: { fromAddress: input.fromAddress, replyToAddress },
        secretFields: { signingSecret: input.signingSecret },
        tokenEnvelope: { serverToken: input.serverToken },
        safeProjection: { fromAddress: input.fromAddress, replyToAddress },
      } };
    },
  };
}

type Decrypt = (stored: string) => unknown;
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Vendor-local compatibility reader for both legacy and kernel credential envelopes. */
export function readStoredEmailPostmarkCredential(
  row: { fieldsEnc: string; tokenCacheEnc: string | null },
  decrypt: Decrypt = decryptJson,
): { fromAddress: string; replyToAddress: string | null; signingSecret: string; serverToken: string } | null {
  const fields = record(decrypt(row.fieldsEnc));
  const reconnect = record(fields?.reconnectFields) ?? fields;
  const secrets = record(fields?.secretFields) ?? fields;
  const tokensRaw = row.tokenCacheEnc ? record(decrypt(row.tokenCacheEnc)) : null;
  const tokens = record(tokensRaw?.tokenEnvelope) ?? tokensRaw;
  if (typeof reconnect?.fromAddress !== "string" || typeof secrets?.signingSecret !== "string") return null;
  const serverToken = typeof tokens?.serverToken === "string" ? tokens.serverToken : tokens?.server_token;
  if (typeof serverToken !== "string") return null;
  return {
    fromAddress: reconnect.fromAddress,
    replyToAddress: typeof reconnect.replyToAddress === "string" ? reconnect.replyToAddress : null,
    signingSecret: secrets.signingSecret,
    serverToken,
  };
}
