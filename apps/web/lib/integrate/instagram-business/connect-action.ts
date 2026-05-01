import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import { InstagramBusinessApiError, probeInstagramBusiness } from "./client";
import type { Dispatcher } from "undici";

export const InstagramBusinessConnectInputSchema = z.object({
  accessToken: z.string().trim().min(1, "access token required").max(4096),
  instagramBusinessAccountId: z
    .string()
    .trim()
    .min(1, "Instagram Business account ID required")
    .max(256),
});

export type InstagramBusinessConnectResult =
  | {
      ok: true;
      status: "connected";
      instagramBusinessAccountId: string;
      username: string | null;
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

const INTEGRATION_ID = "instagram-business";
const PROVIDER = "facebook";

export async function connectInstagramBusiness(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<InstagramBusinessConnectResult> {
  const parseResult = InstagramBusinessConnectInputSchema.safeParse(rawInput);
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
    const probe = await probeInstagramBusiness({
      accessToken: input.accessToken,
      instagramBusinessAccountId: input.instagramBusinessAccountId,
      dispatcher: deps.dispatcher,
    });
    const now = new Date();

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "connected",
        fieldsEnc: encryptJson({
          accessToken: input.accessToken,
          instagramBusinessAccountId: input.instagramBusinessAccountId,
          username: probe.profile.username,
          name: probe.profile.name,
        }),
        tokenCacheEnc: null,
        lastTestedAt: now,
      },
      update: {
        status: "connected",
        fieldsEnc: encryptJson({
          accessToken: input.accessToken,
          instagramBusinessAccountId: input.instagramBusinessAccountId,
          username: probe.profile.username,
          name: probe.profile.name,
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
      instagramBusinessAccountId: input.instagramBusinessAccountId,
      username: probe.profile.username,
      lastTestedAt: now.toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof InstagramBusinessApiError || error instanceof Error
        ? error.message
        : "unexpected error during Instagram Business connect";

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "error",
        fieldsEnc: encryptJson({
          accessToken: input.accessToken,
          instagramBusinessAccountId: input.instagramBusinessAccountId,
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
