import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import { parseCertExpiry } from "./cert-parse";
import { exchangeToken, AdpAuthError, type AdpEnvironment } from "./token-client";
import type { Dispatcher } from "undici";

export const AdpConnectInputSchema = z.object({
  clientId: z.string().trim().min(1, "client ID required").max(256),
  clientSecret: z.string().trim().min(1, "client secret required").max(1024),
  certPem: z.string().trim().min(1, "certificate PEM required"),
  privateKeyPem: z.string().trim().min(1, "private key PEM required"),
  environment: z.enum(["sandbox", "production"]),
});

export type AdpConnectInput = z.infer<typeof AdpConnectInputSchema>;

export type AdpConnectResult =
  | { ok: true; status: "connected"; certExpiresAt: string }
  | { ok: false; status: "error"; error: string; statusCode: number };

interface ConnectActionDeps {
  // Dispatcher injection for tests — production omits this.
  dispatcher?: Dispatcher;
}

const INTEGRATION_ID = "adp-workforce-now";
const PROVIDER = "adp";

export async function connectAdp(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<AdpConnectResult> {
  const parseResult = AdpConnectInputSchema.safeParse(rawInput);
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

  // Fail-closed cert parse. Do NOT persist if the PEM is unreadable.
  const certExpiresAt = parseCertExpiry(input.certPem);
  if (!certExpiresAt) {
    return {
      ok: false,
      status: "error",
      error: "certificate unreadable — check the PEM you pasted",
      statusCode: 400,
    };
  }

  // Attempt the mTLS token exchange before persisting anything.
  try {
    const token = await exchangeToken({
      environment: input.environment satisfies AdpEnvironment,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      certPem: input.certPem,
      privateKeyPem: input.privateKeyPem,
      dispatcher: deps.dispatcher,
    });

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "connected",
        fieldsEnc: encryptJson({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          certPem: input.certPem,
          privateKeyPem: input.privateKeyPem,
          environment: input.environment,
        }),
        tokenCacheEnc: encryptJson({
          accessToken: token.accessToken,
          expiresAt: token.expiresAt.toISOString(),
        }),
        certExpiresAt,
        lastTestedAt: new Date(),
      },
      update: {
        status: "connected",
        fieldsEnc: encryptJson({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          certPem: input.certPem,
          privateKeyPem: input.privateKeyPem,
          environment: input.environment,
        }),
        tokenCacheEnc: encryptJson({
          accessToken: token.accessToken,
          expiresAt: token.expiresAt.toISOString(),
        }),
        certExpiresAt,
        lastTestedAt: new Date(),
        lastErrorAt: null,
        lastErrorMsg: null,
      },
    });

    return { ok: true, status: "connected", certExpiresAt: certExpiresAt.toISOString() };
  } catch (err) {
    const message =
      err instanceof AdpAuthError
        ? err.message
        : "unexpected error during ADP connect";

    // Persist the error state so the UI can display lastErrorMsg, but never
    // store the raw error or any secret material.
    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "error",
        fieldsEnc: encryptJson({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          certPem: input.certPem,
          privateKeyPem: input.privateKeyPem,
          environment: input.environment,
        }),
        certExpiresAt,
        lastErrorAt: new Date(),
        lastErrorMsg: message,
      },
      update: {
        status: "error",
        lastErrorAt: new Date(),
        lastErrorMsg: message,
      },
    });

    return { ok: false, status: "error", error: message, statusCode: 400 };
  }
}
