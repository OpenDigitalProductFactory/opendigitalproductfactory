import { prisma } from "@dpf/db";

import type { ConnectorAuditRepository } from "@/lib/integrations/kernel/audit";
import {
  createConnectorCredentialStore,
  createPrismaConnectorCredentialRepository,
} from "@/lib/integrations/kernel/credential-store";
import {
  composeConnectorLifecyclePersistence,
  ConnectorAttemptFailedError,
  createConnectorLifecycle,
  recordConnectorAuditInTransaction,
} from "@/lib/integrations/kernel/lifecycle";
import { err, ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";

import { createWordPressConnectorAdapter, type WordPressCredential } from "./connector";
import type { WordPressProbe } from "./client";

export type WordPressConnectResult =
  | (ActionSuccess & { status: "connected"; lastTestedAt: string } & Pick<WordPressProbe, "siteName" | "origin" | "supportedResourceKinds" | "supportedTaxonomies" | "unsupportedResourceTypes" | "canCreateDrafts" | "canPublishLive" | "canUploadMedia">)
  | (ActionFailure & { status: "error"; statusCode: number });

type WordPressTransaction = {
  integrationCredential: Parameters<typeof createPrismaConnectorCredentialRepository>[0]["integrationCredential"];
  integrationToolCallLog: ConnectorAuditRepository;
};

export async function connectWordPress(rawInput: unknown, dependencies: {
  probe?: (credential: WordPressCredential) => Promise<WordPressProbe>;
  now?: () => Date;
} = {}): Promise<WordPressConnectResult> {
  const now = dependencies.now ?? (() => new Date());
  const adapter = createWordPressConnectorAdapter({
    createClient: dependencies.probe ? ({ credential }) => ({ probe: () => dependencies.probe!(credential) }) : undefined,
  });
  const repository = createPrismaConnectorCredentialRepository(
    prisma as unknown as Parameters<typeof createPrismaConnectorCredentialRepository<WordPressTransaction>>[0],
  );
  let transitionAt: Date | null = null;
  const store = createConnectorCredentialStore({ repository, now: () => transitionAt ?? now() });
  const lifecycle = createConnectorLifecycle({ persistence: composeConnectorLifecyclePersistence(store) });
  const startedAt = now();
  const redactedInput = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
    ? { siteUrl: String((rawInput as Record<string, unknown>).siteUrl ?? "").slice(0, 2_048), username: String((rawInput as Record<string, unknown>).username ?? "").slice(0, 128) }
    : {};
  const reusableFields: Record<string, string> = {};
  if (typeof redactedInput.siteUrl === "string" && typeof redactedInput.username === "string") {
    reusableFields.siteUrl = redactedInput.siteUrl;
    reusableFields.username = redactedInput.username;
  }

  try {
    const connected = await lifecycle.connect({
      exchange: async () => {
        try { return await adapter.connect(rawInput); }
        finally { transitionAt = now(); }
      },
      persist: ({ credentials }, result) => credentials.recordSuccessfulConnect(result.credential),
      audit: ({ transaction }) => recordConnectorAuditInTransaction(transaction.integrationToolCallLog, {
        connectorId: "wordpress-self-hosted",
        actor: { coworkerId: "wordpress-self-hosted-connect", userId: null },
        operation: "connect",
        redactedInput,
        responseKind: "connected",
        resultCount: 1,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
      }, now),
      persistFailure: ({ credentials }, failure) => credentials.recordFailedConnect({
        integrationId: "wordpress-self-hosted",
        provider: "wordpress",
        reconnectFields: reusableFields,
        secretFields: {},
        tokenEnvelope: {},
        reconnectFieldsReusable: true,
        lastTestedAtPolicy: "preserve",
        error: { kind: failure.kind === "authentication" ? "authentication" : failure.kind === "authorization" ? "authorization" : "provider", safeMessage: failure.safeMessage },
      }),
      auditFailure: ({ transaction }, failure) => recordConnectorAuditInTransaction(transaction.integrationToolCallLog, {
        connectorId: "wordpress-self-hosted",
        actor: { coworkerId: "wordpress-self-hosted-connect", userId: null },
        operation: "connect",
        redactedInput,
        responseKind: "error",
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        error: { kind: failure.kind === "cancelled" ? "internal" : failure.kind, safeMessage: failure.safeMessage },
      }, now),
    });
    return Object.assign(ok(), {
      status: "connected",
      siteName: connected.probe.siteName,
      origin: connected.probe.origin,
      supportedResourceKinds: connected.probe.supportedResourceKinds,
      supportedTaxonomies: connected.probe.supportedTaxonomies,
      unsupportedResourceTypes: connected.probe.unsupportedResourceTypes,
      canCreateDrafts: connected.probe.canCreateDrafts,
      canPublishLive: connected.probe.canPublishLive,
      canUploadMedia: connected.probe.canUploadMedia,
      lastTestedAt: (transitionAt ?? now()).toISOString(),
    } as const);
  } catch (error) {
    return Object.assign(
      err(error instanceof ConnectorAttemptFailedError ? error.failure.safeMessage : "WordPress connection could not be completed."),
      { status: "error", statusCode: 400 } as const,
    );
  }
}
