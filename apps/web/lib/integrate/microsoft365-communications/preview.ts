import { prisma } from "@dpf/db";

import {
  createMicrosoft365CommunicationsAdapter,
  readStoredMicrosoft365CommunicationsCredentials,
} from "@/lib/integrations/connectors/microsoft365-communications";
import {
  createConnectorCredentialStore,
  createPrismaConnectorCredentialRepository,
} from "@/lib/integrations/kernel/credential-store";
import type { ConnectorAuditRepository } from "@/lib/integrations/kernel/audit";
import { ConnectorError } from "@/lib/integrations/kernel/error";
import { recordConnectorAuditInTransaction } from "@/lib/integrations/kernel/lifecycle";
import type {
  Microsoft365CommunicationsProbeResult,
} from "./communications-client";
import type {
  ExchangeMicrosoftGraphClientCredentialsResult,
} from "./token-client";

const INTEGRATION_ID = "microsoft365-communications";

interface Microsoft365PreviewDeps {
  exchangeMicrosoftGraphClientCredentials?: (args: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
  }) => Promise<ExchangeMicrosoftGraphClientCredentialsResult>;
  probeMicrosoft365Communications?: (args: {
    mailboxUserPrincipalName: string;
    accessToken: string;
  }) => Promise<Microsoft365CommunicationsProbeResult>;
  now?: () => Date;
}

export type Microsoft365CommunicationsPreviewResult =
  | {
      state: "available";
      preview: Microsoft365CommunicationsProbeResult & {
        loadedAt: string;
      };
    }
  | { state: "unavailable" }
  | { state: "error"; error: string };

type MicrosoftTransaction = {
  integrationCredential: Parameters<typeof createPrismaConnectorCredentialRepository>[0]["integrationCredential"];
  integrationToolCallLog: ConnectorAuditRepository;
};

export async function loadMicrosoft365CommunicationsPreview(
  deps: Microsoft365PreviewDeps = {},
): Promise<Microsoft365CommunicationsPreviewResult> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });
  if (!record?.fieldsEnc) return { state: "unavailable" };

  const stored = readStoredMicrosoft365CommunicationsCredentials(record);
  if (!stored) return { state: "unavailable" };

  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  let transitionAt: Date | null = null;
  const adapter = createMicrosoft365CommunicationsAdapter({
    exchange: deps.exchangeMicrosoftGraphClientCredentials,
    probe: deps.probeMicrosoft365Communications,
  });
  const repository = createPrismaConnectorCredentialRepository(
    prisma as unknown as Parameters<typeof createPrismaConnectorCredentialRepository<MicrosoftTransaction>>[0],
  );
  const store = createConnectorCredentialStore({
    repository,
    now: () => transitionAt ?? now(),
  });

  try {
    const connected = await adapter.preview(stored, startedAt);
    transitionAt = now();
    await store.composeInTransaction(async ({ credentials, transaction }) => {
      await credentials.recordSuccessfulConnect(connected.credential);
      await recordConnectorAuditInTransaction(transaction.integrationToolCallLog, {
        connectorId: INTEGRATION_ID,
        actor: { coworkerId: "microsoft365-communications-preview", userId: null },
        operation: "health",
        redactedInput: { mailboxUserPrincipalName: stored.mailboxUserPrincipalName },
        responseKind: "connected",
        resultCount: 1,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
      }, now);
    });

    return {
      state: "available",
      preview: { ...connected.probe, loadedAt: transitionAt.toISOString() },
    };
  } catch (error) {
    transitionAt = now();
    const message = error instanceof Error
      ? error.message
      : "Microsoft 365 communications preview failed";
    await store.composeInTransaction(async ({ credentials, transaction }) => {
      await credentials.recordFailedConnect({
        integrationId: INTEGRATION_ID,
        provider: "microsoft365",
        reconnectFields: {
          tenantId: stored.tenantId,
          clientId: stored.clientId,
          mailboxUserPrincipalName: stored.mailboxUserPrincipalName,
        },
        secretFields: { clientSecret: stored.clientSecret },
        tokenEnvelope: {},
        reconnectFieldsReusable: true,
        lastTestedAtPolicy: "preserve",
        error: {
          kind: error instanceof ConnectorError && error.kind === "authentication"
            ? "authentication"
            : "provider",
          safeMessage: message,
        },
      });
      await recordConnectorAuditInTransaction(transaction.integrationToolCallLog, {
        connectorId: INTEGRATION_ID,
        actor: { coworkerId: "microsoft365-communications-preview", userId: null },
        operation: "health",
        redactedInput: { mailboxUserPrincipalName: stored.mailboxUserPrincipalName },
        responseKind: "degraded",
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        error: {
          kind: error instanceof ConnectorError ? error.kind : "internal",
          safeMessage: message,
          sensitiveValues: [stored.clientSecret],
        },
      }, now);
    });
    return { state: "error", error: message };
  }
}
