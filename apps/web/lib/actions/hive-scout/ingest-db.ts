// apps/web/lib/actions/hive-scout/ingest-db.ts
//
// Hive Scout — database-facing helpers: the narrowed Prisma surface the
// ingest needs, AI-Workforce portfolio links, and admin notification.

import { prisma } from "@dpf/db";
import type { PrismaClient } from "@dpf/db";
import {
  AI_WORKFORCE_PRODUCT_ID,
  AI_WORKFORCE_TAXONOMY_NODE_ID,
} from "@dpf/db/workforce-portfolio";
import { sendQueueNotification } from "@/lib/queue/notification-adapter";

const DEEP_LINK = "/portfolio/backlog?source=hive-scout";

export type HiveScoutPrisma = Pick<
  PrismaClient,
  | "eaReferenceModelElement"
  | "skillDefinition"
  | "agent"
  | "backlogItem"
  | "backlogItemActivity"
  | "user"
  | "platformConfig"
  | "rawSource"
  | "digitalProduct"
  | "taxonomyNode"
> & {
  taskRun?: unknown;
};

export type HiveScoutWorkforceLinks = {
  digitalProductId: string | null;
  taxonomyNodeId: string | null;
};

export async function resolveHiveScoutWorkforceLinks(
  db: Pick<HiveScoutPrisma, "digitalProduct" | "taxonomyNode">,
): Promise<HiveScoutWorkforceLinks> {
  const [product, taxonomyNode] = await Promise.all([
    db.digitalProduct.findUnique({
      where: { productId: AI_WORKFORCE_PRODUCT_ID },
      select: { id: true },
    }),
    db.taxonomyNode.findUnique({
      where: { nodeId: AI_WORKFORCE_TAXONOMY_NODE_ID },
      select: { id: true },
    }),
  ]);

  return {
    digitalProductId: product?.id ?? null,
    taxonomyNodeId: taxonomyNode?.id ?? null,
  };
}

export async function notifyAdmins(
  created: number,
  prismaClient: HiveScoutPrisma = prisma,
): Promise<void> {
  if (created === 0) return;
  const admins = await prismaClient.user.findMany({
    where: { isSuperuser: true, isActive: true },
    select: { id: true },
  });
  if (admins.length === 0) return;

  await Promise.all(
    admins.map((admin: { id: string }) =>
      sendQueueNotification({
        recipientUserId: admin.id,
        workItemId: `hive-scout-${Date.now()}`,
        title: "Hive Scout — new archetype suggestions",
        body: `${created} new archetype suggestions from external catalogs.`,
        urgency: "low",
        deepLink: DEEP_LINK,
      }),
    ),
  );
}
