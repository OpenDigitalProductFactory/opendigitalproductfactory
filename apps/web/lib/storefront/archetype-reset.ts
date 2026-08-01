import { prisma, type Prisma } from "@dpf/db";
import { applyBusinessCapabilityPerspective } from "@dpf/db/business-capability-perspectives";
import { newId } from "@/lib/shared/new-id";
import { projectOperationalValueStreamForArchetype } from "./project-operational-value-stream";
import { seedBookingScheduleDefaults } from "./seed-booking-defaults";
import { seedBeautyCapacityDefaults } from "./seed-beauty-capacity-defaults";

type ResetMode = "replace-seeded-content";

/** Operator-owned business identity that survives an archetype change. */
const IDENTITY_FIELDS = ["orgName", "slug", "tagline"] as const;
type IdentityField = (typeof IDENTITY_FIELDS)[number];

export async function resetStorefrontArchetype(input: {
  organizationId: string;
  targetArchetypeId: string;
  mode: ResetMode;
  /**
   * Operator-owned business identity (company name, URL slug, hero tagline).
   * Archetypes carry NO default values for these, so an archetype swap never
   * auto-derives them — doing so would clobber the operator's real business
   * identity (or blank it). When a caller (e.g. a "change archetype" UI) has
   * collected new values it can pass them here to perform a full swap; anything
   * omitted is preserved and reported in `result.identity` + `result.warnings`
   * so the operator can update it themselves. (AUDIT-R1S-001 / #1748)
   */
  identity?: {
    orgName?: string;
    slug?: string;
    tagline?: string;
  };
}) {
  const { organizationId, targetArchetypeId, mode, identity } = input;

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });

    if (!organization) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    const storefront = await tx.storefrontConfig.findUnique({
      where: { organizationId },
      select: { id: true, organizationId: true, tagline: true },
    });

    if (!storefront) {
      throw new Error(`Storefront for organization ${organizationId} not found`);
    }

    const targetArchetype = await tx.storefrontArchetype.findUnique({
      where: { archetypeId: targetArchetypeId },
      select: {
        id: true,
        archetypeId: true,
        category: true,
        ctaType: true,
        sectionTemplates: true,
        itemTemplates: true,
      },
    });

    if (!targetArchetype) {
      throw new Error(`Target archetype ${targetArchetypeId} not found`);
    }

    // Resolve operator-owned identity. Only values the caller explicitly
    // supplied are applied; everything else is preserved and reported below so
    // the public storefront never silently presents the prior archetype's
    // identity to customers without the operator being told. (AUDIT-R1S-001)
    const warnings: string[] = [];
    const identityUpdated: IdentityField[] = [];

    const organizationData: Prisma.OrganizationUncheckedUpdateInput = {
      industry: targetArchetype.category,
    };
    const storefrontData: Prisma.StorefrontConfigUncheckedUpdateInput = {
      archetypeId: targetArchetype.id,
    };

    let finalName = organization.name;
    let finalSlug = organization.slug;
    let finalTagline = storefront.tagline ?? null;

    if (identity?.orgName != null && identity.orgName !== organization.name) {
      organizationData.name = identity.orgName;
      finalName = identity.orgName;
      identityUpdated.push("orgName");
    }
    if (identity?.tagline != null && identity.tagline !== storefront.tagline) {
      storefrontData.tagline = identity.tagline;
      finalTagline = identity.tagline;
      identityUpdated.push("tagline");
    }
    if (identity?.slug != null && identity.slug !== organization.slug) {
      // slug is @unique — never overwrite another org's slug.
      const slugTaken = await tx.organization.findFirst({
        where: { slug: identity.slug, NOT: { id: organizationId } },
        select: { id: true },
      });
      if (slugTaken) {
        warnings.push(
          `Requested URL slug "${identity.slug}" is already in use; the storefront still uses "${organization.slug}".`,
        );
      } else {
        organizationData.slug = identity.slug;
        finalSlug = identity.slug;
        identityUpdated.push("slug");
      }
    }

    await tx.storefrontConfig.update({
      where: { id: storefront.id },
      data: storefrontData,
    });

    await tx.organization.update({
      where: { id: organizationId },
      data: organizationData,
    });

    await tx.businessContext.updateMany({
      where: { organizationId },
      data: {
        industry: targetArchetype.category,
        ctaType: targetArchetype.ctaType,
      },
    });

    await applyBusinessCapabilityPerspective(tx, {
      archetypeId: targetArchetype.archetypeId,
      category: targetArchetype.category,
    });

    // P0 "Capture": regenerate the org's operational value-stream architecture
    // inside the reset transaction (idempotent; prunes stages the new archetype
    // does not have, e.g. rental → non-rental drops Return & Inspect).
    await projectOperationalValueStreamForArchetype({
      db: tx,
      organizationId,
      archetypeId: targetArchetype.archetypeId,
    });

    const orgSettingsRow = await tx.orgSettings.findFirst({ select: { baseCurrency: true } });
    const seedCurrency = orgSettingsRow?.baseCurrency ?? "USD";

    let sectionsCreated = 0;
    let itemsCreated = 0;

    if (mode === "replace-seeded-content") {
      const existingItems = await tx.storefrontItem.findMany({
        where: { storefrontId: storefront.id },
        select: { id: true },
      });
      const existingItemIds = existingItems.map((item) => item.id);

      if (existingItemIds.length > 0) {
        await tx.providerService.deleteMany({
          where: { itemId: { in: existingItemIds } },
        });
        await tx.bookingHold.deleteMany({
          where: { itemId: { in: existingItemIds } },
        });
      }

      await tx.storefrontSection.deleteMany({
        where: { storefrontId: storefront.id },
      });
      await tx.storefrontItem.deleteMany({
        where: { storefrontId: storefront.id },
      });

      const sectionTemplates = targetArchetype.sectionTemplates as Array<{
        type: string;
        title?: string | null;
        sortOrder: number;
        content?: Record<string, unknown>;
      }>;
      const itemTemplates = targetArchetype.itemTemplates as Array<{
        name: string;
        description?: string | null;
        category?: string | null;
        priceType?: string | null;
        ctaType?: string | null;
        ctaLabel?: string | null;
      }>;

      // Content-dependent sections (team, gallery, testimonials) return null when
      // their content is empty. Seed them as hidden until the operator adds content
      // so the public storefront never shows invisible gap-sections (R10-SECT-001).
      const CONTENT_DEPENDENT_TYPES = ["team", "gallery", "testimonials"];

      const sectionResult = await tx.storefrontSection.createMany({
        data: sectionTemplates.map((section) => {
          const hasContent = Object.keys(section.content ?? {}).length > 0;
          return {
            storefrontId: storefront.id,
            type: section.type,
            title: section.title ?? null,
            content: (section.content ?? {}) as unknown as Prisma.InputJsonValue,
            sortOrder: section.sortOrder,
            isVisible: CONTENT_DEPENDENT_TYPES.includes(section.type) ? hasContent : true,
          };
        }),
      });

      const itemResult = await tx.storefrontItem.createMany({
        data: itemTemplates.map((item, index) => ({
          storefrontId: storefront.id,
          itemId: `itm-${newId(8)}`,
          name: item.name,
          description: item.description ?? null,
          category: item.category ?? null,
          priceType: item.priceType ?? null,
          priceCurrency: seedCurrency,
          ctaType: item.ctaType ?? targetArchetype.ctaType,
          ctaLabel: item.ctaLabel ?? null,
          sortOrder: index,
          isActive: true,
        })),
      });

      sectionsCreated = sectionResult.count;
      itemsCreated = itemResult.count;

      // Booking archetypes (e.g. restaurant) seed booking items but, before this,
      // no provider/availability — leaving the storefront's booking calendar with
      // every date greyed out (R9-RES-001). Seed a default provider + hours +
      // provider→item links + bookingConfig from the template, inside the reset
      // transaction so it commits or rolls back atomically with the rest. No-op
      // for non-booking archetypes. Shared with storefront setup so the two seed
      // paths can't drift.
      await seedBookingScheduleDefaults(tx, {
        storefrontId: storefront.id,
        archetypeId: targetArchetype.archetypeId,
        providerName: finalName ?? "Bookings",
      });
      await seedBeautyCapacityDefaults(tx, {
        organizationId,
        storefrontId: storefront.id,
        archetypeId: targetArchetype.archetypeId,
      });
    }

    // Identity fields the caller did NOT supply were preserved and may still
    // reflect the prior archetype/setup — surface them so the operator (or the
    // calling UI) can update them rather than silently presenting the wrong
    // business identity to customers. (AUDIT-R1S-001 / #1748)
    const identityPreserved = IDENTITY_FIELDS.filter((f) => !identityUpdated.includes(f));
    if (identityPreserved.length > 0) {
      warnings.push(
        `Business identity (${identityPreserved.join(", ")}) was preserved across the archetype change and may still reflect your previous setup. ` +
          `Update it in storefront settings if it no longer fits "${targetArchetype.archetypeId}".`,
      );
    }

    return {
      storefrontId: storefront.id,
      archetypeId: targetArchetypeId,
      category: targetArchetype.category,
      sectionsCreated,
      itemsCreated,
      identity: {
        orgName: finalName,
        slug: finalSlug,
        tagline: finalTagline,
        updated: identityUpdated,
        preserved: identityPreserved,
      },
      warnings,
    };
  });
}
