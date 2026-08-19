import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import {
  probeMailchimpAccount as defaultProbeMailchimpAccount,
  type MailchimpProbeResult,
} from "./client";

const INTEGRATION_ID = "mailchimp-marketing";

type MailchimpPreview =
  | { state: "unavailable" }
  | {
    state: "available";
    preview: MailchimpProbeResult & { loadedAt: string };
  }
  | {
    state: "error";
    error: string;
  };

interface MailchimpPreviewDeps {
  probeMailchimpAccount?: typeof defaultProbeMailchimpAccount;
}

export async function loadMailchimpPreview(
  deps: MailchimpPreviewDeps = {},
): Promise<MailchimpPreview> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc) {
    return { state: "unavailable" };
  }

  const decoded = decryptJson<{ apiKey?: string; serverPrefix?: string }>(record.fieldsEnc);
  if (
    typeof decoded?.apiKey !== "string" ||
    decoded.apiKey.length === 0 ||
    typeof decoded.serverPrefix !== "string" ||
    decoded.serverPrefix.length === 0
  ) {
    return { state: "unavailable" };
  }

  const probeMailchimpAccount = deps.probeMailchimpAccount ?? defaultProbeMailchimpAccount;

  try {
    const preview = await probeMailchimpAccount({
      apiKey: decoded.apiKey,
      serverPrefix: decoded.serverPrefix,
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
    const message = error instanceof Error ? error.message : "Mailchimp preview failed";
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
