// @exposure authenticated
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseManagedInferenceRequestId } from "@/lib/remote-action/managed-inference-request";
import { readManagedInferenceRequestState } from "@/lib/remote-action/managed-inference-request-state";

// Operator readback remains available when the host action channel is off.
// This handler contains no native effect, queue, grant or approval operation.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = (await auth())?.user;
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!user?.id) return reply({ ok: false, error: "authentication_required" }, 401);
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")) return reply({ ok: false, error: "capability_required" }, 403);
  const query = request.nextUrl.searchParams;
  const id = query.get("requestId");
  if ([...query.keys()].some(key => key !== "requestId") || query.getAll("requestId").length > 1 || (id !== null && !parseManagedInferenceRequestId(id))) {
    return reply({ ok: false, error: "invalid_request_identity" }, 422);
  }
  try {
    const observation = await readManagedInferenceRequestState(id === null ? {} : { requestId: id });
    return reply({ ok: true, observation }, 200);
  } catch { return reply({ ok: false, error: "original_request_observation_unavailable" }, 503); }
}
