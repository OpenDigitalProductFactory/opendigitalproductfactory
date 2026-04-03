// EP-ASYNC-COWORKER-001: Cancel a running agent task.
// Sets an in-memory flag checked by the agentic loop at each iteration boundary.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { agentEventBus } from "@/lib/agent-event-bus";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { threadId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.threadId) {
    return NextResponse.json({ error: "threadId required" }, { status: 400 });
  }

  // Verify thread ownership
  const thread = await prisma.agentThread.findUnique({
    where: { id: body.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  agentEventBus.requestCancel(body.threadId);
  return NextResponse.json({ ok: true });
}
