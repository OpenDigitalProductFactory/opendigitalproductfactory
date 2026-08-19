import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import {
  probeWhatsAppBusiness as defaultProbeWhatsAppBusiness,
  type WhatsAppBusinessProbeResult,
} from "./client";

const INTEGRATION_ID = "whatsapp-business";

interface StoredWhatsAppBusinessFields {
  accessToken?: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

interface WhatsAppBusinessPreviewDeps {
  probeWhatsAppBusiness?: (args: {
    accessToken: string;
    wabaId: string;
    phoneNumberId: string;
  }) => Promise<WhatsAppBusinessProbeResult>;
}

export type WhatsAppBusinessPreviewResult =
  | {
      state: "available";
      preview: WhatsAppBusinessProbeResult & { loadedAt: string };
    }
  | { state: "unavailable" }
  | { state: "error"; error: string };

export async function loadWhatsAppBusinessPreview(
  deps: WhatsAppBusinessPreviewDeps = {},
): Promise<WhatsAppBusinessPreviewResult> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc) {
    return { state: "unavailable" };
  }

  const fields = decryptJson<StoredWhatsAppBusinessFields>(record.fieldsEnc);
  if (!isConfigured(fields)) {
    return { state: "unavailable" };
  }

  const probeWhatsAppBusiness = deps.probeWhatsAppBusiness ?? defaultProbeWhatsAppBusiness;

  try {
    const preview = await probeWhatsAppBusiness({
      accessToken: fields.accessToken,
      wabaId: fields.wabaId,
      phoneNumberId: fields.phoneNumberId,
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
      error instanceof Error ? error.message : "WhatsApp Business preview failed";
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

function isConfigured(fields: StoredWhatsAppBusinessFields | null): fields is {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
} {
  return Boolean(
    fields &&
      typeof fields.accessToken === "string" &&
      typeof fields.wabaId === "string" &&
      typeof fields.phoneNumberId === "string",
  );
}
