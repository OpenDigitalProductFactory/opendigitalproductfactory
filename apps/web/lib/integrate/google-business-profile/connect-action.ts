import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import {
  exchangeGoogleRefreshToken,
  GoogleMarketingAuthError,
} from "../google-marketing-intelligence/token-client";
import { GoogleBusinessProfileApiError, probeGoogleBusinessProfile } from "./client";
import type { Dispatcher } from "undici";

export const GoogleBusinessProfileConnectInputSchema = z.object({
  clientId: z.string().trim().min(1, "client ID required").max(256),
  clientSecret: z.string().trim().min(1, "client secret required").max(1024),
  refreshToken: z.string().trim().min(1, "refresh token required").max(4096),
  accountId: z.string().trim().min(1, "account ID required").max(128),
  locationId: z.string().trim().min(1, "location ID required").max(128),
});

export type GoogleBusinessProfileConnectInput = z.infer<
  typeof GoogleBusinessProfileConnectInputSchema
>;

export type GoogleBusinessProfileConnectResult =
  | {
    ok: true;
    status: "connected";
    accountId: string;
    locationId: string;
    locationTitle: string | null;
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

const INTEGRATION_ID = "google-business-profile";
const PROVIDER = "google";

export async function connectGoogleBusinessProfile(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<GoogleBusinessProfileConnectResult> {
  const parseResult = GoogleBusinessProfileConnectInputSchema.safeParse(rawInput);
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

    const probe = await probeGoogleBusinessProfile({
      accessToken: token.accessToken,
      accountId: input.accountId,
      locationId: input.locationId,
      dispatcher: deps.dispatcher,
    });

    const now = new Date();
    const locationTitle = typeof probe.location.title === "string" ? probe.location.title : null;
    const accountName = typeof probe.account.accountName === "string" ? probe.account.accountName : null;

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
          accountId: input.accountId,
          locationId: input.locationId,
          accountName,
          locationTitle,
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
          accountId: input.accountId,
          locationId: input.locationId,
          accountName,
          locationTitle,
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
      accountId: input.accountId,
      locationId: input.locationId,
      locationTitle,
      lastTestedAt: now.toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof GoogleMarketingAuthError ||
      error instanceof GoogleBusinessProfileApiError ||
      error instanceof Error
        ? error.message
        : "unexpected error during Google Business Profile connect";

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
          accountId: input.accountId,
          locationId: input.locationId,
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
