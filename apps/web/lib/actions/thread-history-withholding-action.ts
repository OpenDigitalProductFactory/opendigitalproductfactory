"use server";
// BI-706530B2 — set a thread's dispatch boundary.
//
// The owner is saying "carry on here, but stop sending the earlier part". It is
// a narrowing of egress and nothing else: no message is deleted, nothing is
// hidden from the owner's own view, and no sensitivity decision is overridden.
// The screen then re-scores whatever is actually dispatched, exactly as before.
//
// Because it can only ever shrink the payload, it needs no governance approval
// beyond owning the thread — the direction is always toward less data leaving
// the box. Reversing it would not be, which is why there is no un-withhold here.

import { prisma } from "@dpf/db";
import { requireUser } from "./shared/guards";

export async function withholdEarlierThreadHistory(input: {
  threadId: string;
}): Promise<{ ok: boolean; boundary: string | null }> {
  const user = await requireUser();

  const thread = await prisma.agentThread.findFirst({
    where: { id: input.threadId, userId: user.id },
    select: { id: true },
  });
  if (!thread) return { ok: false, boundary: null };

  // The boundary is the newest message at the moment the owner asks, so the
  // exchange they are in the middle of is preserved and everything before it
  // stops being dispatched. Falling back to now() keeps an empty thread sane.
  const newest = await prisma.agentMessage.findFirst({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const boundary = newest?.createdAt ?? new Date();

  await prisma.agentThread.update({
    where: { id: thread.id },
    data: { historyWithheldBefore: boundary },
  });

  return { ok: true, boundary: boundary.toISOString() };
}
