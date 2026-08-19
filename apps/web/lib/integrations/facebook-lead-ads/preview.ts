import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import {
  probeFacebookLeadAds as defaultProbeFacebookLeadAds,
  type FacebookLeadAdsProbeResult,
} from "./client";

const INTEGRATION_ID = "facebook-lead-ads";

interface StoredFacebookLeadAdsFields {
  accessToken?: string;
  pageId?: string;
  pageName?: string;
  pageCategory?: string;
}

interface FacebookLeadAdsPreviewDeps {
  probeFacebookLeadAds?: (args: {
    accessToken: string;
    pageId: string;
  }) => Promise<FacebookLeadAdsProbeResult>;
}

export type FacebookLeadAdsPreviewResult =
  | {
    state: "available";
    preview: FacebookLeadAdsProbeResult & { loadedAt: string };
  }
  | { state: "unavailable" }
  | { state: "error"; error: string };

export async function loadFacebookLeadAdsPreview(
  deps: FacebookLeadAdsPreviewDeps = {},
): Promise<FacebookLeadAdsPreviewResult> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc) {
    return { state: "unavailable" };
  }

  const fields = decryptJson<StoredFacebookLeadAdsFields>(record.fieldsEnc);
  if (!isConfigured(fields)) {
    return { state: "unavailable" };
  }

  const probeFacebookLeadAds = deps.probeFacebookLeadAds ?? defaultProbeFacebookLeadAds;

  try {
    const preview = await probeFacebookLeadAds({
      accessToken: fields.accessToken,
      pageId: fields.pageId,
    });

    const now = new Date();
    await prisma.integrationCredential.update({
      where: { integrationId: INTEGRATION_ID },
      data: {
        status: "connected",
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
    const message = error instanceof Error ? error.message : "Meta Lead Ads preview failed";
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

function isConfigured(fields: StoredFacebookLeadAdsFields | null): fields is {
  accessToken: string;
  pageId: string;
} {
  return Boolean(
    fields &&
      typeof fields.accessToken === "string" &&
      typeof fields.pageId === "string",
  );
}
