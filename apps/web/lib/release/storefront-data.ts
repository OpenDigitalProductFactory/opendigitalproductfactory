import { cache } from "react";
import { prisma } from "@dpf/db";
import type {
  PublicStorefrontConfig,
  PublicItem,
  PublicSection,
} from "./storefront-types";

export const getPublicStorefront = cache(async function getPublicStorefront(
  slug: string,
  { includeUnpublished = false }: { includeUnpublished?: boolean } = {}
): Promise<PublicStorefrontConfig | null> {
  const config = await prisma.storefrontConfig.findFirst({
    where: { organization: { slug } },
    select: {
      isPublished: true,
      tagline: true,
      description: true,
      timezone: true,
      heroImageUrl: true,
      contactEmail: true,
      contactPhone: true,
      socialLinks: true,
      archetype: {
        select: { archetypeId: true },
      },
      organization: {
        select: {
          name: true,
          slug: true,
          logoUrl: true,
          address: true,
          brandingConfig: {
            select: { tokens: true },
          },
        },
      },
      sections: {
        where: { isVisible: true },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          type: true,
          title: true,
          content: true,
          sortOrder: true,
          isVisible: true,
        },
      },
      items: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          itemId: true,
          name: true,
          description: true,
          category: true,
          priceAmount: true,
          priceCurrency: true,
          priceType: true,
          imageUrl: true,
          ctaType: true,
          ctaLabel: true,
          bookingConfig: true,
          sortOrder: true,
        },
      },
    },
  });

  if (!config || (!includeUnpublished && !config.isPublished)) return null;

  const org = config.organization;

  // Confirmed regulatory display obligations for the "disclosures" section
  // (BI-5D9DCDE6 spec §9.3). D5 honesty rule: only obligations whose parent
  // credential record is ACTIVE are exposed — uncaptured posture must render
  // a neutral placeholder, never a fabricated "Member FDIC"/NCUA claim.
  // Loaded only when the storefront actually has a disclosures section, so
  // every other archetype skips the extra query.
  const hasDisclosuresSection = config.sections.some(
    (section) => section.type === "disclosures",
  );
  const displayObligations = hasDisclosuresSection
    ? (
        await prisma.licenseDisplayObligation.findMany({
          where: {
            organizationLicenseRecord: {
              status: "active",
              organizationLicenseProfile: { organization: { slug } },
            },
          },
          orderBy: { createdAt: "asc" },
          select: {
            displayObligationId: true,
            displayType: true,
            notes: true,
            organizationLicenseRecord: {
              select: {
                licenseNumber: true,
                requirementReference: {
                  select: { authorityName: true, displayRuleSummary: true },
                },
              },
            },
          },
        })
      ).map((obligation) => ({
        displayObligationId: obligation.displayObligationId,
        displayType: obligation.displayType,
        text:
          obligation.notes ??
          obligation.organizationLicenseRecord?.requirementReference?.displayRuleSummary ??
          null,
        authorityName:
          obligation.organizationLicenseRecord?.requirementReference?.authorityName ?? null,
        licenseNumber: obligation.organizationLicenseRecord?.licenseNumber ?? null,
      }))
    : [];

  return {
    tagline: config.tagline,
    description: config.description,
    timezone: config.timezone ?? "America/Chicago",
    heroImageUrl: config.heroImageUrl,
    contactEmail: config.contactEmail,
    contactPhone: config.contactPhone,
    socialLinks: config.socialLinks as PublicStorefrontConfig["socialLinks"],
    archetypeId: config.archetype?.archetypeId ?? "",
    orgName: org.name,
    orgSlug: org.slug,
    orgLogoUrl: org.logoUrl,
    orgAddress: org.address as PublicStorefrontConfig["orgAddress"],
    brandingTokens:
      (org.brandingConfig?.tokens as Record<string, unknown>) ?? null,
    sections: config.sections as PublicSection[],
    items: config.items.map((item) => ({
      ...item,
      priceAmount: item.priceAmount?.toString() ?? null,
      bookingConfig: item.bookingConfig as Record<string, unknown> | null,
    })),
    displayObligations,
  };
});

export async function getPublicItem(
  slug: string,
  itemId: string
): Promise<PublicItem | null> {
  const item = await prisma.storefrontItem.findFirst({
    where: {
      itemId,
      isActive: true,
      storefront: { organization: { slug }, isPublished: true },
    },
    select: {
      id: true,
      itemId: true,
      name: true,
      description: true,
      category: true,
      priceAmount: true,
      priceCurrency: true,
      priceType: true,
      imageUrl: true,
      ctaType: true,
      ctaLabel: true,
      bookingConfig: true,
      sortOrder: true,
    },
  });

  if (!item) return null;
  return {
    ...item,
    priceAmount: item.priceAmount?.toString() ?? null,
    bookingConfig: item.bookingConfig as Record<string, unknown> | null,
  };
}

/** Resolve org slug from single Organization record — used by middleware redirects */
export async function resolveOrgSlug(): Promise<string | null> {
  const org = await prisma.organization.findFirst({ select: { slug: true } });
  return org?.slug ?? null;
}
