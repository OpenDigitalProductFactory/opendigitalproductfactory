// @exposure authenticated — session required unconditionally (auth() → 401).
// GET /api/agent/envelope/:envelopeId — the delegating user's recorded outcome
// for one approval request (BI-F4EB23C1).
//
// The approval card reads this when its decision POST does not answer in time,
// so it can tell "nothing was saved" from "saved, and here is what happened"
// without sending the decision again. Same owner predicate and projection as
// the Inbox result (loadApprovalOutcomes); it never exposes arguments or raw
// errors, and it changes nothing.

import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/error";
import { auth } from "@/lib/auth";
import { loadApprovalOutcomes } from "@/lib/coworker/approval-outcome-store";

type RouteContext = { params: Promise<{ envelopeId: string }> };

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return apiErrorResponse("UNAUTHORIZED", "Sign in to read this approval request.", 401);
  const { envelopeId } = await context.params;
  if (!envelopeId) return apiErrorResponse("BAD_REQUEST", "envelopeId required", 400);
  const [outcome] = await loadApprovalOutcomes(session.user.id, envelopeId);
  if (!outcome) return apiErrorResponse("NOT_FOUND", "Approval request not found.", 404);
  return NextResponse.json({ outcome }, { headers: { "cache-control": "no-store" } });
}
