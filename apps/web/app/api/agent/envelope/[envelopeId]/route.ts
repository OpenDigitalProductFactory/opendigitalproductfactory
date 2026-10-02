// GET /api/agent/envelope/:envelopeId — the delegating user's recorded outcome
// for one approval request (BI-F4EB23C1).
//
// The approval card reads this when its decision POST does not answer in time,
// so it can tell "nothing was saved" from "saved, and here is what happened"
// without sending the decision again. Same owner predicate and projection as
// the Inbox result (loadApprovalOutcomes); it never exposes arguments or raw
// errors, and it changes nothing.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { loadApprovalOutcomes } from "@/lib/coworker/approval-outcome-store";

type RouteContext = { params: Promise<{ envelopeId: string }> };

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { envelopeId } = await context.params;
  if (!envelopeId) return NextResponse.json({ error: "envelopeId required" }, { status: 400 });
  const [outcome] = await loadApprovalOutcomes(session.user.id, envelopeId);
  if (!outcome) return NextResponse.json({ error: "Approval request not found." }, { status: 404 });
  return NextResponse.json({ outcome }, { headers: { "cache-control": "no-store" } });
}
