import { cache } from "react";
import { prisma } from "@dpf/db";
import type { FormField } from "@dpf/storefront-templates";
import { loadStorefrontOperatingTimezone } from "@/lib/storefront/storefront-operating-timezone.server";
import { listOwnerMedia, mediaAssetUrl } from "@/lib/media";
import { getCurrencySymbol } from "@/lib/finance/currency-symbol";
import { inquiryFieldsForItem } from "./inquiry-fields";
import type {
  PublicStorefrontConfig,
  PublicItem,
  PublicSection,
  PublicAdoptableAnimal,
} from "./storefront-types";

/**
 * Load the published adoptable animals for a storefront, each with its primary
 * photo and gallery. Only loaded when the storefront has an `animals-available`
 * section, so every other archetype skips the query.
 */
export async function getPublicAdoptableAnimals(
  storefrontId: string,
): Promise<PublicAdoptableAnimal[]> {
  const animals = await prisma.adoptableAnimal.findMany({
    where: { storefrontId, status: { in: ["available", "pending", "hold"] } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      animalRef: true,
      name: true,
      species: true,
      breed: true,
      age: true,
      sex: true,
      size: true,
      description: true,
      status: true,
      attributes: true,
      primaryPhotoAssetId: true,
    },
  });

  return Promise.all(
    animals.map(async (a) => {
      const photos = (await listOwnerMedia("AdoptableAnimal", a.id)).map((m) => ({
        url: m.url,
        altText: m.altText,
        caption: m.caption,
        width: m.width,
        height: m.height,
      }));
      return {
        id: a.id,
        animalRef: a.animalRef,
        name: a.name,
        species: a.species,
        breed: a.breed,
        age: a.age,
        sex: a.sex,
        size: a.size,
        description: a.description,
        status: a.status,
        attributes: a.attributes as Record<string, unknown> | null,
        primaryPhotoUrl: a.primaryPhotoAssetId
          ? mediaAssetUrl(a.primaryPhotoAssetId)
          : (photos[0]?.url ?? null),
        photos,
      };
    }),
  );
}

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
 *
 * Donation fields are dropped unless the enquiry is about a donation item
 * (BI-7F851119). Five nonprofit archetypes were seeded with a donation form in
 * the contact-form slot, so an adoption enquiry, a found-pet report and an offer
 * to volunteer were all refused without a donation amount. The seed is fixed,
 * but an install seeded before that fix still holds the old JSON, so the rule is
 * applied on read as well.
 */
export async function resolveInquiryFormSchema(
  archetypeId: string,
  { itemCtaType }: { itemCtaType?: string | null } = {},
): Promise<FormField[]> {
  if (!archetypeId) return DEFAULT_INQUIRY_SCHEMA;
  const [archetype, orgSettings] = await Promise.all([
    prisma.storefrontArchetype.findUnique({
      where: { archetypeId },
      select: { formSchema: true },
    }),
    prisma.orgSettings.findFirst({ select: { baseCurrency: true } }),
  ]);
  const schema = archetype?.formSchema;
  let fields: FormField[] = DEFAULT_INQUIRY_SCHEMA;
  if (Array.isArray(schema)) {
    // Cast through unknown[] so the isFormField type guard narrows to
    // FormField[]; Prisma's JsonValue does not satisfy the filter overload's
    // `S extends T` constraint directly.
    const validated = (schema as unknown[]).filter(isFormField);
    if (validated.length > 0) fields = validated;
  }
  fields = inquiryFieldsForItem(fields, { itemCtaType });
  // Substitute the GBP symbol seeded into form option labels with the
  // workspace base currency symbol so a USD install doesn't show £ in
  // budget-range / donation-amount dropdowns.
  const baseCurrency = orgSettings?.baseCurrency ?? "USD";
  if (baseCurrency !== "GBP") {
    const sym = getCurrencySymbol(baseCurrency);
    fields = fields.map((f) => ({
      ...f,
      label: f.label.replace(/£/g, sym),
      placeholder: f.placeholder?.replace(/£/g, sym),
      options: f.options?.map((o) => o.replace(/£/g, sym)),
    }));
  }
  return fields;
}

export const getPublicStorefront = cache(async function getPublicStorefront(
  slug: string,
  { includeUnpublished = false }: { includeUnpublished?: boolean } = {}
): Promise<PublicStorefrontConfig | null> {
  const config = await prisma.storefrontConfig.findFirst({
    where: { organization: { slug } },
    select: {
      id: true,
      isPublished: true,
      tagline: true,
      description: true,
      timezone: true,
      heroImageUrl: true,
      contactEmail: true,
      contactPhone: true,
      socialLinks: true,
      archetype: {
        select: { archetypeId: true, category: true },
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
  const resolvedTimezone = await loadStorefrontOperatingTimezone(prisma);

  // Confirmed regulatory display obligations for the "disclosures" section
  // (BI-5D9DCDE6 spec §9.3). D5 honesty rule: only obligations whose parent
  // credential record is ACTIVE are exposed — uncaptured posture must render
  // a neutral placeholder, never a fabricated "Member FDIC"/NCUA claim.
  // Loaded only when the storefront actually has a disclosures section, so
  // every other archetype skips the extra query.
  // Adoptable animals back the `animals-available` section (pet-rescue /
  // animal-shelter). Loaded only when that section is present.
  const hasAnimalsSection = config.sections.some(
    (section) => section.type === "animals-available",
  );
  const animals = hasAnimalsSection
    ? await getPublicAdoptableAnimals(config.id)
    : [];

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
    archetypeCategory: config.archetype?.category ?? "",
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
    animals,
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
