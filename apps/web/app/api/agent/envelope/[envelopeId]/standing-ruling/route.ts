// DELETE /api/agent/envelope/:envelopeId/standing-ruling
//
// BI-E5631708: withdraw the standing ruling an approval carries ("ask me
// again"), plus any other active ruling for the same coworker, tool and owner.
// Only the owner whose authority the ruling lends may withdraw it.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { revokeStandingRuling } from "@/lib/coworker/standing-ruling";

type RouteContext = { params: Promise<{ envelopeId: string }> };

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { envelopeId } = await context.params;
  if (!envelopeId || typeof envelopeId !== "string") {
    return NextResponse.json({ error: "envelopeId required" }, { status: 400 });
  }
  const result = await revokeStandingRuling(envelopeId, session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.httpStatus });
  }
  return NextResponse.json({ ok: true, revoked: result.revoked });
}
