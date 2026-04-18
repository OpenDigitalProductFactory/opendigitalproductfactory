"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { executeTool } from "@/lib/mcp-tools";

export type RequestExtractionInput = {
  url?: string;
  includeCodebase: boolean;
};

export type RequestExtractionResult =
  | { success: true; taskRunId: string; status: "queued" | "already-in-progress"; threadId: string }
  | { success: false; error: string };

/**
 * Initiate a brand extraction from the /admin/branding UI. Routes the
 * request through the admin-assistant thread so the coworker panel
 * picks up progress naturally (agent-as-conduit pattern).
 *
 * Flow:
 * 1. Resolve the current user.
 * 2. Find or create the admin-assistant thread for the user
 *    (contextKey "coworker" — matches how agent-routing assigns threads
 *    to /admin).
 * 3. Record a user-role AgentMessage summarizing the request so the
 *    conversation has a handle to the task.
 * 4. Invoke the extract_brand_design_system tool via executeTool (same
 *    entry point the coworker LLM would use); the tool creates the
 *    TaskRun + fires the Inngest event.
 * 5. Return taskRunId + threadId so the UI can subscribe to SSE.
 */
export async function requestBrandExtraction(
  input: RequestExtractionInput,
): Promise<RequestExtractionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated." };
  }
  const userId = session.user.id;

  // Resolve or create the admin-assistant thread for this user.
  const thread = await prisma.agentThread.upsert({
    where: { userId_contextKey: { userId, contextKey: "coworker" } },
    update: { updatedAt: new Date() },
    create: { userId, contextKey: "coworker" },
  });

  const sourceSummary = [
    input.url ? `URL: ${input.url}` : null,
    input.includeCodebase ? "connected codebase" : null,
  ].filter(Boolean).join(", ");

  try {
    await prisma.agentMessage.create({
      data: {
        threadId: thread.id,
        role: "user",
        content: `Extract our brand design system from ${sourceSummary}.`,
      },
    });
  } catch {
    // Non-fatal — the tool call below is the authoritative trigger.
  }

  const toolResult = await executeTool(
    "extract_brand_design_system",
    {
      url: input.url,
      includeCodebase: input.includeCodebase,
    },
    userId,
    { threadId: thread.id, routeContext: "/admin/branding", agentId: "admin-assistant" },
  );

  if (!toolResult.success) {
    return {
      success: false,
      error: toolResult.error ?? toolResult.message ?? "Extraction failed to queue.",
    };
  }

  const data = toolResult.data as { taskRunId?: string; status?: string } | undefined;
  if (!data?.taskRunId || (data.status !== "queued" && data.status !== "already-in-progress")) {
    return { success: false, error: "Extraction tool returned no taskRunId." };
  }

  return {
    success: true,
    taskRunId: data.taskRunId,
    status: data.status,
    threadId: thread.id,
  };
}
