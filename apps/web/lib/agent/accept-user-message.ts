// Accept a coworker send by persisting the user's message BEFORE the send is
// acknowledged (BI-DEFA25EE). /api/agent/send replies at once and runs the turn
// in the background; if the row were written inside that background run, a 200
// would tell the panel "sent" while nothing was stored, and a refresh in that
// window lost the message. Split from the agent-coworker action module
// (module-size ratchet) and deliberately not a server action.

import { prisma } from "@dpf/db";
import { validateMessageInput } from "@/lib/agent-coworker-types";
import { apiError, ApiError } from "@/lib/api/error";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { createHash } from "node:crypto";

/**
 * Returns the persisted user message id. Throws ApiError (400 / 404 / 500)
 * when the message must not be acknowledged; the caller answers with it.
 */
export async function acceptUserMessage(input: {
  userId: string;
  threadId: string;
  content: string;
  routeContext: string;
  attachmentId?: string;
  requestKey?: string;
}): Promise<string> {
  const validationError = validateMessageInput(input);
  if (validationError) throw apiError("VALIDATION_ERROR", validationError, 400);
  if (input.requestKey !== undefined && (typeof input.requestKey !== "string" || !input.requestKey.trim() || input.requestKey.length > 128)) {
    throw apiError("VALIDATION_ERROR", "The message request key is invalid.", 400);
  }
  const requestedId = input.requestKey ? `usr-${createHash("sha256").update(JSON.stringify([input.userId, input.threadId, input.requestKey])).digest("hex")}` : null;
  const retainExisting = async () => {
    if (!requestedId) return null;
    const row = await prisma.agentMessage.findUnique({ where: { id: requestedId },
      select: { id: true, threadId: true, role: true, content: true, routeContext: true } });
    if (!row) return null;
    if (row.threadId !== input.threadId || row.role !== "user" || row.content !== input.content.trim() || row.routeContext !== input.routeContext) {
      throw apiError("REQUEST_CONFLICT", "This message request conflicts with an earlier submission.", 409);
    }
    return row.id;
  };

  try {
    const thread = await prisma.agentThread.findUnique({
      where: { id: input.threadId },
      select: { userId: true },
    });
    // Not found and not yours answer the same, so thread ids cannot be probed.
    if (!thread || thread.userId !== input.userId) {
      throw apiError("NOT_FOUND", "Conversation not found", 404);
    }
    const existingId = await retainExisting();
    if (existingId) return existingId;

    const row = await prisma.agentMessage.create({
      data: {
        ...(requestedId ? { id: requestedId } : {}),
        threadId: input.threadId,
        role: "user",
        content: input.content.trim(),
        routeContext: input.routeContext,
      },
      select: { id: true },
    });
    if (input.attachmentId) {
      await prisma.agentAttachment.update({
        where: { id: input.attachmentId },
        data: { messageId: row.id },
      });
    }
    return row.id;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (requestedId && typeof err === "object" && err && "code" in err && (err.code === "P2002" || err.code === "P2034")) {
      const existingId = await retainExisting();
      if (existingId) return existingId;
    }
    console.error(
      "[accept-user-message] could not persist the user message: %s",
      JSON.stringify(getErrorMessage(err)),
    );
    throw apiError("PERSIST_FAILED", "Your message could not be saved. Try again.", 500);
  }
}
