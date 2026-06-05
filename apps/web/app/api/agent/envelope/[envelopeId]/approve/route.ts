// Pseudo-User Contract (spec §6.4) — user-side envelope approval route.
//
// POST /api/agent/envelope/:envelopeId/approve
//
// Records the user's consent for a coworker-proposed destructive action.
// Validates auth, calls approveEnvelope (which enforces the delegating-user
// check and the state-machine invariants from BI-0F9C291C part 1), and
// returns the updated envelope row.
//
// Status flips from `proposed` to `approved`. The actual underlying-tool
// execution happens AFTER approval — kicked off either by the chat
// handler when it sees the envelope flip, or by the agent calling
// screen_dispatch_action (which lives in PR #1386 and will be refactored
// to call markEnvelopeExecuted / markEnvelopeFailed via envelope-actions
// once the chat handler integration lands in BI-DF6079E9 part 2). The
// approval audit row is committed BEFORE that side effect — see the
// design rationale on envelope-actions.ts.
//
// BI-0F9C291C / EP-COWORKER-INTERACTIVITY.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { approveEnvelope } from "@/lib/coworker/envelope-actions";

type RouteContext = {
  params: Promise<{ envelopeId: string }>;
};

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { envelopeId } = await context.params;
  if (!envelopeId || typeof envelopeId !== "string") {
    return NextResponse.json({ error: "envelopeId required" }, { status: 400 });
  }

  const result = await approveEnvelope(envelopeId, session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.httpStatus });
  }

  return NextResponse.json({ ok: true, envelope: result.envelope });
}
