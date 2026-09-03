// apps/web/lib/owner-first/vocabulary.ts
//
// Owner-first vocabulary for the major business-domain pages (BI-3BCAF95F,
// EP-UX-COGLOAD). The domain pages (/workspace, /customer, /employee, /finance)
// still open in professional subsystem language — CRM, HR, accountant lanes. A
// non-technical owner has to translate that into "what do I do today". This
// module resolves the archetype into the owner's own words for each domain so
// the owner-first summaries can lead with them.
//
// Restaurant/Venue Portal (`food-hospitality`) is the calibration archetype the
// live audit was run against, so it gets first-class vocabulary here. Every other
// archetype falls back to a neutral small-business default — the summaries stay
// owner-first everywhere, they just don't borrow restaurant nouns.

/** The archetype category the live UX audit calibrated against. */
export const RESTAURANT_ARCHETYPE_CATEGORY = "food-hospitality";

export type OwnerDomainVocabulary = {
  /** True when the install is the Restaurant/Venue Portal archetype. */
  isRestaurant: boolean;
  category: string | null;
  /** The people the business serves. */
  guestsLabel: string;
  /** Customer-domain daily work. */
  guestFollowUpLabel: string;
  customerSummarySubhead: string;
  reservationsLabel: string;
  ordersLabel: string;
  inquiriesLabel: string;
  /** People-domain daily work. */
  staffLabel: string;
  serviceReadinessLabel: string;
  timesheetLabel: string;
  /** Finance-domain daily work. */
  billsLabel: string;
  depositsLabel: string;
  invoicesLabel: string;
};

const RESTAURANT_VOCABULARY: OwnerDomainVocabulary = {
  isRestaurant: true,
  category: RESTAURANT_ARCHETYPE_CATEGORY,
  guestsLabel: "guests",
  guestFollowUpLabel: "Guest follow-up",
  customerSummarySubhead: "Guests waiting on you — reservations, orders, and inquiries first.",
  reservationsLabel: "reservations",
  ordersLabel: "orders",
  inquiriesLabel: "inquiries",
  staffLabel: "service staff",
  serviceReadinessLabel: "Next service readiness",
  timesheetLabel: "shift hours",
  billsLabel: "bills",
  depositsLabel: "deposits",
  invoicesLabel: "invoices",
};

const DEFAULT_VOCABULARY: OwnerDomainVocabulary = {
  isRestaurant: false,
  category: null,
  guestsLabel: "customers",
  guestFollowUpLabel: "Customer follow-up",
  customerSummarySubhead: "Customers waiting on you first — the rest of your CRM is below.",
  reservationsLabel: "bookings",
  ordersLabel: "orders",
  inquiriesLabel: "inquiries",
  staffLabel: "team",
  serviceReadinessLabel: "Team readiness",
  timesheetLabel: "timesheets",
  billsLabel: "bills",
  depositsLabel: "deposits",
  invoicesLabel: "invoices",
};

const PET_RESCUE_VOCABULARY: OwnerDomainVocabulary = {
  isRestaurant: false,
  category: "nonprofit-community",
  guestsLabel: "people & partners",
  guestFollowUpLabel: "Adoption follow-up",
  customerSummarySubhead: "Adopters, foster families, volunteers, donors, and partners waiting on you first.",
  reservationsLabel: "adoption visits",
  ordersLabel: "supply requests",
  inquiriesLabel: "adoption enquiries",
  staffLabel: "team & volunteers",
  serviceReadinessLabel: "Care readiness",
  timesheetLabel: "team hours",
  billsLabel: "care bills",
  depositsLabel: "donations",
  invoicesLabel: "commitments",
};

/**
 * Resolve the owner-first vocabulary for an archetype category. Restaurant/Venue
 * Portal installs (`food-hospitality`) get restaurant nouns; everything else
 * gets a neutral small-business default (still owner-first, just archetype-neutral).
 */
export function resolveOwnerVocabulary(
  category: string | null | undefined,
  archetypeId?: string | null,
): OwnerDomainVocabulary {
  if (["pet-rescue", "animal-shelter"].includes((archetypeId ?? "").trim().toLowerCase())) {
    return { ...PET_RESCUE_VOCABULARY, category: category ?? null };
  }
  if ((category ?? "").trim().toLowerCase() === RESTAURANT_ARCHETYPE_CATEGORY) {
    return RESTAURANT_VOCABULARY;
  }
  return { ...DEFAULT_VOCABULARY, category: category ?? null };
}
