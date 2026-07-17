import { prisma } from "@dpf/db";

import {
  createEmailPostmarkConnectorAdapter,
  EmailPostmarkConnectInputSchema,
  EMAIL_POSTMARK_CONNECTOR_ID,
  readStoredEmailPostmarkCredential,
  type EmailPostmarkConnectInput as KernelEmailPostmarkConnectInput,
} from "@/lib/integrations/connectors/email-postmark";
import type { ConnectorAuditRepository } from "@/lib/integrations/kernel/audit";
import {
  createConnectorCredentialStore,
  createPrismaConnectorCredentialRepository,
} from "@/lib/integrations/kernel/credential-store";
import {
  composeConnectorLifecyclePersistence,
  createConnectorLifecycle,
  recordConnectorAuditInTransaction,
} from "@/lib/integrations/kernel/lifecycle";

export type EmailPostmarkConnectInput = KernelEmailPostmarkConnectInput;
export type EmailPostmarkConnectionState = {
  status: "unconfigured" | "connected" | "error";
  fromAddress: string | null;
  replyToAddress: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
};

type PostmarkTransaction = {
  integrationCredential: Parameters<typeof createPrismaConnectorCredentialRepository>[0]["integrationCredential"];
  integrationToolCallLog: ConnectorAuditRepository;
};

function kernel() {
  const repository = createPrismaConnectorCredentialRepository(
    prisma as unknown as Parameters<typeof createPrismaConnectorCredentialRepository<PostmarkTransaction>>[0],
  );
  const store = createConnectorCredentialStore({ repository });
  return { store, lifecycle: createConnectorLifecycle({ persistence: composeConnectorLifecyclePersistence(store) }) };
}

export async function saveEmailPostmarkCredential(
  rawInput: EmailPostmarkConnectInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!rawInput.serverToken || !rawInput.signingSecret || !rawInput.fromAddress) {
    return { ok: false, error: "Missing server token, signing secret, or From address." };
  }
  const parsed = EmailPostmarkConnectInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid Postmark configuration." };
  const input = parsed.data;
  const { lifecycle } = kernel();
  const startedAt = new Date();
  try {
    await lifecycle.connect({
      exchange: () => createEmailPostmarkConnectorAdapter().connect(input),
      persist: ({ credentials }, connected) => credentials.recordSuccessfulConnect(connected.credential),
      audit: ({ transaction }) => recordConnectorAuditInTransaction(transaction.integrationToolCallLog, {
        connectorId: EMAIL_POSTMARK_CONNECTOR_ID,
        actor: { coworkerId: "email-postmark-connect", userId: null },
        operation: "connect",
        redactedInput: { fromAddress: input.fromAddress, replyToAddress: input.replyToAddress || null },
        responseKind: "connected", resultCount: 1, durationMs: Date.now() - startedAt.getTime(),
      }),
      persistFailure: ({ credentials }, error) => credentials.recordFailedConnect({
        integrationId: EMAIL_POSTMARK_CONNECTOR_ID, provider: "postmark",
        reconnectFields: { fromAddress: input.fromAddress, replyToAddress: input.replyToAddress || null },
        secretFields: { signingSecret: input.signingSecret }, tokenEnvelope: { serverToken: input.serverToken },
        reconnectFieldsReusable: true, lastTestedAtPolicy: "preserve",
        error: { kind: "configuration", safeMessage: error instanceof Error ? error.message : "Postmark connection failed." },
      }),
      auditFailure: ({ transaction }, error) => recordConnectorAuditInTransaction(transaction.integrationToolCallLog, {
        connectorId: EMAIL_POSTMARK_CONNECTOR_ID,
        actor: { coworkerId: "email-postmark-connect", userId: null }, operation: "connect",
        redactedInput: { fromAddress: input.fromAddress, replyToAddress: input.replyToAddress || null },
        responseKind: "error", durationMs: Date.now() - startedAt.getTime(),
        error: { kind: "configuration", safeMessage: error instanceof Error ? error.message : "Postmark connection failed.", sensitiveValues: [input.serverToken, input.signingSecret] },
      }),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Postmark connection failed." };
  }
}

export async function disconnectEmailPostmark(): Promise<void> {
  const { lifecycle } = kernel();
  await lifecycle.disconnect({
    persist: ({ credentials }) => credentials.disconnect(EMAIL_POSTMARK_CONNECTOR_ID),
    audit: ({ transaction }) => recordConnectorAuditInTransaction(transaction.integrationToolCallLog, {
      connectorId: EMAIL_POSTMARK_CONNECTOR_ID,
      actor: { coworkerId: "email-postmark-disconnect", userId: null }, operation: "disconnect",
      redactedInput: {}, responseKind: "disconnected", resultCount: 0, durationMs: 0,
    }),
  });
}

export async function readEmailPostmarkConnectionState(): Promise<EmailPostmarkConnectionState> {
  const row = await prisma.integrationCredential.findUnique({ where: { integrationId: EMAIL_POSTMARK_CONNECTOR_ID } });
  if (!row) return { status: "unconfigured", fromAddress: null, replyToAddress: null, lastErrorMsg: null, lastTestedAt: null };
  const stored = readStoredEmailPostmarkCredential(row);
  return {
    status: row.status === "connected" || row.status === "error" ? row.status : "unconfigured",
    fromAddress: stored?.fromAddress ?? null,
    replyToAddress: stored?.replyToAddress ?? null,
    lastErrorMsg: row.lastErrorMsg,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
  };
}
