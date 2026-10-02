// BI-F9EE05E5 slice C: Keep waiting / Force now / Abort for an upgrade that is
// waiting for in-flight work. The only mutation the proxy lets through during
// a drain (lib/proxy/quiescence-gate.ts); every other one stays refused.
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/actions/shared/guards";
import { apiErrorResponse } from "@/lib/api/error";
import { applyQuiescenceControl, parseQuiescenceControlRequest } from "@/lib/self-upgrade/drain-control";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = (await requireCapability("view_operations")).userId;
  } catch {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }
  const parsed = parseQuiescenceControlRequest(await request.json().catch(() => null));
  if (!parsed.ok) return apiErrorResponse("BAD_REQUEST", parsed.error, 400);
  try {
    const result = await applyQuiescenceControl(parsed.data.runId, parsed.data.action, userId);
    if (!result.ok) return apiErrorResponse("CONFLICT", result.error, 409);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiErrorResponse("TEMPORARILY_UNAVAILABLE", "The upgrade control could not be applied. Try again.", 503);
  }
}
