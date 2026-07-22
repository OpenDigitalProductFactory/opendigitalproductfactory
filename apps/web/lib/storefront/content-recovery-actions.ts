"use server";

// apps/web/lib/storefront/content-recovery-actions.ts
//
// BI-CBE9B9B3 — grouped recovery of generated / cross-archetype residue from the
// menu and section editors. The owner reviews an affected-artifact preview, then
// removes a whole group in one action instead of deleting rows one at a time.
//
// Trust boundary: the client sends the ids it wants removed, but this action
// re-derives the residue set server-side and removes ONLY ids that are both
// requested AND independently classified as residue for this storefront. A stale
// or tampered client can never use it to delete legitimate owner content.

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { loadStorefrontContentFit } from "./content-fit.server";
import { getVocabulary } from "./archetype-vocabulary";

export interface RecoverResidueRequest {
  itemIds: string[];
  sectionIds: string[];
}

export interface SkippedItem {
  id: string;
  name: string;
  reason: string;
}

export type RecoverResidueResult =
  | {
      success: true;
      removedItems: number;
      removedSections: number;
      deactivatedItems: number;
      skipped: SkippedItem[];
    }
  | { error: string };

async function requireAdminOrg(): Promise<{ organizationId: string } | { error: string }> {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return { error: "Unauthorized" };
  }
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return { error: "Organization not found" };
  return { organizationId: org.id };
}

export async function recoverGeneratedResidue(
  storefrontId: string,
  request: RecoverResidueRequest,
): Promise<RecoverResidueResult> {
  const authed = await requireAdminOrg();
  if ("error" in authed) return authed;

  const storefront = await prisma.storefrontConfig.findFirst({
    where: { id: storefrontId, organizationId: authed.organizationId },
    include: {
      archetype: { select: { category: true, archetypeId: true, customVocabulary: true } },
    },
  });
  if (!storefront) return { error: "Storefront not found" };

  const vocabulary = getVocabulary(
    storefront.archetype.category,
    storefront.archetype.customVocabulary as Record<string, string> | null,
  );

  // Re-derive residue server-side; act only on the intersection with the request.
  const fit = await loadStorefrontContentFit({
    storefrontId,
    currentCategory: storefront.archetype.category,
    vocabulary,
  });

  const residueItemIds = new Set(fit.residueItems.map((i) => i.id));
  const residueSectionIds = new Set(fit.residueSections.map((s) => s.id));

  const targetItemIds = request.itemIds.filter((id) => residueItemIds.has(id));
  const targetSectionIds = request.sectionIds.filter((id) => residueSectionIds.has(id));

  if (targetItemIds.length === 0 && targetSectionIds.length === 0) {
    return {
      error: "Nothing to recover — this content no longer looks like generated residue.",
    };
  }

  const skipped: SkippedItem[] = [];
  let deactivatedItems = 0;
  let removedItems = 0;
  let removedSections = 0;

  // Items that carry real customer footprint (bookings/inquiries) are deactivated
  // rather than hard-deleted, mirroring the single-item DELETE route contract so
  // recovery never destroys booking history.
  const deletableItemIds: string[] = [];
  if (targetItemIds.length > 0) {
    const items = await prisma.storefrontItem.findMany({
      where: { id: { in: targetItemIds }, storefrontId },
      select: { id: true, name: true },
    });
    const validIds = new Set(items.map((i) => i.id));
    const nameById = new Map(items.map((i) => [i.id, i.name] as const));

    const [bookings, inquiries] = await Promise.all([
      prisma.storefrontBooking.groupBy({
        by: ["itemId"],
        where: { itemId: { in: [...validIds] } },
        _count: { itemId: true },
      }),
      prisma.storefrontInquiry.groupBy({
        by: ["itemId"],
        where: { itemId: { in: [...validIds] } },
        _count: { itemId: true },
      }),
    ]);
    const hasFootprint = new Set<string>([
      ...bookings.map((b) => b.itemId),
      ...inquiries.map((i) => i.itemId).filter((id): id is string => id !== null),
    ]);

    for (const id of validIds) {
      if (hasFootprint.has(id)) {
        skipped.push({
          id,
          name: nameById.get(id) ?? id,
          reason: "Has bookings or enquiries — deactivated instead of deleted.",
        });
      } else {
        deletableItemIds.push(id);
      }
    }

    const footprintIds = [...hasFootprint].filter((id) => validIds.has(id));
    if (footprintIds.length > 0) {
      const res = await prisma.storefrontItem.updateMany({
        where: { id: { in: footprintIds } },
        data: { isActive: false },
      });
      deactivatedItems = res.count;
    }
  }

  await prisma.$transaction(async (tx) => {
    if (deletableItemIds.length > 0) {
      await tx.providerService.deleteMany({ where: { itemId: { in: deletableItemIds } } });
      await tx.bookingHold.deleteMany({ where: { itemId: { in: deletableItemIds } } });
      const res = await tx.storefrontItem.deleteMany({
        where: { id: { in: deletableItemIds }, storefrontId },
      });
      removedItems = res.count;
    }
    if (targetSectionIds.length > 0) {
      const res = await tx.storefrontSection.deleteMany({
        where: { id: { in: targetSectionIds }, storefrontId },
      });
      removedSections = res.count;
    }
  });

  revalidatePath("/storefront/items");
  revalidatePath("/storefront/sections");
  revalidatePath("/storefront");

  return { success: true, removedItems, removedSections, deactivatedItems, skipped };
}
