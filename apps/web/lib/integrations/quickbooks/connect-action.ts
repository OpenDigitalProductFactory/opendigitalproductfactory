import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import {
  probeQuickBooksAccounting,
  type QuickBooksEnvironment,
} from "./accounting-client";
import { exchangeRefreshToken, QuickBooksAuthError } from "./token-client";
import type { Dispatcher } from "undici";

export const QuickBooksConnectInputSchema = z.object({
  clientId: z.string().trim().min(1, "client ID required").max(256),
  clientSecret: z.string().trim().min(1, "client secret required").max(1024),
  refreshToken: z.string().trim().min(1, "refresh token required").max(4096),
  realmId: z.string().trim().min(1, "realm ID required").max(128),
  environment: z.enum(["sandbox", "production"]),
});

export type QuickBooksConnectInput = z.infer<typeof QuickBooksConnectInputSchema>;

export type QuickBooksConnectResult =
  | {
    ok: true;
    status: "connected";
    companyName: string | null;
    realmId: string;
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
}

const INTEGRATION_ID = "quickbooks-online-accounting";
const PROVIDER = "quickbooks";

export async function connectQuickBooks(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<QuickBooksConnectResult> {
  const parseResult = QuickBooksConnectInputSchema.safeParse(rawInput);
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

  try {
    const token = await exchangeRefreshToken({
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      refreshToken: input.refreshToken,
      dispatcher: deps.dispatcher,
    });

    const probe = await probeQuickBooksAccounting({
      environment: input.environment satisfies QuickBooksEnvironment,
      realmId: input.realmId,
      accessToken: token.accessToken,
      dispatcher: deps.dispatcher,
    });

    const now = new Date();
    const companyName =
      typeof probe.companyInfo.CompanyName === "string" ? probe.companyInfo.CompanyName : null;

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "connected",
        fieldsEnc: encryptJson({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          refreshToken: token.refreshToken,
          realmId: input.realmId,
          environment: input.environment,
          companyName,
        }),
        tokenCacheEnc: encryptJson({
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          tokenType: token.tokenType,
          expiresAt: token.expiresAt.toISOString(),
        }),
        lastTestedAt: now,
      },
      update: {
        status: "connected",
        fieldsEnc: encryptJson({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          refreshToken: token.refreshToken,
          realmId: input.realmId,
          environment: input.environment,
          companyName,
        }),
        tokenCacheEnc: encryptJson({
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
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
      companyName,
      realmId: input.realmId,
      lastTestedAt: now.toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof QuickBooksAuthError || error instanceof Error
        ? error.message
        : "unexpected error during QuickBooks connect";

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "error",
        fieldsEnc: encryptJson({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          refreshToken: input.refreshToken,
          realmId: input.realmId,
          environment: input.environment,
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
