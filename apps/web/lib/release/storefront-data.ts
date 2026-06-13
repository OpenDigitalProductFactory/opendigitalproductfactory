import { cache } from "react";
import { prisma } from "@dpf/db";
import type { FormField } from "@dpf/storefront-templates";
import { resolveOperatingHoursTimezone } from "@/lib/operating-hours-types";
import type {
  PublicStorefrontConfig,
  PublicItem,
  PublicSection,
} from "./storefront-types";

// Generic fallback used when an archetype defines no form schema (or for custom
// archetypes that were created without one).
export const DEFAULT_INQUIRY_SCHEMA: FormField[] = [
  { name: "name", label: "Your name", type: "text", required: true },
  { name: "email", label: "Email address", type: "email", required: true },
  { name: "phone", label: "Phone number", type: "tel", required: false },
  { name: "message", label: "Message", type: "textarea", required: false },
];

function isFormField(value: unknown): value is FormField {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.name === "string" &&
    typeof f.label === "string" &&
    typeof f.type === "string" &&
    typeof f.required === "boolean"
  );
}

/**
 * Resolve the inquiry form schema for a storefront's archetype. The schema is
 * seeded onto StorefrontArchetype.formSchema from the storefront-templates
 * definitions; without this, every archetype rendered the same generic
 * name/email/phone/message form. Falls back to DEFAULT_INQUIRY_SCHEMA when the
 * archetype is missing or has no (valid) schema.
 */
export async function resolveInquiryFormSchema(
  archetypeId: string,
): Promise<FormField[]> {
  if (!archetypeId) return DEFAULT_INQUIRY_SCHEMA;
  const archetype = await prisma.storefrontArchetype.findUnique({
    where: { archetypeId },
    select: { formSchema: true },
  });
  const schema = archetype?.formSchema;
  if (Array.isArray(schema)) {
    // Cast through unknown[] so the isFormField type guard narrows to
    // FormField[]; Prisma's JsonValue does not satisfy the filter overload's
    // `S extends T` constraint directly.
    const fields = (schema as unknown[]).filter(isFormField);
    if (fields.length > 0) return fields;
  }
  return DEFAULT_INQUIRY_SCHEMA;
}

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

  // Booking calendar display timezone must follow the operator's Operating Hours
  // setting (BusinessProfile.timezone). StorefrontConfig.timezone carries a stale
  // Europe/London default that is never re-synced when the operator sets hours,
  // which is why US salons saw "Times shown in Europe/London" (AUDIT-R2-NS-B-005).
  // Resolve through the same helper the Operating Hours settings page uses so the
  // calendar label always matches what the operator sees there (UTC on a fresh
  // install), never the stale config default.
  const businessProfile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    select: { timezone: true },
  });
  const resolvedTimezone = resolveOperatingHoursTimezone(businessProfile?.timezone);

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
    timezone: resolvedTimezone,
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
