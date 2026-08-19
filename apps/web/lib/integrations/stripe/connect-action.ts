import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import { probeStripeAccount, StripeApiError, type StripeProbeResult } from "./client";
import type { Dispatcher } from "undici";

const INTEGRATION_ID = "stripe-billing-payments";
const PROVIDER = "stripe";

export const StripeConnectInputSchema = z.object({
  secretKey: z
    .string()
    .trim()
    .min(1, "secret key required")
    .regex(/^(sk|rk)_(test|live)_/, "Stripe secret or restricted key required"),
});

export type StripeConnectInput = z.infer<typeof StripeConnectInputSchema>;

export type StripeConnectResult =
  | {
    ok: true;
    status: "connected";
    mode: "test" | "live";
    lastTestedAt: string;
  }
  | {
    ok: false;
    status: "error";
    error: string;
    statusCode: number;
  };

interface ConnectStripeDeps {
  dispatcher?: Dispatcher;
}

export async function connectStripe(
  rawInput: unknown,
  deps: ConnectStripeDeps = {},
): Promise<StripeConnectResult> {
  const parseResult = StripeConnectInputSchema.safeParse(rawInput);
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
    const probe = await probeStripeAccount({
      secretKey: input.secretKey,
      dispatcher: deps.dispatcher,
    });

    const now = new Date();
    const mode = inferStripeMode(input.secretKey, probe);

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "connected",
        fieldsEnc: encryptJson({
          secretKey: input.secretKey,
          mode,
        }),
        tokenCacheEnc: null,
        lastTestedAt: now,
      },
      update: {
        status: "connected",
        fieldsEnc: encryptJson({
          secretKey: input.secretKey,
          mode,
        }),
        tokenCacheEnc: null,
        lastTestedAt: now,
        lastErrorAt: null,
        lastErrorMsg: null,
      },
    });

    return {
      ok: true,
      status: "connected",
      mode,
      lastTestedAt: now.toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof StripeApiError || error instanceof Error
        ? error.message
        : "unexpected error during Stripe connect";

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "error",
        fieldsEnc: encryptJson({
          secretKey: input.secretKey,
          mode: inferStripeMode(input.secretKey),
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

function inferStripeMode(
  secretKey: string,
  probe?: StripeProbeResult,
): "test" | "live" {
  if (typeof probe?.balance?.livemode === "boolean") {
    return probe.balance.livemode ? "live" : "test";
  }
  return secretKey.includes("_live_") ? "live" : "test";
}
