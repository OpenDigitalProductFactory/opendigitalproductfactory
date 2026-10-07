// Accept a coworker send by persisting the user's message BEFORE the send is
// acknowledged (BI-DEFA25EE). /api/agent/send replies at once and runs the turn
// in the background; if the row were written inside that background run, a 200
// would tell the panel "sent" while nothing was stored, and a refresh in that
// window lost the message. Split from the agent-coworker action module
// (module-size ratchet) and deliberately not a server action.

import { prisma } from "@dpf/db";
import { validateMessageInput } from "@/lib/agent-coworker-types";

export type AcceptUserMessageResult =
  | { ok: true; userMessageId: string }
  | { ok: false; status: 400 | 404 | 500; error: string };

export async function acceptUserMessage(input: {
  userId: string;
  threadId: string;
  content: string;
  routeContext: string;
  attachmentId?: string;
}): Promise<AcceptUserMessageResult> {
  const validationError = validateMessageInput(input);
  if (validationError) return { ok: false, status: 400, error: validationError };

  try {
    const thread = await prisma.agentThread.findUnique({
      where: { id: input.threadId },
      select: { userId: true },
    });
    // Not found and not yours answer the same, so thread ids cannot be probed.
    if (!thread || thread.userId !== input.userId) {
      return { ok: false, status: 404, error: "Conversation not found" };
    }

    const row = await prisma.agentMessage.create({
      data: {
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
    return { ok: true, userMessageId: row.id };
  } catch (err) {
    console.error(
      "[accept-user-message] could not persist the user message: %s",
      JSON.stringify(err instanceof Error ? err.message : String(err)),
    );
    return { ok: false, status: 500, error: "Your message could not be saved. Try again." };
  }
}
