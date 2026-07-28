// What this install actually has switched on.
// Spec: docs/superpowers/specs/2026-07-28-critical-business-journey-watchdog-design.md §5
//
// Journeys declare applicability against these facts rather than assuming every
// install is a storefront. An install with no published storefront has no
// storefront journeys — and says so, instead of showing a wall of red tiles for
// capabilities the owner never turned on.

import type { prisma } from "@dpf/db";
import { resolveAppBaseUrl } from "@/lib/app-url";
import type { InstallJourneyContext } from "./types";

type Db = typeof prisma;

/** ctaType values that mean "a customer can book a slot" / "ask a question".
 *  Vocabulary source: lib/storefront/cta-labels.ts DEFAULT_CTA_LABELS. */
const BOOKABLE_CTA_TYPES = ["booking", "rental"] as const;
const INQUIRY_CTA_TYPES = ["inquiry"] as const;

/**
 * Resolve the live install context.
 *
 * Single-org install (see the single-org-per-install invariant): the first
 * StorefrontConfig with its organization is the install's storefront. Absence is
 * a normal, expected state — not an error.
 */
export async function resolveInstallJourneyContext(db: Db): Promise<InstallJourneyContext> {
  const baseUrl = resolveAppBaseUrl();

  const storefront = await db.storefrontConfig.findFirst({
    select: {
      id: true,
      archetypeId: true,
      isPublished: true,
      organizationId: true,
      organization: { select: { slug: true } },
      archetypeCompositions: {
        where: { removedAt: null },
        select: { archetypeId: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!storefront) {
    return {
      organizationId: null,
      organizationSlug: null,
      baseUrl: baseUrl ?? "",
      storefrontId: null,
      storefrontPublished: false,
      archetypeIds: [],
      bookableItemId: null,
      hasInquirySurface: false,
      hasPaymentConfiguration: false,
    };
  }

  // Primary archetype first, then composed secondaries, de-duplicated.
  const archetypeIds = Array.from(
    new Set([storefront.archetypeId, ...storefront.archetypeCompositions.map((c) => c.archetypeId)]),
  );

  const [bookableItem, inquiryItemCount, paymentConfigured] = await Promise.all([
    db.storefrontItem.findFirst({
      where: {
        storefrontId: storefront.id,
        isActive: true,
        ctaType: { in: [...BOOKABLE_CTA_TYPES] },
      },
      select: { itemId: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.storefrontItem.count({
      where: {
        storefrontId: storefront.id,
        isActive: true,
        ctaType: { in: [...INQUIRY_CTA_TYPES] },
      },
    }),
    hasPaymentConfiguration(db),
  ]);

  return {
    organizationId: storefront.organizationId,
    organizationSlug: storefront.organization?.slug ?? null,
    baseUrl: baseUrl ?? "",
    storefrontId: storefront.id,
    storefrontPublished: storefront.isPublished,
    archetypeIds,
    bookableItemId: bookableItem?.itemId ?? null,
    // An inquiry surface exists when a customer has somewhere to ask from: a
    // dedicated inquiry item, or a published storefront with a contact route.
    hasInquirySurface: inquiryItemCount > 0,
    hasPaymentConfiguration: paymentConfigured,
  };
}

/** True when the install can actually take money — a purchase item exists. */
async function hasPaymentConfiguration(db: Db): Promise<boolean> {
  const purchasable = await db.storefrontItem.count({
    where: { isActive: true, ctaType: "purchase", priceAmount: { not: null } },
  });
  return purchasable > 0;
}
