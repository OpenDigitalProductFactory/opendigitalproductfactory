// apps/web/lib/storefront/public-trust.ts
//
// Single source of truth for the public-facing TRUST layer of the public
// storefront (`/s/[slug]/*`): archetype-appropriate policy/dietary/payment copy,
// customer-account vocabulary, and the journey-support predicate that decides
// whether an archetype-specific path (donation / order / booking) is actually
// offered by this storefront.
//
// Kept archetype-CATEGORY keyed (never fabricated per-org) so every food venue,
// clinic, salon, etc. inherits honest, non-overclaiming trust copy. Categories
// without a bespoke profile fall back to a safe generic profile — we never
// invent a specific legal/payment claim the business has not configured.

import type { PublicStorefrontConfig } from "@/lib/storefront/storefront-types";
import { prisma } from "@dpf/db";
import { profileHoursToSchedule } from "@/lib/operating-hours-read";
import type { WeeklySchedule } from "@/lib/operating-hours-types";

export type PublicJourney = "booking" | "order" | "donation" | "inquiry";

/**
 * Does this storefront actually OFFER the given customer journey? Derived from
 * the configured items + sections, never assumed from the archetype label. A
 * Restaurant that has never configured a donation appeal must not expose a live
 * `/donate` page; an order path needs a purchasable item with a real price.
 */
export function isJourneySupported(
  storefront: Pick<PublicStorefrontConfig, "items" | "sections">,
  journey: PublicJourney,
): boolean {
  const items = storefront.items ?? [];
  const sections = storefront.sections ?? [];
  switch (journey) {
    case "donation":
      return (
        items.some((i) => i.ctaType === "donation") ||
        sections.some((s) => s.type === "donate")
      );
    case "order":
      // A purchasable item needs a real price — there is nothing to charge for a
      // £0 "order", so the journey is not genuinely supported.
      return items.some((i) => i.ctaType === "purchase" && i.priceAmount !== null);
    case "booking":
      return items.some((i) => i.ctaType === "booking");
    case "inquiry":
      // Inquiry is the universal, always-safe fallback contact journey.
      return true;
  }
}

export type TrustProfile = {
  /** Noun for a single committed request, e.g. "reservation" / "appointment". */
  bookingNoun: string;
  /** One line: what booking commits the customer to + how confirmation works. */
  bookingPolicy: string;
  /** One line: how to change or cancel. */
  cancellationPolicy: string;
  /** Dietary / allergen note (food only); null when not applicable. */
  dietaryNote: string | null;
  /** Reassurance shown where money is taken (deposit / card security). */
  paymentNote: string;
  /** What the customer account is for, in archetype terms. */
  accountPurpose: string;
  /** Label used by public footer and item-detail policy links. */
  policyLinkLabel: string;
  /** Page-level policy framing; avoids hardcoded commercial language. */
  pageTitle: string;
  pageIntro: string;
  policyHeading: string;
  /** The request kinds named in the privacy explanation. */
  privacyRequestKinds: string;
  /** Archetype-appropriate terms, without invented guarantees. */
  termsPolicy: string;
  /** Prompt shown beside the item-level contact link. */
  contactPrompt: string;
};

const GENERIC_TRUST: TrustProfile = {
  bookingNoun: "booking",
  bookingPolicy:
    "Requesting a time sends your details to the team; you'll receive confirmation before it's final.",
  cancellationPolicy:
    "Need to change or cancel? Contact us using the details below and we'll help.",
  dietaryNote: null,
  paymentNote:
    "You won't be asked for payment to make this request. Any payment is handled directly with the business.",
  accountPurpose: "manage your bookings and requests",
  policyLinkLabel: "Booking & cancellation",
  pageTitle: "Policies & customer information",
  pageIntro: "How we handle bookings, your information, and getting in touch.",
  policyHeading: "Booking & cancellation",
  privacyRequestKinds: "booking, order, or enquiry",
  termsPolicy:
    "Submitting a booking or enquiry is a request, not a guaranteed reservation, until it is confirmed. Prices and availability may change; contact us with questions before you book.",
  contactPrompt: "Questions before you book?",
};

const TRUST_BY_CATEGORY: Record<string, Partial<TrustProfile>> = {
  "food-hospitality": {
    bookingNoun: "reservation",
    bookingPolicy:
      "Reserving a table sends your request to the venue; you'll receive confirmation of your reservation before it's held.",
    cancellationPolicy:
      "Plans changed? Contact the venue using the details below to amend or cancel your reservation — please give as much notice as you can.",
    dietaryNote:
      "Have allergies or dietary requirements? Note them when you book and the kitchen will do its best to accommodate you.",
    paymentNote:
      "No card details are taken to reserve a table. Any deposit for large parties or private dining is arranged directly with the venue.",
    accountPurpose: "manage your reservations and view your booking history",
  },
  "healthcare-wellness": {
    bookingNoun: "appointment",
    bookingPolicy:
      "Requesting a time sends your details to the practice; you'll receive confirmation before your appointment is booked.",
    cancellationPolicy:
      "Need to reschedule or cancel? Contact the practice using the details below as early as you can.",
    dietaryNote: null,
    paymentNote:
      "No payment is taken to request an appointment. Fees are arranged directly with the practice.",
    accountPurpose: "manage your appointments and requests",
  },
  "beauty-personal-care": {
    bookingNoun: "appointment",
    bookingPolicy:
      "Requesting a time sends your details to the team; you'll receive confirmation before your appointment is held.",
    cancellationPolicy:
      "To change or cancel, contact us using the details below — please give as much notice as you can.",
    dietaryNote: null,
    paymentNote:
      "No card details are taken to book. Any deposit is arranged directly with the business.",
    accountPurpose: "manage your appointments and bookings",
  },
  "fabric-care-services": {
    bookingNoun: "order",
    bookingPolicy:
      "Sending a request shares your service details with the team; any drop-off, pickup, or claim-ticket details are confirmed before work starts.",
    cancellationPolicy:
      "Need to change pickup, delivery, or a ready-by request? Contact us using the details below as early as you can.",
    dietaryNote: null,
    paymentNote:
      "No payment is taken to send this request. Cleaning, alteration, and delivery fees are handled directly with the business.",
    accountPurpose: "manage your garment orders, pickup requests, and claim-ticket updates",
  },
  "agriculture-ranching": {
    bookingNoun: "request",
    bookingPolicy:
      "Sending a request shares your product, livestock, grazing, or service needs with the farm; availability, timing, handling, and terms are confirmed before anything is committed.",
    cancellationPolicy:
      "Weather, animal welfare, field conditions, and market timing can change availability. Contact the farm promptly if your requirements or timing change.",
    dietaryNote: null,
    paymentNote:
      "No payment is taken to send this request. Price, delivery, pickup, and any deposit are agreed directly with the farm.",
    accountPurpose: "manage your farm product, livestock, and service requests",
  },
  "manufacturing": {
    bookingNoun: "engineering request",
    bookingPolicy:
      "Sending a request shares your application and commercial requirements with the manufacturer; configuration, feasibility, lead time, acceptance criteria, and terms are confirmed before anything is committed.",
    cancellationPolicy:
      "Contact the manufacturer promptly when requirements or timing change. Engineering release, committed materials, and work already performed may affect what can be changed or cancelled.",
    dietaryNote: null,
    paymentNote:
      "No payment is taken to send this request. Price, deposit, milestones, freight, and payment terms are agreed in the formal quotation or order acknowledgement.",
    accountPurpose: "manage your product enquiries, quotations, orders, documentation, and lifecycle-support requests",
  },
};

const TRUST_BY_ARCHETYPE: Record<string, Partial<TrustProfile>> = {
  "pet-rescue": {
    bookingNoun: "request",
    bookingPolicy:
      "Sending an adoption or surrender enquiry shares your details with the rescue team. It does not reserve an animal or guarantee intake.",
    cancellationPolicy:
      "If your circumstances change, contact the rescue promptly so the team can update your enquiry and plan care safely.",
    paymentNote:
      "No payment is taken to send an adoption or surrender enquiry. Donation amounts and any adoption fees are shown before you confirm them.",
    accountPurpose: "manage your adoption, surrender, volunteer, and support enquiries",
    policyLinkLabel: "Adoption & surrender",
    pageTitle: "Policies & supporter information",
    pageIntro:
      "How we handle adoption and surrender enquiries, donations, your information, and getting in touch.",
    policyHeading: "Adoption & surrender",
    privacyRequestKinds: "adoption, surrender, volunteer, donation, or other enquiry",
    termsPolicy:
      "Submitting an enquiry is a request, not a guarantee of adoption or intake. Decisions depend on animal welfare, available capacity, and a safe fit. Donation and adoption-fee terms are shown before confirmation.",
    contactPrompt: "Questions about adopting, surrendering, or supporting?",
  },
  "animal-shelter": {
    bookingNoun: "request",
    policyLinkLabel: "Adoption & surrender",
    pageTitle: "Policies & supporter information",
    pageIntro:
      "How we handle adoption and surrender enquiries, donations, your information, and getting in touch.",
    policyHeading: "Adoption & surrender",
    privacyRequestKinds: "adoption, surrender, volunteer, donation, or other enquiry",
    termsPolicy:
      "Submitting an enquiry is a request, not a guarantee of adoption or intake. Decisions depend on animal welfare, available capacity, and a safe fit.",
    contactPrompt: "Questions about adopting, surrendering, or supporting?",
  },
};

/** Resolve category defaults, then the more specific leaf archetype override. */
export function resolveTrustProfile(
  category: string | null | undefined,
  archetypeId?: string | null,
): TrustProfile {
  return {
    ...GENERIC_TRUST,
    ...(TRUST_BY_CATEGORY[category ?? ""] ?? {}),
    ...(TRUST_BY_ARCHETYPE[archetypeId ?? ""] ?? {}),
  };
}

/**
 * Load the storefront's confirmed weekly opening hours for public display, or
 * null when the operator has not confirmed hours. We never render the generic
 * 9–5 default publicly — showing invented hours would be a trust regression.
 */
export async function getPublicOperatingHours(): Promise<WeeklySchedule | null> {
  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    select: { businessHours: true, hoursConfirmedAt: true },
  });
  if (!profile?.hoursConfirmedAt || !profile.businessHours) return null;
  return profileHoursToSchedule(
    profile.businessHours as Record<string, { open: string; close: string } | null>,
  );
}
