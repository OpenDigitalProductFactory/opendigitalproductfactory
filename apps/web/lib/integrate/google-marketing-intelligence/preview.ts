import { prisma } from "@dpf/db";
import { decryptJson, encryptJson } from "@/lib/govern/credential-crypto";
import {
  probeGoogleMarketingIntelligence as defaultProbeGoogleMarketingIntelligence,
  type GoogleMarketingProbeResult,
} from "./clients";
import {
  exchangeGoogleRefreshToken as defaultExchangeGoogleRefreshToken,
  type ExchangeGoogleRefreshTokenResult,
} from "./token-client";

const INTEGRATION_ID = "google-marketing-intelligence";

interface StoredGoogleFields {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  ga4PropertyId?: string;
  searchConsoleSiteUrl?: string;
}

interface GoogleMarketingPreviewDeps {
  exchangeGoogleRefreshToken?: (args: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }) => Promise<ExchangeGoogleRefreshTokenResult>;
  probeGoogleMarketingIntelligence?: (args: {
    accessToken: string;
    ga4PropertyId: string;
    searchConsoleSiteUrl: string;
  }) => Promise<GoogleMarketingProbeResult>;
}

export type GoogleMarketingPreviewResult =
  | {
    state: "available";
    preview: GoogleMarketingProbeResult & { loadedAt: string };
  }
  | { state: "unavailable" }
  | { state: "error"; error: string };

export async function loadGoogleMarketingPreview(
  deps: GoogleMarketingPreviewDeps = {},
): Promise<GoogleMarketingPreviewResult> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc) {
    return { state: "unavailable" };
  }

  const fields = decryptJson<StoredGoogleFields>(record.fieldsEnc);
  if (!isConfigured(fields)) {
    return { state: "unavailable" };
  }

  const exchangeGoogleRefreshToken =
    deps.exchangeGoogleRefreshToken ?? defaultExchangeGoogleRefreshToken;
  const probeGoogleMarketingIntelligence =
    deps.probeGoogleMarketingIntelligence ?? defaultProbeGoogleMarketingIntelligence;

  try {
    const token = await exchangeGoogleRefreshToken({
      clientId: fields.clientId,
      clientSecret: fields.clientSecret,
      refreshToken: fields.refreshToken,
    });

    const preview = await probeGoogleMarketingIntelligence({
      accessToken: token.accessToken,
      ga4PropertyId: fields.ga4PropertyId,
      searchConsoleSiteUrl: fields.searchConsoleSiteUrl,
    });

    const now = new Date();
    await prisma.integrationCredential.update({
      where: { integrationId: INTEGRATION_ID },
      data: {
        status: "connected",
        fieldsEnc: encryptJson(fields),
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
      state: "available",
      preview: {
        ...preview,
        loadedAt: now.toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google marketing preview failed";
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

function isConfigured(fields: StoredGoogleFields | null): fields is {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  ga4PropertyId: string;
  searchConsoleSiteUrl: string;
} {
  return Boolean(
    fields &&
      typeof fields.clientId === "string" &&
      typeof fields.clientSecret === "string" &&
      typeof fields.refreshToken === "string" &&
      typeof fields.ga4PropertyId === "string" &&
      typeof fields.searchConsoleSiteUrl === "string",
  );
}
