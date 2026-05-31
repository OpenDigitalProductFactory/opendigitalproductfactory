// Pseudo-User Contract (spec §6.4) — user-side envelope denial route.
//
// POST /api/agent/envelope/:envelopeId/deny
//
// Records the user's refusal of a coworker-proposed destructive action.
// Terminal — the envelope cannot be reopened; if the user wants the
// same action they re-prompt the coworker and a fresh envelope is
// created (auditable as a separate proposal).
//
// BI-0F9C291C / EP-COWORKER-INTERACTIVITY.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { denyEnvelope } from "@/lib/coworker/envelope-actions";

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

  const result = await denyEnvelope(envelopeId, session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.httpStatus });
  }

  return NextResponse.json({ ok: true, envelope: result.envelope });
}
