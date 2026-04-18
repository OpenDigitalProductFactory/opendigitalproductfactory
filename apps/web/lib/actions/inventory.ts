"use server";

import { prisma, promoteInventoryEntities } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

const DISCOVERY_REVALIDATE_PATHS = [
  "/platform/tools",
  "/platform/tools/discovery",
  "/inventory",
] as const;

function revalidateDiscoverySurfaces() {
  DISCOVERY_REVALIDATE_PATHS.forEach((path) => revalidatePath(path));
}

async function requireManageDiscovery(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    return { ok: false, error: "Unauthorized" };
  }
  return { ok: true };
}

export async function acceptAttribution(
  entityId: string,
): Promise<{ ok: boolean; error?: string }> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  await prisma.inventoryEntity.update({
    where: { id: entityId },
    data: { attributionStatus: "attributed" },
  });

  // Trigger promotion for the newly attributed entity
  await promoteInventoryEntities(prisma as never);

  revalidateDiscoverySurfaces();
  return { ok: true };
}

export async function reassignTaxonomy(
  entityId: string,
  taxonomyNodeId: string,
): Promise<{ ok: boolean; error?: string }> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  // Look up taxonomy node to get portfolioId
  const node = await prisma.taxonomyNode.findUnique({
    where: { id: taxonomyNodeId },
    select: { id: true, nodeId: true },
  });
  if (!node) return { ok: false, error: "Taxonomy node not found" };

  const rootSlug = node.nodeId.split("/")[0];
  const portfolio = rootSlug
    ? await prisma.portfolio.findUnique({ where: { slug: rootSlug }, select: { id: true } })
    : null;

  await prisma.inventoryEntity.update({
    where: { id: entityId },
    data: {
      taxonomyNodeId: node.id,
      attributionStatus: "attributed",
      attributionMethod: "manual",
      attributionConfidence: 1.0,
      ...(portfolio ? { portfolioId: portfolio.id } : {}),
    },
  });

  await promoteInventoryEntities(prisma as never);

  revalidateDiscoverySurfaces();
  return { ok: true };
}

export async function dismissEntity(
  entityId: string,
): Promise<{ ok: boolean; error?: string }> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  await prisma.inventoryEntity.update({
    where: { id: entityId },
    data: { attributionStatus: "dismissed" },
  });

  revalidateDiscoverySurfaces();
  return { ok: true };
}
