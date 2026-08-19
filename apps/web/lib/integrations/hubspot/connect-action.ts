import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import { HubSpotApiError, probeHubSpotPortal } from "./client";
import type { Dispatcher } from "undici";

export const HubSpotConnectInputSchema = z.object({
  accessToken: z.string().trim().min(1, "access token required").max(4096),
});

export type HubSpotConnectInput = z.infer<typeof HubSpotConnectInputSchema>;

export type HubSpotConnectResult =
  | {
    ok: true;
    status: "connected";
    portalId: number | null;
    accountType: string | null;
    lastTestedAt: string;
  }
  | {
    ok: false;
    status: "error";
    error: string;
    statusCode: number;
  };

interface ConnectActionDeps {
  dispatcher?: Dispatcher;
}

const INTEGRATION_ID = "hubspot-marketing-crm";
const PROVIDER = "hubspot";

export async function connectHubSpot(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<HubSpotConnectResult> {
  const parseResult = HubSpotConnectInputSchema.safeParse(rawInput);
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
    const probe = await probeHubSpotPortal({
      accessToken: input.accessToken,
      dispatcher: deps.dispatcher,
    });

    const now = new Date();
    const portalId = typeof probe.account.portalId === "number" ? probe.account.portalId : null;
    const accountType =
      typeof probe.account.accountType === "string" ? probe.account.accountType : null;

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "connected",
        fieldsEnc: encryptJson({
          accessToken: input.accessToken,
          portalId,
          accountType,
          companyCurrency:
            typeof probe.account.companyCurrency === "string"
              ? probe.account.companyCurrency
              : null,
          timeZone:
            typeof probe.account.timeZone === "string" ? probe.account.timeZone : null,
          uiDomain:
            typeof probe.account.uiDomain === "string" ? probe.account.uiDomain : null,
        }),
        tokenCacheEnc: null,
        lastTestedAt: now,
      },
      update: {
        status: "connected",
        fieldsEnc: encryptJson({
          accessToken: input.accessToken,
          portalId,
          accountType,
          companyCurrency:
            typeof probe.account.companyCurrency === "string"
              ? probe.account.companyCurrency
              : null,
          timeZone:
            typeof probe.account.timeZone === "string" ? probe.account.timeZone : null,
          uiDomain:
            typeof probe.account.uiDomain === "string" ? probe.account.uiDomain : null,
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
      portalId,
      accountType,
      lastTestedAt: now.toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof HubSpotApiError || error instanceof Error
        ? error.message
        : "unexpected error during HubSpot connect";

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "error",
        fieldsEnc: encryptJson({
          accessToken: input.accessToken,
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
