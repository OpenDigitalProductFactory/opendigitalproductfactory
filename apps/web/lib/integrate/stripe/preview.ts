import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import {
  probeStripeAccount,
  type StripeProbeResult,
} from "./client";

const INTEGRATION_ID = "stripe-billing-payments";

interface StoredStripeFields {
  secretKey?: string;
  mode?: "test" | "live";
}

interface StripePreviewDeps {
  probeStripeAccount?: (args: { secretKey: string }) => Promise<StripeProbeResult>;
}

export type StripePreviewResult =
  | {
    state: "available";
    preview: StripeProbeResult & {
      loadedAt: string;
    };
  }
  | { state: "unavailable" }
  | { state: "error"; error: string };

export async function loadStripePreview(
  deps: StripePreviewDeps = {},
): Promise<StripePreviewResult> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc) {
    return { state: "unavailable" };
  }

  const fields = decryptJson<StoredStripeFields>(record.fieldsEnc);
  if (!fields?.secretKey) {
    return { state: "unavailable" };
  }

  const probe = deps.probeStripeAccount ?? probeStripeAccount;

  try {
    const probeResult = await probe({ secretKey: fields.secretKey });
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
        ...probeResult,
        loadedAt: now.toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe preview failed";
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
