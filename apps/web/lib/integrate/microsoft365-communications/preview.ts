import { prisma } from "@dpf/db";
import { decryptJson, encryptJson } from "@/lib/govern/credential-crypto";
import {
  probeMicrosoft365Communications,
  type Microsoft365CommunicationsProbeResult,
} from "./communications-client";
import {
  exchangeMicrosoftGraphClientCredentials,
  type ExchangeMicrosoftGraphClientCredentialsResult,
} from "./token-client";

const INTEGRATION_ID = "microsoft365-communications";

interface StoredMicrosoft365Fields {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  mailboxUserPrincipalName?: string;
  tenantDisplayName?: string;
  mailboxDisplayName?: string;
}

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

export async function loadMicrosoft365CommunicationsPreview(
  deps: Microsoft365PreviewDeps = {},
): Promise<Microsoft365CommunicationsPreviewResult> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc) {
    return { state: "unavailable" };
  }

  const fields = decryptJson<StoredMicrosoft365Fields>(record.fieldsEnc);
  if (!isConfigured(fields)) {
    return { state: "unavailable" };
  }

  const exchange =
    deps.exchangeMicrosoftGraphClientCredentials ?? exchangeMicrosoftGraphClientCredentials;
  const probe = deps.probeMicrosoft365Communications ?? probeMicrosoft365Communications;

  try {
    const token = await exchange({
      tenantId: fields.tenantId,
      clientId: fields.clientId,
      clientSecret: fields.clientSecret,
    });
    const preview = await probe({
      mailboxUserPrincipalName: fields.mailboxUserPrincipalName,
      accessToken: token.accessToken,
    });

    const now = new Date();

    await prisma.integrationCredential.update({
      where: { integrationId: INTEGRATION_ID },
      data: {
        status: "connected",
        fieldsEnc: encryptJson({
          ...fields,
          tenantDisplayName: preview.tenant.displayName,
          mailboxDisplayName: preview.mailbox.displayName,
        }),
        tokenCacheEnc: encryptJson({
          accessToken: token.accessToken,
          tokenType: token.tokenType,
          expiresAt: token.expiresAt.toISOString(),
        }),
        lastTestedAt: now,
        lastErrorAt: null,
        lastErrorMsg: null,
      },
    });

    return {
      state: "available",
      preview: {
        ...preview,
        loadedAt: now.toISOString(),
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Microsoft 365 communications preview failed";
    const now = new Date();

    await prisma.integrationCredential.update({
      where: { integrationId: INTEGRATION_ID },
      data: {
        status: "error",
        lastErrorAt: now,
        lastErrorMsg: message,
      },
    });

    return {
      state: "error",
      error: message,
    };
  }
}

function isConfigured(fields: StoredMicrosoft365Fields | null): fields is {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailboxUserPrincipalName: string;
  tenantDisplayName?: string;
  mailboxDisplayName?: string;
} {
  return Boolean(
    fields &&
      typeof fields.tenantId === "string" &&
      typeof fields.clientId === "string" &&
      typeof fields.clientSecret === "string" &&
      typeof fields.mailboxUserPrincipalName === "string",
  );
}
