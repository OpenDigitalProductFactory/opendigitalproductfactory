import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import { FacebookPagesApiError, probeFacebookPages } from "./client";
import type { Dispatcher } from "undici";

export const FacebookPagesConnectInputSchema = z.object({
  accessToken: z.string().trim().min(1, "access token required").max(4096),
  pageId: z.string().trim().min(1, "page ID required").max(256),
});

export type FacebookPagesConnectInput = z.infer<typeof FacebookPagesConnectInputSchema>;

export type FacebookPagesConnectResult =
  | {
    ok: true;
    status: "connected";
    pageId: string;
    pageName: string | null;
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

const INTEGRATION_ID = "facebook-pages";
const PROVIDER = "facebook";

export async function connectFacebookPages(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<FacebookPagesConnectResult> {
  const parseResult = FacebookPagesConnectInputSchema.safeParse(rawInput);
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
    const probe = await probeFacebookPages({
      accessToken: input.accessToken,
      pageId: input.pageId,
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
          pageId: input.pageId,
          pageName: probe.page.name,
          pageCategory: probe.page.category,
          pageLink: probe.page.link,
          fanCount: probe.page.fanCount,
        }),
        tokenCacheEnc: null,
        lastTestedAt: now,
      },
      update: {
        status: "connected",
        fieldsEnc: encryptJson({
          accessToken: input.accessToken,
          pageId: input.pageId,
          pageName: probe.page.name,
          pageCategory: probe.page.category,
          pageLink: probe.page.link,
          fanCount: probe.page.fanCount,
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
      pageId: input.pageId,
      pageName: probe.page.name,
      lastTestedAt: now.toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof FacebookPagesApiError || error instanceof Error
        ? error.message
        : "unexpected error during Meta pages connect";

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "error",
        fieldsEnc: encryptJson({
          accessToken: input.accessToken,
          pageId: input.pageId,
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
