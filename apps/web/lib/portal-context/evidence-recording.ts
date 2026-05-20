import type { Prisma } from "@dpf/db";

type PortalContextEvidenceDb = {
  backlogItem: {
    findUnique(args: {
      where: { itemId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  backlogItemActivity: {
    create(args: {
      data: {
        backlogItemId: string;
        kind: string;
        summary: string;
        payload: Prisma.InputJsonValue;
        recordedById: string | null;
        recordedByAgentId: string | null;
      };
    }): Promise<unknown>;
  };
};

export async function recordPortalContextBacklogEvidence(args: {
  db: PortalContextEvidenceDb;
  backlogItemId: string | null | undefined;
  kind: string;
  summary: string;
  payload: Prisma.InputJsonValue;
  actor: {
    userId: string | null;
    agentId: string | null;
  };
}): Promise<void> {
  const itemId = args.backlogItemId?.trim();
  if (!itemId) return;

  const backlogItem = await args.db.backlogItem.findUnique({
    where: { itemId },
    select: { id: true },
  });
  if (!backlogItem) return;

  await args.db.backlogItemActivity.create({
    data: {
      backlogItemId: backlogItem.id,
      kind: args.kind,
      summary: args.summary.slice(0, 240),
      payload: args.payload,
      recordedById: args.actor.userId,
      recordedByAgentId: args.actor.agentId,
    },
  });
}
