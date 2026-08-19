import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import { probeWhatsAppBusiness, WhatsAppBusinessApiError } from "./client";
import type { Dispatcher } from "undici";

export const WhatsAppBusinessConnectInputSchema = z.object({
  accessToken: z.string().trim().min(1, "access token required").max(4096),
  wabaId: z.string().trim().min(1, "WABA ID required").max(256),
  phoneNumberId: z.string().trim().min(1, "phone number ID required").max(256),
});

export type WhatsAppBusinessConnectInput = z.infer<
  typeof WhatsAppBusinessConnectInputSchema
>;

export type WhatsAppBusinessConnectResult =
  | {
      ok: true;
      status: "connected";
      wabaId: string;
      phoneNumberId: string;
      displayPhoneNumber: string | null;
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

const INTEGRATION_ID = "whatsapp-business";
const PROVIDER = "facebook";

export async function connectWhatsAppBusiness(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<WhatsAppBusinessConnectResult> {
  const parseResult = WhatsAppBusinessConnectInputSchema.safeParse(rawInput);
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
    const probe = await probeWhatsAppBusiness({
      accessToken: input.accessToken,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
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
          wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId,
          displayPhoneNumber: probe.phoneNumber.displayPhoneNumber,
          verifiedName: probe.phoneNumber.verifiedName,
        }),
        tokenCacheEnc: null,
        lastTestedAt: now,
      },
      update: {
        status: "connected",
        fieldsEnc: encryptJson({
          accessToken: input.accessToken,
          wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId,
          displayPhoneNumber: probe.phoneNumber.displayPhoneNumber,
          verifiedName: probe.phoneNumber.verifiedName,
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
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhoneNumber: probe.phoneNumber.displayPhoneNumber,
      lastTestedAt: now.toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof WhatsAppBusinessApiError || error instanceof Error
        ? error.message
        : "unexpected error during WhatsApp Business connect";

    await prisma.integrationCredential.upsert({
      where: { integrationId: INTEGRATION_ID },
      create: {
        integrationId: INTEGRATION_ID,
        provider: PROVIDER,
        status: "error",
        fieldsEnc: encryptJson({
          accessToken: input.accessToken,
          wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId,
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
