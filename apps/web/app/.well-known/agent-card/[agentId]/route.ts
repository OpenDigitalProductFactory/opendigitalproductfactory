// GET /.well-known/agent-card/{agentId}
//
// Per-coworker A2A Agent Card (BI-40648BBF). Read-only projection of one
// opted-in coworker. Returns 404 when the coworker does not exist or is not
// opted in for export (deny-by-default; see lib/a2a/agent-card.ts).

import { NextResponse } from "next/server";
import { getCoworkerAgentCard } from "@/lib/a2a/agent-card";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    const card = await getCoworkerAgentCard(agentId);
    if (!card) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "No exportable agent card for this id" },
        { status: 404 },
      );
    }
    return NextResponse.json(card, {
      status: 200,
      headers: { "cache-control": "public, max-age=300" },
    });
  } catch {
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
