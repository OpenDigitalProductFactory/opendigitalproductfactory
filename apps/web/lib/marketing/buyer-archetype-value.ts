// Buyer-archetype value catalog (BI-B4BE6934, EP-5CC9C184).
//
// Every other archetype markets its OWN offer to its own customers: a dental
// practice markets checkups to patients. A business whose offer IS the platform
// — the vendor, or an MSP/IT partner reselling it — is different: its buyers
// are themselves businesses of every archetype, and an HVAC contractor buys for
// a different reason than a dental practice. Without this catalog the vendor's
// marketing coworker had one generic message and, finding nothing better,
// invented a "Series A SaaS engineering leader" buyer the business does not
// serve.
//
// One entry per archetype category: who those businesses are, why the platform
// matters to their owner, what marketing to them should emphasise, and the
// claim boundary that keeps the copy to what is true today. Content is distilled
// from docs/marketing/archetype-owner-quick-guide.md and the "do not overclaim"
// column of docs/architecture/archetype-owner-positioning.md; THIS module is the
// product source, and the guide points here.
//
// Pure data + pure helpers: safe to import from client and server code.

import { ALL_ARCHETYPES, type ArchetypeCategory } from "@dpf/storefront-templates";

export type BuyerArchetypeValue = {
  category: ArchetypeCategory;
  /** Plain label for the buyer group, e.g. "Trades and maintenance businesses". */
  label: string;
  /** Who these businesses are, in one clause. */
  whoTheyAre: string;
  /** Why the platform matters to this owner — the benefit, in their terms. */
  ownerValue: string;
  /** What marketing to this buyer should show and stress. */
  emphasize: string;
  /** What copy to this buyer must not claim. Category-specific; universal limits live in PLATFORM_CLAIM_LIMITS. */
  claimBoundary?: string;
};

/**
 * The platform's product names. A business whose own offer names one of these
 * sells the platform itself (vendor or reselling partner). Matched against the
 * organization's own offer records, never against an install identity.
 */
export const PLATFORM_PRODUCT_NAMES = ["Digital Product Factory", "DPF"] as const;

/** Limits that apply to every buyer, from the positioning doc's "do not overclaim" column. */
export const PLATFORM_CLAIM_LIMITS =
  "Do not claim unreviewed public publishing, finished channel integrations, attribution or automatic posting, unrestricted coworker authority, or that the platform replaces core systems (EHR, core banking, ticketing seat maps, payment rails, payroll, full accounting). Humans approve consequential actions.";

export const BUYER_ARCHETYPE_VALUE: Record<ArchetypeCategory, BuyerArchetypeValue> = {
  "software-platform": {
    category: "software-platform",
    label: "Software and product-led businesses",
    whoTheyAre: "SaaS and product-led businesses selling, supporting, learning from and improving a digital product",
    ownerValue: "Demos, support signals, pilot feedback, releases and roadmap requests become governed product work instead of scattered threads",
    emphasize: "Customer signal becoming product action: inquiry to inbox to backlog, with the human deciding what ships",
  },
  "trades-maintenance": {
    category: "trades-maintenance",
    label: "Trades and maintenance businesses",
    whoTheyAre: "Field and property service businesses where urgent work, quotes, dispatch, parts and customer updates drive trust",
    ownerValue: "Intake, urgency, technician readiness, quote follow-up, restock signals and customer ETA drafts get organised while the owner stays on the tools or with the crew",
    emphasize: "The van or shop moment: the job comes in, the coworker prepares it, the owner approves the quote and the customer update",
    claimBoundary: "Licensed work stays with licensed people; the coworker prepares, it does not certify",
  },
  "beauty-personal-care": {
    category: "beauty-personal-care",
    label: "Salons, barbers, spas and personal care",
    whoTheyAre: "Appointment businesses where revenue depends on filled calendars, repeat clients, provider availability and reputation",
    ownerValue: "The schedule is protected: gaps surface early, rebooking and reactivation messages are drafted, provider availability stays straight",
    emphasize: "The owner between clients approving follow-ups; fewer empty chairs and no-shows",
  },
  "healthcare-wellness": {
    category: "healthcare-wellness",
    label: "Healthcare and wellness practices",
    whoTheyAre: "Trust-heavy care practices where encounter readiness, forms, reminders, follow-up and safety boundaries matter",
    ownerValue: "Operational readiness and follow-up are prepared while clinical judgment stays with qualified people",
    emphasize: "Readiness boards, missing-form and reminder follow-up, practitioner load, and safe escalation",
    claimBoundary: "No diagnosis, clinical advice or crisis response; the platform does not replace an EHR",
  },
  "pet-services": {
    category: "pet-services",
    label: "Pet care businesses",
    whoTheyAre: "Grooming, walking, boarding and mobile vet businesses that need pet-specific context on every booking",
    ownerValue: "Each pet's profile, care notes and special needs stay attached to appointments, stays and recurring walks",
    emphasize: "A named pet's profile beside the schedule; nothing about the animal gets lost between visits",
  },
  "food-hospitality": {
    category: "food-hospitality",
    label: "Restaurants, caterers and bakeries",
    whoTheyAre: "Food businesses mixing reservations, production, custom orders, events, allergies and rush-period coordination",
    ownerValue: "Bookings, quotes and orders arrive already sorted, so the owner stops interpreting every request from scratch",
    emphasize: "Kitchen and front-counter pressure eased: party size, event details, custom orders and dietary notes captured up front",
  },
  "retail-goods": {
    category: "retail-goods",
    label: "Retailers, makers and distributors",
    whoTheyAre: "Product sellers balancing merchandising, stock, receiving, orders, returns, delivery and repeat buyers",
    ownerValue: "Stock, orders, returns, transfers and demand-aware campaign ideas become a short owner action list",
    emphasize: "The shop floor plus the few stock and order exceptions that need the owner today",
  },
  "fitness-recreation": {
    category: "fitness-recreation",
    label: "Gyms, studios and recreation",
    whoTheyAre: "Class and membership businesses where retention, attendance, capacity and renewals drive revenue",
    ownerValue: "Renewal risk, attendance dips, capacity problems and reactivation chances surface before they become churn",
    emphasize: "The owner after class seeing which members to call this week",
  },
  "education-training": {
    category: "education-training",
    label: "Schools, tutors and training providers",
    whoTheyAre: "Instruction businesses coordinating learners, payers, instructors, locations, levels and cohorts",
    ownerValue: "Learner, parent, payer, instructor and location context stay separate, so scheduling and qualification fit",
    emphasize: "Lesson and programme readiness without mixing up who learns, who pays and who teaches",
  },
  "professional-services": {
    category: "professional-services",
    label: "Professional and expert services firms",
    whoTheyAre: "Expert-led firms that sell trust, scope work, deliver expertise and manage retainers or milestones",
    ownerValue: "Loose inquiries become scoped engagement briefs, proposal drafts, proof prompts and retainer visibility",
    emphasize: "The expert reviewing a ready proposal instead of writing it from a blank page",
    claimBoundary: "Legal, accounting and licensed judgments stay with the qualified professional",
  },
  "nonprofit-community": {
    category: "nonprofit-community",
    label: "Nonprofits, clubs and community organisations",
    whoTheyAre: "Mission and member organisations coordinating donors, volunteers, beneficiaries, programmes and governance",
    ownerValue: "Asking, thanking, receipting, scheduling and reporting get coordinated without treating supporters as ordinary customers",
    emphasize: "Donor, volunteer and programme coordination that respects the mission's own language",
  },
  "agriculture-ranching": {
    category: "agriculture-ranching",
    label: "Farms and ranches",
    whoTheyAre: "Owner-operated farms and ranches coordinating land, crops, livestock, equipment, inputs, weather and markets",
    ownerValue: "One Now / Next / Season horizon, with evidence and coordination prepared for the owner's decision",
    emphasize: "The next constrained window on the land, herd or equipment, laid out before the owner commits",
    claimBoundary: "No veterinary, pesticide, legal, market or spending authority; outside-service drafts stay approval-gated",
  },
  "hoa-property-management": {
    category: "hoa-property-management",
    label: "HOAs and property managers",
    whoTheyAre: "Community and property operators handling resident requests, units, dues, violations, vendors and notices",
    ownerValue: "Requests arrive with resident and property context, and vendor work, amenity bookings and dues questions get routed",
    emphasize: "A resident request board that is already sorted by property, urgency and who owns it",
  },
  "banking-financial-services": {
    category: "banking-financial-services",
    label: "Community banks, credit unions and lenders",
    whoTheyAre: "Relationship-based institutions where growth depends on trust, KYC, disclosures and regulated service boundaries",
    ownerValue: "Intake, education, relationship follow-up, campaigns and disclosure readiness are prepared around the core system",
    emphasize: "Relationship-opening readiness with disclosure framing already in place",
    claimBoundary: "Not core banking; no rate, legal or financial advice",
  },
  "public-sector": {
    category: "public-sector",
    label: "Towns, utilities and public bodies",
    whoTheyAre: "Public bodies serving residents, ratepayers, permit applicants and records requesters under statute",
    ownerValue: "Service requests, notices, permits, utility issues and records requests get routed in public-body language",
    emphasize: "Resident-service and utility request coordination with statutory framing",
    claimBoundary: "Respect public-records and meeting rules; law-enforcement criminal-justice data is out of scope",
  },
  "asset-rental": {
    category: "asset-rental",
    label: "Equipment rental and self-storage",
    whoTheyAre: "Businesses that earn through availability, reservations, pickup and return, inspection and occupancy",
    ownerValue: "The reserve-use-return-inspect loop is protected so assets get back to earning and conflicts surface early",
    emphasize: "The rental yard or storage board: what is out, what is due back, what needs inspection",
  },
  "real-estate-construction": {
    category: "real-estate-construction",
    label: "Home builders",
    whoTheyAre: "Builders selling high-trust projects and coordinating tours, selections, milestones, subcontractors and draws",
    ownerValue: "Model-home or design interest connects to project milestones, draw readiness, subcontractor tasks and client follow-up",
    emphasize: "The builder's view from first tour to handover, with the next client update drafted",
  },
  "automotive-services": {
    category: "automotive-services",
    label: "Mobile and urgent vehicle services",
    whoTheyAre: "Mobile and urgent vehicle-service businesses driven by location, vehicle details, parts, ETA and trust",
    ownerValue: "Vehicle and service context is captured, dispatch is route-aware, and customer updates are drafted",
    emphasize: "Mobile dispatch with the vehicle details and parts already lined up",
    claimBoundary: "Honest diagnosis language; certification and bonding prompts are reminders, not certification",
  },
  "moving-and-logistics": {
    category: "moving-and-logistics",
    label: "Movers, couriers and logistics",
    whoTheyAre: "Route, crew, truck and delivery businesses where estimates, timing and customer anxiety dominate the day",
    ownerValue: "Inquiry details become route and load plans, capacity checks, status updates and post-job follow-up",
    emphasize: "Route and load coordination that keeps the customer informed without the owner on the phone",
  },
  "security-services": {
    category: "security-services",
    label: "Guarding and security installers",
    whoTheyAre: "Coverage businesses responsible for posts, patrols, incidents, installs, monitoring handoff and licensing",
    ownerValue: "Coverage and documentation tasks are watched so gaps are caught before a client notices",
    emphasize: "Site coverage and incident review in a calm, credible tone",
    claimBoundary: "No fear-driven messaging or claims of security authority",
  },
  "media-production": {
    category: "media-production",
    label: "Film, post-production and event production",
    whoTheyAre: "Creative production businesses coordinating briefs, crews, suites, gear, review rounds, rights and deadlines",
    ownerValue: "Production bottlenecks stay visible, approval nudges are drafted, and delivery ties to milestone and invoice readiness",
    emphasize: "A production timeline where nothing waits silently on a client approval",
  },
  "live-events-venues": {
    category: "live-events-venues",
    label: "Venues, promoters and booking agencies",
    whoTheyAre: "Calendar-driven event businesses managing dates, holds, capacity, staffing, contracts and guest experience",
    ownerValue: "Date conflicts are avoided, readiness is watched, and booking follow-up is prepared",
    emphasize: "A venue calendar or tour board where holds and readiness are never a surprise",
    claimBoundary: "No seat maps, full ticketing or settlement",
  },
  "fabric-care-services": {
    category: "fabric-care-services",
    label: "Dry cleaners and laundries",
    whoTheyAre: "Plant-and-store networks where garments move by claim ticket from drop-off through the plant to a promised ready date",
    ownerValue: "Claim tickets, ready-by promises, pickup routes and exceptions stay visible across the plant and every store",
    emphasize: "A garment's promised ready date kept, and the customer told early when it will not be",
  },
  "warehousing-fulfilment": {
    category: "warehousing-fulfilment",
    label: "3PL warehouses and fulfilment",
    whoTheyAre: "Contract warehouses storing, receiving, picking and despatching goods for client businesses",
    ownerValue: "Goods-in, stock visibility, pick-and-despatch exceptions and client reporting come together in one owner view",
    emphasize: "The client account view: what arrived, what shipped, and what needs the owner's call",
  },
  manufacturing: {
    category: "manufacturing",
    label: "Manufacturers and equipment OEMs",
    whoTheyAre: "Industrial manufacturers building configured equipment, product families and prototypes for business customers",
    ownerValue: "Inquiries, configuration questions, prototype builds and customer follow-up become governed work the owner can see",
    emphasize: "Customer inquiry to configured quote and build readiness",
    claimBoundary: "Manufacturing vertical readiness is still open; position as early adoption, not a finished vertical",
  },
};

/** The buyer catalog in a stable order (alphabetical by label) for prompts and tools. */
export function listBuyerArchetypeValues(): BuyerArchetypeValue[] {
  return Object.values(BUYER_ARCHETYPE_VALUE).sort((a, b) => a.label.localeCompare(b.label));
}

export function getBuyerArchetypeValue(category: string | null | undefined): BuyerArchetypeValue | null {
  if (!category) return null;
  return (BUYER_ARCHETYPE_VALUE as Record<string, BuyerArchetypeValue | undefined>)[category] ?? null;
}

function phrasePattern(literal: string, options?: { plural?: boolean }): RegExp {
  const escaped = literal
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  // Briefs name buyers in the plural ("HVAC contractors", "dental practices").
  const plural = options?.plural ? "(?:s|es)?" : "";
  return new RegExp(`(?<![\\w-])${escaped}${plural}(?![\\w-])`, "i");
}

const PLATFORM_NAME_PATTERNS = PLATFORM_PRODUCT_NAMES.map((name) => phrasePattern(name));

/**
 * True when the organization's own offer is the platform — it sells, resells or
 * implements the Digital Product Factory. Decided from its own offer text
 * (storefront offers, tagline, value proposition), never from install identity,
 * so the vendor and every reselling partner are treated alike.
 */
export function sellsThePlatform(ownOffer: string | null | undefined): boolean {
  if (!ownOffer || ownOffer.trim().length === 0) return false;
  return PLATFORM_NAME_PATTERNS.some((pattern) => pattern.test(ownOffer));
}

// Match vocabulary per category: the catalog label words people actually write
// plus every leaf archetype's name, read from the archetype catalog itself so a
// new leaf is recognised without editing this file.
type BuyerMatcher = { category: ArchetypeCategory; phrase: string; pattern: RegExp };

const BUYER_MATCHERS: BuyerMatcher[] = (() => {
  const phrases = new Map<string, ArchetypeCategory>();
  for (const archetype of ALL_ARCHETYPES) {
    const category = archetype.category as ArchetypeCategory;
    phrases.set(archetype.name.toLowerCase(), category);
    phrases.set(archetype.archetypeId.replace(/-/g, " ").toLowerCase(), category);
  }
  for (const value of Object.values(BUYER_ARCHETYPE_VALUE)) {
    phrases.set(value.label.toLowerCase(), value.category);
    phrases.set(value.category.replace(/-/g, " "), value.category);
  }
  return [...phrases.entries()]
    .filter(([phrase]) => phrase.length >= 4)
    // Longest phrase first: "mobile pet grooming" must win over "pet grooming".
    .sort((a, b) => b[0].length - a[0].length)
    .map(([phrase, category]) => ({ category, phrase, pattern: phrasePattern(phrase, { plural: true }) }));
})();

/**
 * Resolve which buyer archetype a brief or audience line is aimed at, e.g.
 * "HVAC contractors in Texas" → trades-maintenance. Returns null when the text
 * names no archetype (a general campaign) — callers then use the strategy's
 * general audience rather than guessing one.
 */
export function resolveBuyerArchetype(text: string | null | undefined): BuyerArchetypeValue | null {
  if (!text || text.trim().length === 0) return null;
  for (const matcher of BUYER_MATCHERS) {
    if (matcher.pattern.test(text)) return BUYER_ARCHETYPE_VALUE[matcher.category];
  }
  return null;
}

/** Prompt lines describing one buyer, for drafters and coworker context. */
export function describeBuyerForPrompt(value: BuyerArchetypeValue): string {
  return [
    `Buyer: ${value.label} — ${value.whoTheyAre}.`,
    `Why the platform matters to this owner: ${value.ownerValue}.`,
    `Emphasise: ${value.emphasize}.`,
    value.claimBoundary ? `Do not claim: ${value.claimBoundary}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
