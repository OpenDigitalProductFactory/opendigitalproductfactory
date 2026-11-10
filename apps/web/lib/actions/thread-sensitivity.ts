"use server";
// BI-706530B2 — read the screen receipt behind a thread's current routing so
// the panel can explain a local-only verdict to its owner.
//
// Ownership is enforced the same way the thread snapshot enforces it: the
// thread must belong to the caller. A receipt names data classes and message
// indices for a conversation, which is not something to hand to anyone holding
// a thread id.

import { prisma } from "@dpf/db";
import { requireUser } from "./shared/guards";
import {
  deriveThreadSensitivityNotice,
  type ThreadSensitivityNotice,
} from "@/lib/inference/thread-sensitivity-notice";
import { readThreadSensitivityReceipt } from "@/lib/inference/thread-sensitivity-receipt";

/**
 * Explain why a thread is routing locally, or return null when it is not.
 *
 * Best-effort by design: this is an explanation of a constraint, never the
 * constraint itself, so any failure here degrades to silence rather than
 * blocking the panel.
 */
export async function getThreadSensitivityNotice(input: {
  threadId: string;
}): Promise<ThreadSensitivityNotice | null> {
  const user = await requireUser();

  const thread = await prisma.agentThread.findFirst({
    where: { id: input.threadId, userId: user.id },
    select: { id: true },
  });
  if (!thread) return null;

  const recent = await prisma.agentMessage.findMany({
    where: { threadId: thread.id, role: "assistant" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true },
  });
  if (recent.length === 0) return null;

  const decision = await prisma.routeDecisionLog.findFirst({
    where: { agentMessageId: { in: recent.map((message) => message.id) } },
    orderBy: { createdAt: "desc" },
    select: { inferenceDataScreenReceipt: true },
  });
  if (!decision) return null;

  const receipt = readThreadSensitivityReceipt(decision.inferenceDataScreenReceipt);
  if (!receipt) return null;

  return deriveThreadSensitivityNotice({
    receipt,
    currentTurnStartIndex: receipt.currentTurnStartIndex,
  });
}
