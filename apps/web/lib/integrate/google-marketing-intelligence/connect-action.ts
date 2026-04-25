import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import { probeGoogleMarketingIntelligence } from "./clients";
import { exchangeGoogleRefreshToken, GoogleMarketingAuthError } from "./token-client";
import type { Dispatcher } from "undici";

export const GoogleMarketingConnectInputSchema = z.object({
  clientId: z.string().trim().min(1, "client ID required").max(256),
  clientSecret: z.string().trim().min(1, "client secret required").max(1024),
  refreshToken: z.string().trim().min(1, "refresh token required").max(4096),
  ga4PropertyId: z.string().trim().min(1, "GA4 property ID required").max(128),
  searchConsoleSiteUrl: z.string().trim().min(1, "Search Console site URL required").max(512),
});

export type GoogleMarketingConnectInput = z.infer<typeof GoogleMarketingConnectInputSchema>;

export type GoogleMarketingConnectResult =
  | {
    ok: true;
    status: "connected";
    ga4PropertyId: string;
    searchConsoleSiteUrl: string;
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

const INTEGRATION_ID = "google-marketing-intelligence";
const PROVIDER = "google";

export async function connectGoogleMarketingIntelligence(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<GoogleMarketingConnectResult> {
  const parseResult = GoogleMarketingConnectInputSchema.safeParse(rawInput);
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
    const token = await exchangeGoogleRefreshToken({
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      refreshToken: input.refreshToken,
      dispatcher: deps.dispatcher,
    });

    await probeGoogleMarketingIntelligence({
      accessToken: token.accessToken,
      ga4PropertyId: input.ga4PropertyId,
      searchConsoleSiteUrl: input.searchConsoleSiteUrl,
      dispatcher: deps.dispatcher,
    });

    const now = new Date();

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "connected",
        fieldsEnc: encryptJson({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          refreshToken: input.refreshToken,
          ga4PropertyId: input.ga4PropertyId,
          searchConsoleSiteUrl: input.searchConsoleSiteUrl,
        }),
        tokenCacheEnc: encryptJson({
          accessToken: token.accessToken,
          tokenType: token.tokenType,
          expiresAt: token.expiresAt.toISOString(),
          scope: token.scope,
        }),
        lastTestedAt: now,
      },
      update: {
        status: "connected",
        fieldsEnc: encryptJson({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          refreshToken: input.refreshToken,
          ga4PropertyId: input.ga4PropertyId,
          searchConsoleSiteUrl: input.searchConsoleSiteUrl,
        }),
        tokenCacheEnc: encryptJson({
          accessToken: token.accessToken,
          tokenType: token.tokenType,
          expiresAt: token.expiresAt.toISOString(),
          scope: token.scope,
        }),
        lastTestedAt: now,
        lastErrorAt: null,
        lastErrorMsg: null,
      },
    });

    return {
      ok: true,
      status: "connected",
      ga4PropertyId: input.ga4PropertyId,
      searchConsoleSiteUrl: input.searchConsoleSiteUrl,
      lastTestedAt: now.toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof GoogleMarketingAuthError || error instanceof Error
        ? error.message
        : "unexpected error during Google marketing connect";

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
          ga4PropertyId: input.ga4PropertyId,
          searchConsoleSiteUrl: input.searchConsoleSiteUrl,
        }),
        tokenCacheEnc: null,
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
