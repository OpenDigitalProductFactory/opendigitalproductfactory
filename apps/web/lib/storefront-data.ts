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

  return {
    tagline: config.tagline,
    description: config.description,
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
