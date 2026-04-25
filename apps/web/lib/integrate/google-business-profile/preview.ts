import { prisma } from "@dpf/db";
import { decryptJson, encryptJson } from "@/lib/govern/credential-crypto";
import {
  exchangeGoogleRefreshToken,
  type ExchangeGoogleRefreshTokenResult,
} from "../google-marketing-intelligence/token-client";
import {
  probeGoogleBusinessProfile as defaultProbeGoogleBusinessProfile,
  type GoogleBusinessProfileProbeResult,
} from "./client";

const INTEGRATION_ID = "google-business-profile";

type GoogleBusinessProfilePreview =
  | { state: "unavailable" }
  | {
    state: "available";
    preview: GoogleBusinessProfileProbeResult & { loadedAt: string };
  }
  | {
    state: "error";
    error: string;
  };

interface PreviewDeps {
  exchangeRefreshToken?: typeof exchangeGoogleRefreshToken;
  probeGoogleBusinessProfile?: typeof defaultProbeGoogleBusinessProfile;
}

export async function loadGoogleBusinessProfilePreview(
  deps: PreviewDeps = {},
): Promise<GoogleBusinessProfilePreview> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc) {
    return { state: "unavailable" };
  }

  const decoded = decryptJson<{
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    accountId?: string;
    locationId?: string;
  }>(record.fieldsEnc);

  if (
    typeof decoded?.clientId !== "string" ||
    typeof decoded?.clientSecret !== "string" ||
    typeof decoded?.refreshToken !== "string" ||
    typeof decoded?.accountId !== "string" ||
    typeof decoded?.locationId !== "string" ||
    decoded.clientId.length === 0 ||
    decoded.clientSecret.length === 0 ||
    decoded.refreshToken.length === 0 ||
    decoded.accountId.length === 0 ||
    decoded.locationId.length === 0
  ) {
    return { state: "unavailable" };
  }

  const exchangeRefreshToken = deps.exchangeRefreshToken ?? exchangeGoogleRefreshToken;
  const probeGoogleBusinessProfile =
    deps.probeGoogleBusinessProfile ?? defaultProbeGoogleBusinessProfile;

  try {
    const token: ExchangeGoogleRefreshTokenResult = await exchangeRefreshToken({
      clientId: decoded.clientId,
      clientSecret: decoded.clientSecret,
      refreshToken: decoded.refreshToken,
    });

    const preview = await probeGoogleBusinessProfile({
      accessToken: token.accessToken,
      accountId: decoded.accountId,
      locationId: decoded.locationId,
    });

    const now = new Date();
    await prisma.integrationCredential.update({
      where: { integrationId: INTEGRATION_ID },
      data: {
        status: "connected",
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
    const message = error instanceof Error ? error.message : "Google Business Profile preview failed";
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
