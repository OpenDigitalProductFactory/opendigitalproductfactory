import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import { MailchimpApiError, probeMailchimpAccount } from "./client";
import type { Dispatcher } from "undici";

export const MailchimpConnectInputSchema = z.object({
  apiKey: z.string().trim().min(1, "api key required").max(4096),
  serverPrefix: z
    .string()
    .trim()
    .min(1, "server prefix required")
    .max(32)
    .regex(/^[a-z0-9]+$/i, "server prefix must be alphanumeric"),
});

export type MailchimpConnectInput = z.infer<typeof MailchimpConnectInputSchema>;

export type MailchimpConnectResult =
  | {
    ok: true;
    status: "connected";
    serverPrefix: string;
    accountName: string | null;
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

const INTEGRATION_ID = "mailchimp-marketing";
const PROVIDER = "mailchimp";

export async function connectMailchimp(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<MailchimpConnectResult> {
  const parseResult = MailchimpConnectInputSchema.safeParse(rawInput);
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
    const probe = await probeMailchimpAccount({
      apiKey: input.apiKey,
      serverPrefix: input.serverPrefix,
      dispatcher: deps.dispatcher,
    });

    const now = new Date();
    const accountName =
      typeof probe.account.accountName === "string" ? probe.account.accountName : null;

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "connected",
        fieldsEnc: encryptJson({
          apiKey: input.apiKey,
          serverPrefix: input.serverPrefix,
          accountName,
          loginName:
            typeof probe.account.loginName === "string" ? probe.account.loginName : null,
          email: typeof probe.account.email === "string" ? probe.account.email : null,
        }),
        tokenCacheEnc: null,
        lastTestedAt: now,
      },
      update: {
        status: "connected",
        fieldsEnc: encryptJson({
          apiKey: input.apiKey,
          serverPrefix: input.serverPrefix,
          accountName,
          loginName:
            typeof probe.account.loginName === "string" ? probe.account.loginName : null,
          email: typeof probe.account.email === "string" ? probe.account.email : null,
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
      serverPrefix: input.serverPrefix,
      accountName,
      lastTestedAt: now.toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof MailchimpApiError || error instanceof Error
        ? error.message
        : "unexpected error during Mailchimp connect";

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "error",
        fieldsEnc: encryptJson({
          apiKey: input.apiKey,
          serverPrefix: input.serverPrefix,
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
