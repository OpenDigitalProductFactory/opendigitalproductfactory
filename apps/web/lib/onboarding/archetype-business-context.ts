// Archetype-intelligent business context for onboarding.
//
// One source of business-model-aware starter doctrine, keyed by archetype
// category (and, for a few flagship archetypes, the specific slug). It feeds:
//   - suggestMission()         → the mission starter on the business-context form
//   - seedOrgWwwdCorpus()      → the org-overlay WWWD wiki page bodies
//
// The goal: a fresh install's WWWD corpus reads like it already understands the
// operator's line of work — appointment-based care reads differently from
// project-based professional services, which reads differently from
// transactional retail — so new users feel understood on day one. Everything
// here is an EDITABLE STARTER; the operator refines it.
//
// EXTENDING (the "periodical seed refresh" the founder asked for): as archetypes
// evolve, (a) add/adjust an INDUSTRY_PROFILES entry for a new category, and/or
// (b) add an ARCHETYPE_PROFILES override (merged over its industry profile) to
// deepen a specific business model. Keep entries to broad, true, editable
// starters — do not encode brittle specifics that read as fabricated.

export type ArchetypeBusinessProfile = {
  /** Completes the clause "we exist to …". */
  missionTheme: string;
  /** One-line characterisation of the revenue / operating model. */
  businessModel: string;
  /** Who-we-serve stance body (markdown paragraph). */
  whoWeServe: string;
  /** How-we-decide stance body — the trade-offs this business model leans on. */
  howWeDecide: string;
};

export const GENERIC_BUSINESS_PROFILE: ArchetypeBusinessProfile = {
  missionTheme:
    "deliver real value to the people we serve and build a business we are proud of",
  businessModel:
    "We earn trust by doing good work for the people we serve and being worth coming back to.",
  whoWeServe:
    "We serve the people and stakeholders our business exists to help — the customers, clients, and community who rely on what we do.",
  howWeDecide:
    "We start from our mission and the people we serve, prefer durable quality over shortcuts, stay transparent about trade-offs, and keep humans in final authority over consequential calls.",
};

// ─── Industry-category profiles (the 9 archetype categories) ─────────────────

const INDUSTRY_PROFILES: Record<string, ArchetypeBusinessProfile> = {
  "healthcare-wellness": {
    missionTheme:
      "deliver attentive, high-quality care that improves the health and wellbeing of every patient",
    businessModel:
      "Care is delivered through booked appointments and ongoing treatment relationships; reputation and continuity drive repeat visits and referrals.",
    whoWeServe:
      "We serve patients and their families who trust us with their health. Many return over time, so each visit is part of a longer relationship, not a one-off transaction.",
    howWeDecide:
      "Patient safety and clinical quality come first — always. After that we weigh access, continuity of care, and a calm, respectful experience. We never trade a patient's wellbeing for speed or margin, and we are transparent when something is uncertain.",
  },
  "beauty-personal-care": {
    missionTheme:
      "help every client look and feel their best through skilled, personal service",
    businessModel:
      "Revenue comes from booked appointments and walk-ins; loyalty and word-of-mouth are built one great experience at a time.",
    whoWeServe:
      "We serve clients who want to look and feel good and who come back when they trust our hands and enjoy the experience. Regulars are the heart of the business.",
    howWeDecide:
      "We decide for the client's confidence and the personal relationship: skilled work, a welcoming chair, honest advice about what will suit them, and a result they are proud to show off. Repeat trust beats a one-time upsell.",
  },
  "fitness-recreation": {
    missionTheme:
      "help our members move, train, and live healthier, more active lives",
    businessModel:
      "A membership / recurring model — long-term member results and retention matter far more than one-off sign-ups.",
    whoWeServe:
      "We serve members on a journey — from first-timers to regulars — who want to get stronger, healthier, and more confident. Their progress and sense of belonging keep them with us.",
    howWeDecide:
      "We decide for member results and a welcoming, motivating community. We favour what keeps people coming back and progressing over what merely sells a membership, and we keep the space safe, clean, and encouraging.",
  },
  "food-hospitality": {
    missionTheme:
      "create welcoming experiences and food and hospitality our guests come back for",
    businessModel:
      "High-volume service where consistency, speed, and repeat custom drive the business; a great visit earns the next one.",
    whoWeServe:
      "We serve guests who choose to spend their time and money with us — locals, regulars, and first-timers we want to turn into regulars. Every guest's experience is the product.",
    howWeDecide:
      "We decide for the guest experience and consistency: quality and hospitality every time, cleanliness and safety without compromise, and speed that never costs care. A guest who leaves happy is the whole point.",
  },
  "professional-services": {
    missionTheme:
      "deliver expert advice and dependable service that helps our clients succeed",
    businessModel:
      "Project- and retainer-based expertise; the business runs on trust, reputation, and long-term client relationships.",
    whoWeServe:
      "We serve clients who hire us for judgment and results they cannot easily get elsewhere. The relationship is built on trust and tends to compound over years and referrals.",
    howWeDecide:
      "We decide for client success and long-term trust over a quick win. We give honest advice even when it is not what the client hoped to hear, protect confidentiality, and stand behind the quality of our work.",
  },
  "hoa-property-management": {
    missionTheme:
      "care for the properties and communities entrusted to us so owners and residents can thrive",
    businessModel:
      "Ongoing stewardship of properties on behalf of owners and residents; responsiveness and fairness sustain the relationship.",
    whoWeServe:
      "We serve property owners who trust us with a major asset and the residents who live there. We answer to both, and balancing their interests fairly is the job.",
    howWeDecide:
      "We decide to protect the asset, treat residents fairly, and respond quickly when something needs attention. We are transparent about costs and decisions, and we hold the long-term health of the property above any short-term convenience.",
  },
  "education-training": {
    missionTheme:
      "help our learners grow, in a safe and supportive environment",
    businessModel:
      "Enrolment- and term-based; the business is sustained by learner progress and the trust of families and learners.",
    whoWeServe:
      "We serve learners and the families who entrust them to us. Their growth, safety, and confidence are why we exist, and their progress is our reputation.",
    howWeDecide:
      "We decide for the learner's growth and wellbeing first. Safety and care are non-negotiable; beyond that we favour what genuinely helps people learn over what is merely convenient to deliver.",
  },
  "retail-goods": {
    missionTheme:
      "offer products our customers love, backed by service they can trust",
    businessModel:
      "Transactional sales with repeat custom; product quality, fair value, and service turn a first purchase into a returning customer.",
    whoWeServe:
      "We serve customers looking for products they can rely on at a fair price, with help when they need it. Repeat buyers and recommendations are what make the business sustainable.",
    howWeDecide:
      "We decide for the customer's trust: products we would recommend to a friend, honest descriptions and fair pricing, and service that makes returns and questions painless. A customer who trusts us comes back.",
  },
  "nonprofit-community": {
    missionTheme:
      "advance our cause and serve our community with integrity",
    businessModel:
      "Mission- and donor-funded; impact for beneficiaries and careful stewardship of every donation sustain the organisation.",
    whoWeServe:
      "We serve the people and cause at the heart of our mission, alongside the donors, volunteers, and community who make the work possible. We are accountable to all of them.",
    howWeDecide:
      "We decide for mission impact and the people we serve, steward every donation carefully, and stay transparent about where resources go. We hold our purpose above growth for its own sake.",
  },
};

// ─── Flagship specific-archetype overrides (merged over the industry profile) ─
// Add entries here to deepen a particular business model. Partial — only the
// fields you want to specialise; the rest inherit from the industry profile.

const ARCHETYPE_PROFILES: Record<string, Partial<ArchetypeBusinessProfile>> = {
  "dental-practice": {
    missionTheme:
      "keep our patients' smiles healthy with gentle, expert dental care they trust",
    businessModel:
      "Recurring check-ups plus planned treatment; long-term patient relationships and gentle, anxiety-aware care drive retention and referrals.",
  },
  restaurant: {
    missionTheme:
      "serve food and hospitality our guests look forward to coming back for",
  },
  "law-firm": {
    missionTheme:
      "protect our clients' interests with expert, dependable legal counsel",
    howWeDecide:
      "We decide for the client's interests and long-term trust, give candid advice even when unwelcome, protect confidentiality absolutely, and never let a short-term win compromise our professional integrity.",
  },
  "fitness-gym": {
    missionTheme:
      "help our members get stronger, healthier, and more confident — and keep coming back",
  },
  "ecommerce-general": {
    businessModel:
      "Online transactional sales with repeat custom; product quality, fast fulfilment, and easy support turn first orders into loyal customers.",
  },
  nonprofit: {
    missionTheme:
      "advance our cause and serve our community with integrity and impact",
  },
};

/**
 * Resolve the best business profile for an org: a flagship archetype override
 * (merged over its industry profile) when available, else the industry profile,
 * else the generic profile. Pure and deterministic.
 */
export function resolveBusinessProfile(input: {
  archetypeId?: string | null;
  industry?: string | null;
}): ArchetypeBusinessProfile {
  const base: ArchetypeBusinessProfile =
    (input.industry ? INDUSTRY_PROFILES[input.industry] : undefined) ?? GENERIC_BUSINESS_PROFILE;
  const override = input.archetypeId ? ARCHETYPE_PROFILES[input.archetypeId] : undefined;
  return override ? { ...base, ...override } : base;
}
