// EP-ASYNC-COWORKER-001: Check if a thread has an active background execution.
// Used by the client to resume the thinking indicator when navigating back to
// a page with a running agent task.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { agentEventBus } from "@/lib/agent-event-bus";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threadId = request.nextUrl.searchParams.get("threadId");
  if (!threadId) {
    return NextResponse.json({ error: "threadId required" }, { status: 400 });
  }

  return NextResponse.json({ active: agentEventBus.isActive(threadId) });
}
