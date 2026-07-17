import { prisma } from "@dpf/db";
import type { Dispatcher } from "undici";

import {
  createMicrosoft365CommunicationsAdapter,
  Microsoft365CommunicationsConnectInputSchema,
  type Microsoft365CommunicationsConnectInput,
} from "@/lib/integrations/connectors/microsoft365-communications";
import {
  createConnectorCredentialStore,
  createPrismaConnectorCredentialRepository,
} from "@/lib/integrations/kernel/credential-store";
import { ConnectorError } from "@/lib/integrations/kernel/error";
import {
  composeConnectorLifecyclePersistence,
  createConnectorLifecycle,
  recordConnectorAuditInTransaction,
} from "@/lib/integrations/kernel/lifecycle";
import type { ConnectorAuditRepository } from "@/lib/integrations/kernel/audit";
import type { probeMicrosoft365Communications } from "./communications-client";
import type { exchangeMicrosoftGraphClientCredentials } from "./token-client";

export { Microsoft365CommunicationsConnectInputSchema };
export type { Microsoft365CommunicationsConnectInput };

export type Microsoft365CommunicationsConnectResult =
  | {
      ok: true;
      status: "connected";
      tenantDisplayName: string;
      mailboxDisplayName: string;
      lastTestedAt: string;
    }
  | {
      ok: false;
      status: "error";
      error: string;
      statusCode: number;
    };

interface ConnectActionDeps {
  dispatcher?: Dispatcher;
  exchangeMicrosoftGraphClientCredentials?: typeof exchangeMicrosoftGraphClientCredentials;
  probeMicrosoft365Communications?: typeof probeMicrosoft365Communications;
  now?: () => Date;
}

type MicrosoftTransaction = {
  integrationCredential: Parameters<typeof createPrismaConnectorCredentialRepository>[0]["integrationCredential"];
  integrationToolCallLog: ConnectorAuditRepository;
};

export async function connectMicrosoft365Communications(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<Microsoft365CommunicationsConnectResult> {
  const parseResult = Microsoft365CommunicationsConnectInputSchema.safeParse(rawInput);
  if (!parseResult.success) {
    return {
      ok: false,
      status: "error",
      error: parseResult.error.issues[0]?.message ?? "invalid input",
      statusCode: 400,
    };
  }

  const input = parseResult.data;
  const now = deps.now ?? (() => new Date());
  let transitionAt: Date | null = null;
  const adapter = createMicrosoft365CommunicationsAdapter({
    dispatcher: deps.dispatcher,
    exchange: deps.exchangeMicrosoftGraphClientCredentials
      ? (value) => deps.exchangeMicrosoftGraphClientCredentials!({ ...value, dispatcher: deps.dispatcher })
      : undefined,
    probe: deps.probeMicrosoft365Communications
      ? (value) => deps.probeMicrosoft365Communications!(value, { dispatcher: deps.dispatcher })
      : undefined,
  });

  // Prisma's generated client is structurally compatible with the narrow kernel
  // port; the port intentionally excludes unrelated model delegates.
  const repository = createPrismaConnectorCredentialRepository(
    prisma as unknown as Parameters<typeof createPrismaConnectorCredentialRepository<MicrosoftTransaction>>[0],
  );
  const credentialStore = createConnectorCredentialStore({
    repository,
    now: () => transitionAt ?? now(),
  });
  const lifecycle = createConnectorLifecycle({
    persistence: composeConnectorLifecyclePersistence(credentialStore),
  });
  const startedAt = now();

  try {
    const connected = await lifecycle.connect({
      exchange: async () => {
        try {
          return await adapter.connect(input);
        } finally {
          transitionAt = now();
        }
      },
      persist: ({ credentials }, result) => credentials.recordSuccessfulConnect(result.credential),
      audit: ({ transaction }) => recordConnectorAuditInTransaction(
        transaction.integrationToolCallLog,
        {
          connectorId: "microsoft365-communications",
          actor: { coworkerId: "microsoft365-communications-connect", userId: null },
          operation: "connect",
          redactedInput: {
            tenantId: input.tenantId,
            clientId: input.clientId,
            mailboxUserPrincipalName: input.mailboxUserPrincipalName,
          },
          responseKind: "connected",
          resultCount: 1,
          durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        },
        now,
      ),
      persistFailure: ({ credentials }, error) => credentials.recordFailedConnect({
        integrationId: "microsoft365-communications",
        provider: "microsoft365",
        reconnectFields: {
          tenantId: input.tenantId,
          clientId: input.clientId,
          mailboxUserPrincipalName: input.mailboxUserPrincipalName,
        },
        secretFields: { clientSecret: input.clientSecret },
        tokenEnvelope: {},
        reconnectFieldsReusable: true,
        error: {
          kind: error instanceof ConnectorError && error.kind === "authentication"
            ? "authentication"
            : "provider",
          safeMessage: error instanceof Error
            ? error.message
            : "unexpected error during Microsoft 365 connect",
        },
      }),
      auditFailure: ({ transaction }, error) => recordConnectorAuditInTransaction(
        transaction.integrationToolCallLog,
        {
          connectorId: "microsoft365-communications",
          actor: { coworkerId: "microsoft365-communications-connect", userId: null },
          operation: "connect",
          redactedInput: {
            tenantId: input.tenantId,
            clientId: input.clientId,
            mailboxUserPrincipalName: input.mailboxUserPrincipalName,
          },
          responseKind: "error",
          durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
          error: {
            kind: error instanceof ConnectorError ? error.kind : "internal",
            safeMessage: error instanceof Error
              ? error.message
              : "unexpected error during Microsoft 365 connect",
            sensitiveValues: [input.clientSecret],
          },
        },
        now,
      ),
    });

    const lastTestedAt = (transitionAt ?? now()).toISOString();
    return {
      ok: true,
      status: "connected",
      tenantDisplayName: connected.probe.tenant.displayName,
      mailboxDisplayName: connected.probe.mailbox.displayName,
      lastTestedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error
        ? error.message
        : "unexpected error during Microsoft 365 connect",
      statusCode: 400,
    };
  }
}
