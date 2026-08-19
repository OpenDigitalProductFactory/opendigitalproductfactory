import type { Dispatcher } from "undici";
import { z } from "zod";
import { decryptJson } from "@/lib/govern/credential-crypto";

import {
  probeMicrosoft365Communications,
  type Microsoft365CommunicationsProbeResult,
} from "@/lib/integrations/microsoft365-communications/communications-client";
import {
  exchangeMicrosoftGraphClientCredentials,
  Microsoft365CommunicationsAuthError,
  type ExchangeMicrosoftGraphClientCredentialsResult,
} from "@/lib/integrations/microsoft365-communications/token-client";

import { parseConnectorDefinition } from "../kernel/definition";
import { ConnectorError } from "../kernel/error";
import type { SuccessfulConnectorCredential } from "../kernel/credential-store";

export const MICROSOFT365_COMMUNICATIONS_CONNECTOR_ID = "microsoft365-communications";

export const Microsoft365CommunicationsConnectInputSchema = z.object({
  tenantId: z.string().trim().min(1, "tenant ID required").max(256),
  clientId: z.string().trim().min(1, "client ID required").max(256),
  clientSecret: z.string().trim().min(1, "client secret required").max(1024),
  mailboxUserPrincipalName: z
    .string()
    .trim()
    .min(1, "mailbox user principal name required")
    .email("valid mailbox user principal name required")
    .max(320),
});

export type Microsoft365CommunicationsConnectInput = z.infer<
  typeof Microsoft365CommunicationsConnectInputSchema
>;

export const microsoft365CommunicationsDefinition = parseConnectorDefinition({
  schemaVersion: 1,
  key: MICROSOFT365_COMMUNICATIONS_CONNECTOR_ID,
  displayName: "Microsoft 365 Communications",
  capabilities: [
    "communications.email.read",
    "communications.calendar.read",
    "communications.teams.read",
  ],
  auth: { kind: "oauth2-client-credentials" },
  callback: { kind: "none" },
  operations: [
    {
      id: "communications.preview",
      capability: "communications.email.read",
      retry: { maxAttempts: 3, initialDelayMs: 250, maxDelayMs: 5_000 },
    },
  ],
  health: { probeIntervalSeconds: 300 },
  sync: { kind: "none" },
  authorities: [
    { resource: "microsoft365.communications", mode: "source" },
  ],
});

export interface Microsoft365CommunicationsConnected {
  credential: SuccessfulConnectorCredential;
  probe: Microsoft365CommunicationsProbeResult;
  token: ExchangeMicrosoftGraphClientCredentialsResult;
}

interface Microsoft365CommunicationsAdapterDeps {
  dispatcher?: Dispatcher;
  exchange?: (input: Microsoft365CommunicationsConnectInput) => Promise<ExchangeMicrosoftGraphClientCredentialsResult>;
  probe?: (input: {
    mailboxUserPrincipalName: string;
    accessToken: string;
  }) => Promise<Microsoft365CommunicationsProbeResult>;
}

interface StoredMicrosoft365Credentials extends Microsoft365CommunicationsConnectInput {
  cachedToken?: ExchangeMicrosoftGraphClientCredentialsResult;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readStoredMicrosoft365CommunicationsCredentials(record: {
  fieldsEnc: string;
  tokenCacheEnc?: string | null;
}): StoredMicrosoft365Credentials | null {
  const fieldsValue = object(decryptJson(record.fieldsEnc));
  if (!fieldsValue) return null;
  const reconnect = object(fieldsValue.reconnectFields) ?? fieldsValue;
  const secrets = object(fieldsValue.secretFields) ?? fieldsValue;
  const parsed = Microsoft365CommunicationsConnectInputSchema.safeParse({
    tenantId: reconnect.tenantId,
    clientId: reconnect.clientId,
    clientSecret: secrets.clientSecret,
    mailboxUserPrincipalName: reconnect.mailboxUserPrincipalName,
  });
  if (!parsed.success) return null;

  const tokenValue = record.tokenCacheEnc ? object(decryptJson(record.tokenCacheEnc)) : null;
  const envelope = object(tokenValue?.tokenEnvelope) ?? tokenValue;
  const expiresAt = typeof envelope?.expiresAt === "string" ? new Date(envelope.expiresAt) : null;
  const cachedToken =
    typeof envelope?.accessToken === "string" &&
    typeof envelope.tokenType === "string" &&
    expiresAt && !Number.isNaN(expiresAt.getTime())
      ? { accessToken: envelope.accessToken, tokenType: envelope.tokenType, expiresAt }
      : undefined;
  return { ...parsed.data, cachedToken };
}

function connectedResult(
  input: Microsoft365CommunicationsConnectInput,
  token: ExchangeMicrosoftGraphClientCredentialsResult,
  probe: Microsoft365CommunicationsProbeResult,
): Microsoft365CommunicationsConnected {
  return {
    probe,
    token,
    credential: {
      integrationId: MICROSOFT365_COMMUNICATIONS_CONNECTOR_ID,
      provider: "microsoft365",
      reconnectFields: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        mailboxUserPrincipalName: input.mailboxUserPrincipalName,
      },
      secretFields: { clientSecret: input.clientSecret },
      tokenEnvelope: {
        accessToken: token.accessToken,
        tokenType: token.tokenType,
        expiresAt: token.expiresAt.toISOString(),
      },
      safeProjection: {
        tenantDisplayName: probe.tenant.displayName,
        mailboxDisplayName: probe.mailbox.displayName,
        mailboxUserPrincipalName: input.mailboxUserPrincipalName,
        tokenExpiresAt: token.expiresAt.toISOString(),
      },
    },
  };
}

export function createMicrosoft365CommunicationsAdapter(
  dependencies: Microsoft365CommunicationsAdapterDeps = {},
) {
  const exchange = dependencies.exchange ?? ((input: Microsoft365CommunicationsConnectInput) =>
    exchangeMicrosoftGraphClientCredentials({ ...input, dispatcher: dependencies.dispatcher }));
  const probe = dependencies.probe ?? ((input: { mailboxUserPrincipalName: string; accessToken: string }) =>
    probeMicrosoft365Communications(input, { dispatcher: dependencies.dispatcher }));

  return {
    definition: microsoft365CommunicationsDefinition,

    async connect(rawInput: unknown): Promise<Microsoft365CommunicationsConnected> {
      const parsed = Microsoft365CommunicationsConnectInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new ConnectorError(
          "configuration",
          parsed.error.issues[0]?.message ?? "invalid input",
        );
      }
      const input = parsed.data;
      let token: ExchangeMicrosoftGraphClientCredentialsResult;
      try {
        token = await exchange(input);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Microsoft token exchange failed";
        throw new ConnectorError(
          cause instanceof Microsoft365CommunicationsAuthError ||
            (cause instanceof Error && cause.name === "Microsoft365CommunicationsAuthError")
            ? "authentication"
            : "upstream_unavailable",
          message,
          { cause },
        );
      }

      let probeResult: Microsoft365CommunicationsProbeResult;
      try {
        probeResult = await probe({
          mailboxUserPrincipalName: input.mailboxUserPrincipalName,
          accessToken: token.accessToken,
        });
      } catch (cause) {
        throw new ConnectorError(
          "upstream_unavailable",
          cause instanceof Error ? cause.message : "Microsoft Graph communications probe failed",
          { cause },
        );
      }

      return connectedResult(input, token, probeResult);
    },

    async preview(
      stored: StoredMicrosoft365Credentials,
      now: Date = new Date(),
    ): Promise<Microsoft365CommunicationsConnected> {
      const token = stored.cachedToken && stored.cachedToken.expiresAt.getTime() > now.getTime()
        ? stored.cachedToken
        : await exchange(stored).catch((cause) => {
          throw new ConnectorError(
            cause instanceof Microsoft365CommunicationsAuthError ? "authentication" : "upstream_unavailable",
            cause instanceof Error ? cause.message : "Microsoft token exchange failed",
            { cause },
          );
        });
      let probeResult: Microsoft365CommunicationsProbeResult;
      try {
        probeResult = await probe({
          mailboxUserPrincipalName: stored.mailboxUserPrincipalName,
          accessToken: token.accessToken,
        });
      } catch (cause) {
        throw new ConnectorError(
          "upstream_unavailable",
          cause instanceof Error ? cause.message : "Microsoft Graph communications probe failed",
          { cause },
        );
      }
      return connectedResult(stored, token, probeResult);
    },
  };
}
