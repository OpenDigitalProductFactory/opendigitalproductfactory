// EP-ASYNC-COWORKER-001: Non-blocking message submission endpoint.
// Accepts the message, returns immediately, runs agent execution in background.
// The SSE stream (/api/agent/stream) delivers progress + enriched "done" event.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { AgentFormAssistContext } from "@/lib/agent-form-assist";
import type { QuestionPacket } from "@/lib/tak/question-packet";
import { resolveAgentForRoute } from "@/lib/agent-routing";
import { acceptUserMessage } from "@/lib/agent/accept-user-message";
import { admitForegroundWork } from "@/lib/agent/foreground-work-admission";
import { jobs } from "@/lib/jobs";
import { FOREGROUND_WORK_EVENT, foregroundReceiptId } from "@/lib/agent/foreground-work-contract";
import { prisma } from "@dpf/db";
import { ApiError } from "@/lib/api/error";
// Note: this route uses the sync version since it only needs agentId for message logging

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const startedAt = performance.now();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: {
    threadId: string;
    content: string;
    routeContext: string;
    coworkerMode?: "advise" | "act";
    formAssistContext?: AgentFormAssistContext;
    buildId?: string;
    attachmentId?: string;
    questionPacket?: QuestionPacket | null;
    requestKey?: string;
  };

  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!input.threadId || !input.content || !input.routeContext) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  // EP-WORK-POSTURE 8.2 (BI-947780FE): hands-on and web access are resolved
  // server-side from the Workroom; a body that still carries the retired
  // per-conversation flags is stripped so a crafted POST cannot widen a turn.
  delete (input as Record<string, unknown>).externalAccessEnabled;
  delete (input as Record<string, unknown>).elevatedFormFillEnabled;

  // BI-DEFA25EE: the panel shows the message as "sent" on a 200, so the user
  // row is written before we answer. A refresh after this point cannot lose it.
  let userMessageId: string;
  try {
    userMessageId = await acceptUserMessage({
      userId: session.user.id,
      threadId: input.threadId,
      content: input.content,
      routeContext: input.routeContext,
      attachmentId: input.attachmentId,
      requestKey: input.requestKey,
    });
  } catch (err) {
    if (err instanceof ApiError) return err.toResponse();
    throw err;
  }

  let taskRunId: string;
  try {
    const agent = resolveAgentForRoute(input.routeContext, {
      userId: session.user.id,
      platformRole: session.user.platformRole ?? null,
      isSuperuser: session.user.isSuperuser ?? false,
    });
    taskRunId = await admitForegroundWork({
      userId: session.user.id,
      agentId: agent.agentId,
      userMessageId,
      threadId: input.threadId,
      routeContext: input.routeContext,
      content: input.content.trim(),
      coworkerMode: input.coworkerMode,
      requestExtras: { formAssistContext: input.formAssistContext, buildId: input.buildId, attachmentId: input.attachmentId, questionPacket: input.questionPacket },
    });
  } catch {
    return NextResponse.json({ error: "Your message is saved, but its coworker job could not be admitted. Nothing has started.", userMessageId }, { status: 503 });
  }

  // Return immediately — agent execution runs in background
  // BI-BD0B0DCC: the server's share of the message-ack journey (W3C Server-Timing).
  const receipt = await prisma.agentMessage.findUnique({ where: { id: foregroundReceiptId(taskRunId) },
    select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
  }).catch(() => null);
  const response = NextResponse.json(
    { status: "processing", userMessageId, taskRunId, ...(receipt ? { receipt } : {}) },
    { headers: { "Server-Timing": `app;dur=${(performance.now() - startedAt).toFixed(1)}` } },
  );

  // The saved TaskRun is authoritative. A lost wake is repaired by the
  // existing task-dispatch reconciliation, independently of this HTTP request.
  try {
    await jobs.send({ name: FOREGROUND_WORK_EVENT, data: { taskRunId } });
  } catch {
    console.warn("[api/agent/send] foreground wake delayed; retained request awaits reconciliation");
  }

  return response;
}
