import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/actions/shared/guards";
import { getLocalModelStatusSnapshot } from "@/lib/inference/local-model-operations";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "no-store, max-age=0";
const INSTANCE = "/api/platform/ai/local-models/status";

export async function GET(): Promise<Response> {
  try {
    await requireCapability("manage_provider_connections");
    const snapshot = await getLocalModelStatusSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "Unauthorized";
    return problemResponse(
      unauthorized ? 401 : 503,
      unauthorized ? "unauthorized" : "local-model-status-unavailable",
      unauthorized ? "Unauthorized" : "Local model status unavailable",
      unauthorized
        ? "Sign in with permission to manage provider connections."
        : "The installed model list cannot be refreshed right now.",
    );
  }
}

function problemResponse(
  status: number,
  slug: string,
  title: string,
  detail: string,
): Response {
  const correlationId = randomUUID();
  return new Response(JSON.stringify({
    type: `https://dpf.local/problems/${slug}`,
    title,
    status,
    detail,
    instance: INSTANCE,
    correlationId,
  }), {
    status,
    headers: {
      "Content-Type": "application/problem+json",
      "Cache-Control": CACHE_CONTROL,
      "X-Correlation-Id": correlationId,
    },
  });
}
