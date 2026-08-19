import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { apiErrorResponse } from "@/lib/api/error";
import { handleGreenhouseWebhook } from "@/lib/integrations/greenhouse/greenhouse-webhook";
import { readGreenhouseWebhookSecret } from "@/lib/integrations/greenhouse/import-greenhouse";
import type { HireLandingClient } from "@/lib/integrations/greenhouse/land-hire";

// Greenhouse inbound webhook. The raw body is read exactly once and the HMAC
// signature is verified before parsing; `hire_candidate` lands an onboarding
// EmployeeProfile idempotently (BI-7FBE28A6 / BI-02F1F944).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();

  const secret = await readGreenhouseWebhookSecret();
  if (!secret) {
    return apiErrorResponse("WEBHOOK_SECRET_MISSING", "webhook secret is not configured", 503);
  }

  const result = await handleGreenhouseWebhook({
    rawBody,
    signatureHeader: req.headers.get("signature"),
    secret,
    db: prisma as unknown as HireLandingClient,
  });

  if (result.status >= 400) {
    const code = typeof result.body.error === "string" ? result.body.error : "webhook_error";
    return apiErrorResponse(code.toUpperCase(), code.replaceAll("_", " "), result.status);
  }

  return NextResponse.json(result.body, { status: result.status });
}
