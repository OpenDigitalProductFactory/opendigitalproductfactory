import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import {
  probeInstagramBusiness as defaultProbeInstagramBusiness,
  type InstagramBusinessProbeResult,
} from "./client";

const INTEGRATION_ID = "instagram-business";

interface StoredInstagramBusinessFields {
  accessToken?: string;
  instagramBusinessAccountId?: string;
  username?: string;
  name?: string;
}

interface InstagramBusinessPreviewDeps {
  probeInstagramBusiness?: (args: {
    accessToken: string;
    instagramBusinessAccountId: string;
  }) => Promise<InstagramBusinessProbeResult>;
}

export type InstagramBusinessPreviewResult =
  | {
      state: "available";
      preview: InstagramBusinessProbeResult & { loadedAt: string };
    }
  | { state: "unavailable" }
  | { state: "error"; error: string };

export async function loadInstagramBusinessPreview(
  deps: InstagramBusinessPreviewDeps = {},
): Promise<InstagramBusinessPreviewResult> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc) return { state: "unavailable" };

  const fields = decryptJson<StoredInstagramBusinessFields>(record.fieldsEnc);
  if (!isConfigured(fields)) return { state: "unavailable" };

  const probeInstagramBusiness = deps.probeInstagramBusiness ?? defaultProbeInstagramBusiness;

  try {
    const preview = await probeInstagramBusiness({
      accessToken: fields.accessToken,
      instagramBusinessAccountId: fields.instagramBusinessAccountId,
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
    const message =
      error instanceof Error ? error.message : "Instagram Business preview failed";
    const now = new Date();
    await prisma.integrationCredential.update({
      where: { integrationId: INTEGRATION_ID },
      data: {
        status: "error",
        lastErrorAt: now,
        lastErrorMsg: message,
      },
    });

    return { state: "error", error: message };
  }
}

function isConfigured(fields: StoredInstagramBusinessFields | null): fields is {
  accessToken: string;
  instagramBusinessAccountId: string;
} {
  return Boolean(
    fields &&
      typeof fields.accessToken === "string" &&
      typeof fields.instagramBusinessAccountId === "string",
  );
}
