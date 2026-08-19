import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import {
  probeFacebookPages as defaultProbeFacebookPages,
  type FacebookPagesProbeResult,
} from "./client";

const INTEGRATION_ID = "facebook-pages";

interface StoredFacebookPagesFields {
  accessToken?: string;
  pageId?: string;
  pageName?: string;
  pageCategory?: string;
  pageLink?: string;
  fanCount?: number;
}

interface FacebookPagesPreviewDeps {
  probeFacebookPages?: (args: {
    accessToken: string;
    pageId: string;
  }) => Promise<FacebookPagesProbeResult>;
}

export type FacebookPagesPreviewResult =
  | {
    state: "available";
    preview: FacebookPagesProbeResult & { loadedAt: string };
  }
  | { state: "unavailable" }
  | { state: "error"; error: string };

export async function loadFacebookPagesPreview(
  deps: FacebookPagesPreviewDeps = {},
): Promise<FacebookPagesPreviewResult> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc) {
    return { state: "unavailable" };
  }

  const fields = decryptJson<StoredFacebookPagesFields>(record.fieldsEnc);
  if (!isConfigured(fields)) {
    return { state: "unavailable" };
  }

  const probeFacebookPages = deps.probeFacebookPages ?? defaultProbeFacebookPages;

  try {
    const preview = await probeFacebookPages({
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
    const message = error instanceof Error ? error.message : "Meta pages preview failed";
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

function isConfigured(fields: StoredFacebookPagesFields | null): fields is {
  accessToken: string;
  pageId: string;
} {
  return Boolean(
    fields &&
      typeof fields.accessToken === "string" &&
      typeof fields.pageId === "string",
  );
}
