// EP-ASYNC-COWORKER-001: Cancel a running agent task.
// Sets an in-memory flag checked by the agentic loop at each iteration boundary,
// and cancels the turn's open delegated children (BI-97EE6DE9).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { ok } from "@/lib/shared/action-result";
import { stopThreadTurn } from "@/lib/tak/thread-cancellation";

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

  // BI-97EE6DE9: Stop also stops the work this turn delegated; the thread stays usable.
  const { cancelledThreadIds } = await stopThreadTurn(body.threadId, session.user.id);
  return NextResponse.json({ ...ok(), cancelledThreadIds });
}
