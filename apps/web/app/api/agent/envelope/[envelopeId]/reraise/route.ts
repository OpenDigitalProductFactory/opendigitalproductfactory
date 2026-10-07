// POST /api/agent/envelope/:envelopeId/reraise
//
// "Ask again" for an approval request that expired before anyone answered it
// (BI-0012E6CA). Delegate-only; mints a fresh proposed request for the same
// exact call and authorizes nothing by itself — see lib/coworker/envelope-reraise.

import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/error";
import { auth } from "@/lib/auth";
import { reraiseEnvelope } from "@/lib/coworker/envelope-reraise";

type RouteContext = {
  params: Promise<{ envelopeId: string }>;
};

export const dynamic = "force-dynamic";

const REFUSAL_CODE: Record<number, string> = { 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT" };

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  const { envelopeId } = await context.params;
  if (!envelopeId || typeof envelopeId !== "string") {
    return apiErrorResponse("BAD_REQUEST", "envelopeId required", 400);
  }

  const result = await reraiseEnvelope(envelopeId, session.user.id);
  if (!result.ok) {
    return apiErrorResponse(REFUSAL_CODE[result.httpStatus] ?? "CONFLICT", result.error, result.httpStatus);
  }

  // Only the new request's identity; the card navigates to it.
  return NextResponse.json({ envelope: { id: result.data.id, status: result.data.status } });
}
