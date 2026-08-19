import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import {
  probeHubSpotPortal as defaultProbeHubSpotPortal,
  type HubSpotProbeResult,
} from "./client";

const INTEGRATION_ID = "hubspot-marketing-crm";

type HubSpotPreview =
  | { state: "unavailable" }
  | {
    state: "available";
    preview: HubSpotProbeResult & { loadedAt: string };
  }
  | {
    state: "error";
    error: string;
  };

interface HubSpotPreviewDeps {
  probeHubSpotPortal?: typeof defaultProbeHubSpotPortal;
}

export async function loadHubSpotPreview(
  deps: HubSpotPreviewDeps = {},
): Promise<HubSpotPreview> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc) {
    return { state: "unavailable" };
  }

  const decoded = decryptJson<{ accessToken?: string }>(record.fieldsEnc);
  if (typeof decoded?.accessToken !== "string" || decoded.accessToken.length === 0) {
    return { state: "unavailable" };
  }

  const probeHubSpotPortal = deps.probeHubSpotPortal ?? defaultProbeHubSpotPortal;

  try {
    const preview = await probeHubSpotPortal({
      accessToken: decoded.accessToken,
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
    const message = error instanceof Error ? error.message : "HubSpot preview failed";
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
