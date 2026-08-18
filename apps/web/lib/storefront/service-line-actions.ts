"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { readActivationProfile, mergeActivationProfiles } from "@dpf/storefront-templates";
import {
  seedCompositionArtifacts,
  type CompositionArtifactClient,
} from "./seed-composition-artifacts";

import { ok, err, type ActionResult } from "@/lib/shared/action-result";

const MAX_SECONDARY_LINES = 2;

/** Payload of a mutating service-line action that retains or removes artifacts. */
type ArtifactCounts = { items: number; sections: number };

/** A removed-but-retained service line whose generated content still exists. */
export interface RetainedServiceLine {
  compositionId: string;
  archetypeSlug: string;
  name: string;
  category: string;
  removedAt: Date;
  retainedItems: number;
  retainedSections: number;
}

async function requireAdmin(): Promise<{ organizationId: string } | { error: string }> {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return err("Unauthorized");
  }
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return err("Organization not found");
  return { organizationId: org.id };
}

/**
 * Add a secondary archetype service line to the storefront.
 * Seeds the secondary's item and section templates with sourceCompositionId
 * provenance so removeStorefrontServiceLine can scope cleanup precisely.
 */
export async function addStorefrontServiceLine(
  storefrontId: string,
  secondaryArchetypeSlug: string,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return err(auth.error);

  const storefront = await prisma.storefrontConfig.findFirst({
    where: { id: storefrontId, organizationId: auth.organizationId },
    select: { id: true, archetypeId: true },
  });
  if (!storefront) return err("Storefront not found");

  const secondaryArchetype = await prisma.storefrontArchetype.findUnique({
    where: { archetypeId: secondaryArchetypeSlug },
  });
  if (!secondaryArchetype) return err("Archetype not found");

  // Guard: cannot add the primary as a secondary
  if (secondaryArchetype.id === storefront.archetypeId) {
    return err("Primary archetype cannot be added as a secondary");
  }

  // Guard: max service lines
  const activeSecondaries = await prisma.storefrontArchetypeComposition.count({
    where: { storefrontId, role: "secondary", removedAt: null },
  });
  if (activeSecondaries >= MAX_SECONDARY_LINES) {
    return err(`Maximum ${MAX_SECONDARY_LINES} secondary service lines allowed`);
  }

  // Guard: already added and active
  const existing = await prisma.storefrontArchetypeComposition.findUnique({
    where: { storefrontId_archetypeId: { storefrontId, archetypeId: secondaryArchetype.id } },
  });
  if (existing && !existing.removedAt) {
    return err("This service line is already active");
  }

  // Get highest existing sortOrder
  const lastComposition = await prisma.storefrontArchetypeComposition.findFirst({
    where: { storefrontId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const nextSortOrder = (lastComposition?.sortOrder ?? 0) + 1;

  // Add/remove must be inverse (BI-7D7EE150). If this line was added before and
  // then removed, reactivate the exact artifacts it seeded rather than creating a
  // second, duplicate set — so re-adding restores the prior state cleanly.
  if (existing) {
    await prisma.storefrontArchetypeComposition.update({
      where: { id: existing.id },
      data: { removedAt: null, sortOrder: nextSortOrder, updatedAt: new Date() },
    });
    const seededItemCount = await prisma.storefrontItem.count({
      where: { sourceCompositionId: existing.id },
    });
    if (seededItemCount > 0) {
      await prisma.storefrontItem.updateMany({
        where: { sourceCompositionId: existing.id },
        data: { isActive: true },
      });
      // Sections were seeded hidden and stay hidden until the operator reveals
      // them, matching the original add behavior.
      revalidatePath("/storefront");
      return ok();
    }
    // Legacy row with no provenance-tagged artifacts: fall through and seed.
  }

  // Write (or reuse the reactivated) composition row.
  const composition = existing
    ? { id: existing.id }
    : await prisma.storefrontArchetypeComposition.create({
        data: {
          storefrontId,
          archetypeId: secondaryArchetype.id,
          role: "secondary",
          sortOrder: nextSortOrder,
        },
      });

  const orgSettingsRow = await prisma.orgSettings.findFirst({ select: { baseCurrency: true } });
  const seedCurrency = orgSettingsRow?.baseCurrency ?? "USD";

  await seedCompositionArtifacts({
    db: prisma as unknown as CompositionArtifactClient,
    storefrontId,
    compositionId: composition.id,
    compositionSortOrder: nextSortOrder,
    seedCurrency,
    revealContentSections: false,
    archetype: secondaryArchetype,
  });

  revalidatePath("/storefront");
  return ok();
}

/**
 * Remove a secondary service line by soft-deleting its composition row and
 * deactivating/hiding all items and sections seeded from it.
 * Primary service lines cannot be removed.
 */
export async function removeStorefrontServiceLine(
  storefrontId: string,
  compositionId: string,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return err(auth.error);

  const composition = await prisma.storefrontArchetypeComposition.findFirst({
    where: {
      id: compositionId,
      storefrontId,
      storefront: { organizationId: auth.organizationId },
      removedAt: null,
    },
  });
  if (!composition) return err("Service line not found");
  if (composition.role === "primary") return err("Primary service line cannot be removed");

  // Deactivate seeded items and hide seeded sections
  await Promise.all([
    prisma.storefrontItem.updateMany({
      where: { sourceCompositionId: compositionId },
      data: { isActive: false },
    }),
    prisma.storefrontSection.updateMany({
      where: { sourceCompositionId: compositionId },
      data: { isVisible: false },
    }),
    prisma.storefrontArchetypeComposition.update({
      where: { id: compositionId },
      data: { removedAt: new Date() },
    }),
  ]);

  revalidatePath("/storefront");
  return ok();
}

/**
 * Undo a service-line removal: reactivate the retained composition and its
 * seeded items. Sections stay hidden (as when first seeded) so the operator
 * chooses what to reveal. The inverse of removeStorefrontServiceLine.
 */
export async function restoreStorefrontServiceLine(
  storefrontId: string,
  compositionId: string,
): Promise<ActionResult<{ affected: ArtifactCounts }>> {
  const auth = await requireAdmin();
  if ("error" in auth) return err(auth.error);

  const composition = await prisma.storefrontArchetypeComposition.findFirst({
    where: {
      id: compositionId,
      storefrontId,
      storefront: { organizationId: auth.organizationId },
      removedAt: { not: null },
    },
    select: { id: true, role: true },
  });
  if (!composition) return err("Removed service line not found");
  if (composition.role === "primary") return err("Primary service line cannot be restored");

  // Guard the max-active limit: a restore re-activates a line, so it must not
  // exceed the same ceiling the add path enforces.
  const activeSecondaries = await prisma.storefrontArchetypeComposition.count({
    where: { storefrontId, role: "secondary", removedAt: null },
  });
  if (activeSecondaries >= MAX_SECONDARY_LINES) {
    return err(`Maximum ${MAX_SECONDARY_LINES} active service lines — remove one before restoring.`);
  }

  const [itemUpdate, sectionCount] = await Promise.all([
    prisma.storefrontItem.updateMany({
      where: { sourceCompositionId: compositionId },
      data: { isActive: true },
    }),
    prisma.storefrontSection.count({ where: { sourceCompositionId: compositionId } }),
    prisma.storefrontArchetypeComposition.update({
      where: { id: compositionId },
      data: { removedAt: null, updatedAt: new Date() },
    }),
  ]);

  revalidatePath("/storefront");
  return ok({ affected: { items: itemUpdate.count, sections: sectionCount } });
}

/**
 * Permanently remove a retained (already-removed) service line's generated
 * content — the "explain retained artifacts, then let me purge them" recovery.
 * Only operates on soft-removed lines so an active line's content is never
 * deleted out from under the storefront.
 */
export async function purgeRemovedServiceLine(
  storefrontId: string,
  compositionId: string,
): Promise<ActionResult<{ affected: ArtifactCounts }>> {
  const auth = await requireAdmin();
  if ("error" in auth) return err(auth.error);

  const composition = await prisma.storefrontArchetypeComposition.findFirst({
    where: {
      id: compositionId,
      storefrontId,
      storefront: { organizationId: auth.organizationId },
      removedAt: { not: null },
    },
    select: { id: true, role: true },
  });
  if (!composition) return err("Removed service line not found");
  if (composition.role === "primary") return err("Primary service line cannot be purged");

  const seededItems = await prisma.storefrontItem.findMany({
    where: { sourceCompositionId: compositionId },
    select: { id: true },
  });
  const seededItemIds = seededItems.map((i) => i.id);

  const sectionCount = await prisma.storefrontSection.count({
    where: { sourceCompositionId: compositionId },
  });

  await prisma.$transaction(async (tx) => {
    if (seededItemIds.length > 0) {
      // Clear dependents that FK to the items before deleting them.
      await tx.providerService.deleteMany({ where: { itemId: { in: seededItemIds } } });
      await tx.bookingHold.deleteMany({ where: { itemId: { in: seededItemIds } } });
      await tx.storefrontItem.deleteMany({ where: { id: { in: seededItemIds } } });
    }
    await tx.storefrontSection.deleteMany({ where: { sourceCompositionId: compositionId } });
    await tx.storefrontArchetypeComposition.delete({ where: { id: compositionId } });
  });

  revalidatePath("/storefront");
  return ok({ affected: { items: seededItemIds.length, sections: sectionCount } });
}

/**
 * List removed-but-retained service lines with the generated content still on
 * disk, so the recovery UI can offer restore-or-purge for each.
 */
export async function loadRemovedServiceLines(
  storefrontId: string,
): Promise<RetainedServiceLine[]> {
  const rows = await prisma.storefrontArchetypeComposition.findMany({
    where: { storefrontId, role: "secondary", removedAt: { not: null } },
    orderBy: [{ removedAt: "desc" }],
    include: {
      archetype: { select: { archetypeId: true, name: true, category: true } },
      _count: { select: { seededItems: true, seededSections: true } },
    },
  });

  return rows.map((row) => ({
    compositionId: row.id,
    archetypeSlug: row.archetype.archetypeId,
    name: row.archetype.name,
    category: row.archetype.category,
    removedAt: row.removedAt as Date,
    retainedItems: row._count.seededItems,
    retainedSections: row._count.seededSections,
  }));
}

/**
 * Load the full composition view data for a storefront, ready to pass to
 * deriveStorefrontCompositionView. Returns null if the storefront has no
 * composition rows (pre-migration or incomplete setup).
 */
export async function loadCompositionViewData(storefrontId: string) {
  const rows = await prisma.storefrontArchetypeComposition.findMany({
    where: { storefrontId, removedAt: null },
    orderBy: [{ sortOrder: "asc" }],
    include: {
      archetype: {
        select: {
          archetypeId: true,
          name: true,
          category: true,
          activationProfile: true,
        },
      },
      _count: { select: { seededItems: true, seededSections: true } },
    },
  });

  if (rows.length === 0) return null;

  const seededCountsByCompositionId: Record<string, { items: number; sections: number }> = {};
  for (const row of rows) {
    seededCountsByCompositionId[row.id] = {
      items: row._count.seededItems,
      sections: row._count.seededSections,
    };
  }

  const primary = rows.find((r) => r.role === "primary");
  const secondaries = rows.filter((r) => r.role === "secondary");

  if (!primary) return null;

  return {
    storefrontId,
    primary: {
      compositionId: primary.id,
      archetypeSlug: primary.archetype.archetypeId,
      name: primary.archetype.name,
      category: primary.archetype.category,
      activationProfile: readActivationProfile(primary.archetype.activationProfile),
    },
    secondaries: secondaries.map((s) => ({
      compositionId: s.id,
      archetypeSlug: s.archetype.archetypeId,
      name: s.archetype.name,
      category: s.archetype.category,
      activationProfile: readActivationProfile(s.archetype.activationProfile),
    })),
    seededCountsByCompositionId,
  };
}

/**
 * Get the current merged activation profile for a storefront from its
 * active composition rows. Falls back to null for pre-migration storefronts.
 */
export async function getCompositeActivationProfileForStorefront(storefrontId: string) {
  const data = await loadCompositionViewData(storefrontId);
  if (!data) return null;

  const allProfiles = [data.primary, ...data.secondaries]
    .map((r) => r.activationProfile)
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (allProfiles.length === 0) return null;
  return mergeActivationProfiles(allProfiles);
}
