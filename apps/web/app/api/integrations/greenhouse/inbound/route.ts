import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { handleGreenhouseWebhook } from "@/lib/integrate/greenhouse/greenhouse-webhook";
import { readGreenhouseWebhookSecret } from "@/lib/integrate/greenhouse/import-greenhouse";
import type { HireLandingClient } from "@/lib/integrate/greenhouse/land-hire";

// Greenhouse inbound webhook. The raw body is read exactly once and the HMAC
// signature is verified before parsing; `hire_candidate` lands an onboarding
// EmployeeProfile idempotently (BI-7FBE28A6 / BI-02F1F944).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();

  const secret = await readGreenhouseWebhookSecret();
  if (!secret) {
    return NextResponse.json({ error: "webhook_secret_missing" }, { status: 503 });
  }

  const result = await handleGreenhouseWebhook({
    rawBody,
    signatureHeader: req.headers.get("signature"),
    secret,
    db: prisma as unknown as HireLandingClient,
  });

  return NextResponse.json(result.body, { status: result.status });
}
