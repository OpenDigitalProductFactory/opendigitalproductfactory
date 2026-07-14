"use server";

// BI-B416B12A: heartbeat + read presence for a work item. The client calls
// heartbeatWorkItemPresence on an interval while the case is open, and
// getActiveWorkItemPresence to show who else is here. Returns values (never
// throws to the client). Active-window filtering is the pure filterActivePresence.

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { filterActivePresence, type ActiveViewer } from "./work-item-presence";

export async function heartbeatWorkItemPresence(input: {
  workItemId: string;
}): Promise<{ ok: boolean }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false };

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const label = me?.email?.split("@")[0] ?? null;

  await prisma.workItemPresence.upsert({
    where: {
      workItemId_principalType_principalId: {
        workItemId: input.workItemId,
        principalType: "user",
        principalId: userId,
      },
    },
    create: { workItemId: input.workItemId, principalType: "user", principalId: userId, displayLabel: label },
    update: { lastSeenAt: new Date(), displayLabel: label },
  });
  return { ok: true };
}

export async function getActiveWorkItemPresence(input: {
  workItemId: string;
}): Promise<{ viewers: ActiveViewer[] }> {
  const session = await auth();
  const userId = session?.user?.id ?? undefined;

  const rows = await prisma.workItemPresence.findMany({
    where: { workItemId: input.workItemId },
    orderBy: { lastSeenAt: "desc" },
    take: 50,
  });

  const viewers = filterActivePresence(rows, Date.now(), { excludePrincipalId: userId });
  return { viewers };
}
