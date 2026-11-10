// What a business actually DOES, derived from its archetype (BI-0902BAE9).
//
// Some decisions only exist because of an activity. "Under what conditions may
// we capture an employee's location?" is a real question for a business whose
// people drive to customer sites, and meaningless for one whose people do not.
// On the customer 0 install — a software platform — six such questions reached
// the owner and sat unanswerable, because the archetype has none of the
// underlying activity (BI-13C38318).
//
// So the unit that decides whether a stance is seeded is the ACTIVITY, and the
// activity is DERIVED. It is not confirmed: a trades business obviously sends
// workers to customer sites, and asking is a tax rather than a gate — the same
// defect as any other queue item put to a human that carries no decision.
// Setup therefore asks whether an activity applies exactly never.
//
// Seeding per archetype directly would mean twenty-five near-duplicate copies
// of each posture, drifting apart as they are edited. Seeding per derived
// activity keeps ONE well-written posture per class and applies it precisely
// where it is real.

/**
 * The activities that create decision classes a business must have a posture
 * on. Deliberately small and observable — each earns its place by making some
 * decision necessary that would otherwise be meaningless, and a reader should
 * be able to say yes or no about a business without interpretation.
 */
export const BUSINESS_ACTIVITIES = [
  /** People travel to a customer's home, site or premises to do the work. */
  "workers-at-customer-sites",
  /** Work is evidenced with photos, video or recordings taken on the job. */
  "evidence-media-capture",
  /** We hold personal data about people who are not our customers — a
   *  customer's residents, tenants, patients' families, a client's staff. */
  "third-party-personal-data",
] as const;
export type BusinessActivity = (typeof BUSINESS_ACTIVITIES)[number];

/**
 * How sure the derivation is.
 *
 * `certain` and `absent` are acted on silently. Only `ambiguous` may ever reach
 * a person, and then at the point of use — the first time a decision in that
 * class actually arises — never as a setup question every install pays for to
 * catch the few that are genuinely mixed.
 */
export type ActivityConfidence = "certain" | "ambiguous" | "absent";

export type ActivityDerivation = {
  activity: BusinessActivity;
  confidence: ActivityConfidence;
  /** Why, in the owner's terms — shown if we ever do have to ask. */
  because: string;
};

type ActivityProfile = Partial<Record<BusinessActivity, ActivityConfidence>>;

/**
 * Industry → activities. Keyed on the same industry ids as INDUSTRY_PROFILES in
 * archetype-business-context, so there is one archetype vocabulary rather than
 * a second one to keep in step.
 *
 * An industry absent from this map derives every activity as `absent`: a
 * business we have not characterised is not assumed to send people to customer
 * sites. Silence means no, and the seeding stays conservative.
 */
const INDUSTRY_ACTIVITIES: Record<string, ActivityProfile> = {
  // ── Work happens at the customer's place ─────────────────────────────────
  "trades-maintenance": {
    "workers-at-customer-sites": "certain",
    "evidence-media-capture": "certain",
    "third-party-personal-data": "ambiguous",
  },
  "real-estate-construction": {
    "workers-at-customer-sites": "certain",
    "evidence-media-capture": "certain",
    "third-party-personal-data": "ambiguous",
  },
  "hoa-property-management": {
    "workers-at-customer-sites": "certain",
    "evidence-media-capture": "certain",
    // The defining case: the residents whose data is held are not the customer.
    "third-party-personal-data": "certain",
  },
  "moving-and-logistics": {
    "workers-at-customer-sites": "certain",
    "evidence-media-capture": "certain",
  },
  "security-services": {
    "workers-at-customer-sites": "certain",
    "evidence-media-capture": "certain",
    "third-party-personal-data": "certain",
  },
  "automotive-services": {
    // Mobile and roadside work is common enough to be real, not universal.
    "workers-at-customer-sites": "ambiguous",
    "evidence-media-capture": "certain",
  },
  "agriculture-ranching": {
    "workers-at-customer-sites": "ambiguous",
    "evidence-media-capture": "ambiguous",
  },
  "pet-services": {
    // Home visits, walking and mobile grooming sit alongside premises work.
    "workers-at-customer-sites": "ambiguous",
    "evidence-media-capture": "certain",
  },
  "healthcare-wellness": {
    // Home care and domiciliary visits; and patient data is third-party
    // whenever the payer or care recipient is not the same person.
    "workers-at-customer-sites": "ambiguous",
    "third-party-personal-data": "certain",
  },
  "media-production": {
    "workers-at-customer-sites": "certain",
    "evidence-media-capture": "certain",
    // Filming captures people who never signed anything with us.
    "third-party-personal-data": "certain",
  },
  "live-events-venues": {
    "workers-at-customer-sites": "ambiguous",
    "evidence-media-capture": "certain",
    "third-party-personal-data": "certain",
  },
  "professional-services": {
    // Genuinely mixed: some practices are entirely remote, others are on-site
    // most weeks. This is the case the lazy ask exists for.
    "workers-at-customer-sites": "ambiguous",
    "third-party-personal-data": "ambiguous",
  },
  "education-training": {
    "third-party-personal-data": "certain",
  },
  "public-sector": {
    "workers-at-customer-sites": "ambiguous",
    "third-party-personal-data": "certain",
  },
  "nonprofit-community": {
    "workers-at-customer-sites": "ambiguous",
    "third-party-personal-data": "certain",
  },
  "banking-financial-services": {
    "third-party-personal-data": "certain",
  },

  // ── Work happens at our place, or has no place at all ────────────────────
  "software-platform": {},
  "retail-goods": {},
  "ecommerce-general": {},
  "food-hospitality": {},
  "beauty-personal-care": {},
  "fitness-recreation": {},
  "fabric-care-services": {},
  "manufacturing": {},
  "warehousing-fulfilment": {},
  "asset-rental": {},
};

/**
 * Derive one activity for an industry. Absent from the map, or absent from that
 * industry's profile, both mean `absent` — we never assume an activity a
 * business has not been characterised as having.
 */
export function deriveActivity(input: {
  industry?: string | null;
  activity: BusinessActivity;
}): ActivityDerivation {
  const profile = input.industry ? INDUSTRY_ACTIVITIES[input.industry] : undefined;
  const confidence = profile?.[input.activity] ?? "absent";
  return {
    activity: input.activity,
    confidence,
    because:
      confidence === "absent"
        ? `A ${input.industry ?? "business"} of this kind does not normally do this, so nothing is assumed.`
        : confidence === "certain"
          ? `This is how a ${input.industry} normally works, so it is taken as given rather than asked.`
          : `Businesses of this kind differ, so this is settled the first time it actually matters — not at setup.`,
  };
}

/** Every activity derivation for an industry, in declaration order. */
export function deriveActivities(input: { industry?: string | null }): ActivityDerivation[] {
  return BUSINESS_ACTIVITIES.map((activity) => deriveActivity({ industry: input.industry, activity }));
}

/**
 * Should a stance requiring this activity be seeded?
 *
 * `certain` seeds. `ambiguous` ALSO seeds — a mixed business is better served
 * by a sensible default it can edit than by silence, and the cost of a stance
 * it does not need is one card, while the cost of missing one is an
 * unanswerable escalation. `absent` does not seed, which is what keeps a
 * software platform from being handed a worker-location posture.
 */
export function seedsForActivity(confidence: ActivityConfidence): boolean {
  return confidence !== "absent";
}

/** Activities whose applicability genuinely cannot be derived for an industry. */
export function ambiguousActivities(input: { industry?: string | null }): BusinessActivity[] {
  return deriveActivities(input)
    .filter((entry) => entry.confidence === "ambiguous")
    .map((entry) => entry.activity);
}
