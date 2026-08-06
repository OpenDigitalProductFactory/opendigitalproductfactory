import { z } from "zod";
import { prisma } from "@dpf/db";
import { encryptJson } from "@/lib/govern/credential-crypto";
import { verifyHarvestCredential, type HarvestFetch } from "./harvest-client";

export const GreenhouseConnectInputSchema = z.object({
  apiToken: z.string().trim().min(1, "Harvest API key required").max(1024),
});

export type GreenhouseConnectInput = z.infer<typeof GreenhouseConnectInputSchema>;

export type GreenhouseConnectResult =
  | { ok: true; status: "connected" }
  | { ok: false; status: "error"; error: string; statusCode: number };

interface ConnectActionDeps {
  // Fetch injection for tests — production omits this.
  fetchImpl?: HarvestFetch;
}

export const GREENHOUSE_INTEGRATION_ID = "greenhouse-recruiting";
const PROVIDER = "greenhouse";

export async function connectGreenhouse(
  rawInput: unknown,
  deps: ConnectActionDeps = {},
): Promise<GreenhouseConnectResult> {
  const parseResult = GreenhouseConnectInputSchema.safeParse(rawInput);
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
    const check = await verifyHarvestCredential(input.apiToken, deps.fetchImpl);

    if (!check.ok) {
      const message =
        check.status === 401 || check.status === 403
          ? "invalid Harvest API key — check the key and its permissions in Greenhouse"
          : `Greenhouse Harvest API returned ${check.status}`;

      // Persist the error state so the UI can show it — never store the token or
      // the raw upstream body.
      await prisma.integrationCredential.upsert({
        where: { integrationId: GREENHOUSE_INTEGRATION_ID },
        create: {
          integrationId: GREENHOUSE_INTEGRATION_ID,
          provider: PROVIDER,
          status: "error",
          fieldsEnc: encryptJson({ apiToken: input.apiToken }),
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

    await prisma.integrationCredential.upsert({
      where: { integrationId: GREENHOUSE_INTEGRATION_ID },
      create: {
        integrationId: GREENHOUSE_INTEGRATION_ID,
        provider: PROVIDER,
        status: "connected",
        fieldsEnc: encryptJson({ apiToken: input.apiToken }),
        lastTestedAt: new Date(),
      },
      update: {
        status: "connected",
        fieldsEnc: encryptJson({ apiToken: input.apiToken }),
        lastTestedAt: new Date(),
        lastErrorAt: null,
        lastErrorMsg: null,
      },
    });

    return { ok: true, status: "connected" };
  } catch {
    const message = "unable to reach the Greenhouse Harvest API — try again";
    await prisma.integrationCredential.upsert({
      where: { integrationId: GREENHOUSE_INTEGRATION_ID },
      create: {
        integrationId: GREENHOUSE_INTEGRATION_ID,
        provider: PROVIDER,
        status: "error",
        fieldsEnc: encryptJson({ apiToken: input.apiToken }),
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
