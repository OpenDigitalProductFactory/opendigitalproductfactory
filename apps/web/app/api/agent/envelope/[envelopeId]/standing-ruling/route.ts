// @exposure authenticated
// DELETE /api/agent/envelope/:envelopeId/standing-ruling
//
// BI-E5631708: withdraw the standing ruling an approval carries ("ask me
// again"), plus any other active ruling for the same coworker, tool and owner.
// Only the owner whose authority the ruling lends may withdraw it.

import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/error";
import { auth } from "@/lib/auth";
import { revokeStandingRuling } from "@/lib/coworker/standing-ruling";

type RouteContext = { params: Promise<{ envelopeId: string }> };

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }
  const { envelopeId } = await context.params;
  if (!envelopeId || typeof envelopeId !== "string") {
    return apiErrorResponse("BAD_REQUEST", "envelopeId required", 400);
  }
  const result = await revokeStandingRuling(envelopeId, session.user.id);
  if (result.outcome === "refused") {
    return apiErrorResponse(result.httpStatus === 403 ? "FORBIDDEN" : "NOT_FOUND", result.reason, result.httpStatus);
  }
  return NextResponse.json({ revoked: result.revoked });
}
