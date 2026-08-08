// GET /.well-known/agent-card.json
//
// A2A Agent Card discovery endpoint (BI-40648BBF). Read-only projection of the
// platform's opted-in coworkers as one A2A agent card. NO inbound task
// execution. Deny-by-default: coworkers export only when an operator sets
// Agent.sensitivity = "public" (see lib/a2a/agent-card.ts).

import { NextResponse } from "next/server";
import { getPlatformAgentCard } from "@/lib/a2a/agent-card";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const card = await getPlatformAgentCard();
    if (!card) {
      return NextResponse.json(
        { code: "NOT_CONFIGURED", message: "No organization configured" },
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
