import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import {
  probeMicrosoft365Communications,
} from "./communications-client";
import {
  exchangeMicrosoftGraphClientCredentials,
  Microsoft365CommunicationsAuthError,
} from "./token-client";
import type { Dispatcher } from "undici";

const INTEGRATION_ID = "microsoft365-communications";
const PROVIDER = "microsoft365";

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
}

export async function connectMicrosoft365Communications(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<Microsoft365CommunicationsConnectResult> {
  const parseResult = Microsoft365CommunicationsConnectInputSchema.safeParse(rawInput);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    return {
      ok: false,
      status: "error",
      error: firstIssue?.message ?? "invalid input",
      statusCode: 400,
    };
  }

  const input = parseResult.data;
  const exchange =
    deps.exchangeMicrosoftGraphClientCredentials ?? exchangeMicrosoftGraphClientCredentials;
  const probe = deps.probeMicrosoft365Communications ?? probeMicrosoft365Communications;

  try {
    const token = await exchange({
      tenantId: input.tenantId,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      dispatcher: deps.dispatcher,
    });

    const probeResult = await probe(
      {
        mailboxUserPrincipalName: input.mailboxUserPrincipalName,
        accessToken: token.accessToken,
      },
      { dispatcher: deps.dispatcher },
    );

    const now = new Date();

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "connected",
        fieldsEnc: encryptJson({
          tenantId: input.tenantId,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          mailboxUserPrincipalName: input.mailboxUserPrincipalName,
          tenantDisplayName: probeResult.tenant.displayName,
          mailboxDisplayName: probeResult.mailbox.displayName,
        }),
        tokenCacheEnc: encryptJson({
          accessToken: token.accessToken,
          tokenType: token.tokenType,
          expiresAt: token.expiresAt.toISOString(),
        }),
        lastTestedAt: now,
      },
      update: {
        status: "connected",
        fieldsEnc: encryptJson({
          tenantId: input.tenantId,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          mailboxUserPrincipalName: input.mailboxUserPrincipalName,
          tenantDisplayName: probeResult.tenant.displayName,
          mailboxDisplayName: probeResult.mailbox.displayName,
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
      ok: true,
      status: "connected",
      tenantDisplayName: probeResult.tenant.displayName,
      mailboxDisplayName: probeResult.mailbox.displayName,
      lastTestedAt: now.toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof Microsoft365CommunicationsAuthError || error instanceof Error
        ? error.message
        : "unexpected error during Microsoft 365 connect";

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "error",
        fieldsEnc: encryptJson({
          tenantId: input.tenantId,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          mailboxUserPrincipalName: input.mailboxUserPrincipalName,
        }),
        lastErrorAt: new Date(),
        lastErrorMsg: message,
      },
      update: {
        status: "error",
        lastErrorAt: new Date(),
        lastErrorMsg: message,
      },
    });

    return {
      ok: false,
      status: "error",
      error: message,
      statusCode: 400,
    };
  }
}
