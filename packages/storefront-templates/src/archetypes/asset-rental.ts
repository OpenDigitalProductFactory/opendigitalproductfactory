import type { ArchetypeDefinition } from "../types";

// Rental / shared-asset archetypes (value-stream doc §10.1; design basis
// docs/superpowers/specs/2026-05-29-vehicle-equipment-rental-archetype-design.md).
// The defining value stream is reserve → hand out → use → return → inspect →
// re-pool. Both leaves declare provisioning "reservation-and-return", which
// derives the rental-fleet / rental-agreements / asset-pool capabilities.

const RENTER_CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
];

export const assetRentalArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "equipment-rental",
    name: "Equipment & Tool Rental",
    category: "asset-rental",
    ctaType: "rental",
    tags: ["rental", "equipment", "tool-hire", "party-rental", "fleet", "asset-pool", "reservation"],
    itemTemplates: [
      { name: "Mini Excavator", description: "Compact excavator — daily/weekly hire, deposit required", priceType: "from", ctaType: "rental", ctaLabel: "Reserve" },
      { name: "Scaffold Tower", description: "Mobile scaffold tower — quantity-pool stock, per-day rate", priceType: "from", ctaType: "rental", ctaLabel: "Reserve" },
      { name: "Generator (5kW)", description: "Portable generator — per-day, fuel deposit", priceType: "from", ctaType: "rental", ctaLabel: "Reserve" },
      { name: "Pressure Washer", description: "Industrial pressure washer — per-day hire", priceType: "from", ctaType: "rental", ctaLabel: "Reserve" },
      { name: "Party Tent (6x12m)", description: "Event tent with sides — weekend-rate, deposit", priceType: "from", ctaType: "rental", ctaLabel: "Reserve" },
      { name: "Check Availability", description: "Tell us what you need and your dates — we'll confirm availability", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "About Us", sortOrder: 1 },
      { type: "items", title: "Equipment & Rates", sortOrder: 2 },
      { type: "team", title: "Our Team", sortOrder: 3 },
      { type: "contact", title: "Reserve or Ask", sortOrder: 4 },
    ],
    formSchema: [
      ...RENTER_CONTACT_FIELDS,
      { name: "item", label: "What do you need?", type: "text" as const, required: true },
      { name: "pickupDate", label: "Pickup date", type: "text" as const, required: true, placeholder: "e.g. 2026-07-15" },
      { name: "returnDate", label: "Return date", type: "text" as const, required: true, placeholder: "e.g. 2026-07-17" },
      { name: "notes", label: "Anything else?", type: "textarea" as const, required: false },
    ],
    // Renter skin over the asset-rental category vocabulary.
    vocabulary: {
      itemsLabel: "Equipment & Rates",
      portalLabel: "Rental Portal",
      stakeholderLabel: "Renters",
      inboxLabel: "Reservations",
      agentName: "Rental Desk",
    },
    activationProfile: {
      profileType: "standard",
      modules: ["rental-fleet", "rental-agreements", "billing-readiness", "lifecycle-signals"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "business",
        consumptionChannel: "onsite-plus-portal",
        commercialModel: "usage-based",
        provisioning: "reservation-and-return",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill", "detect-to-correct"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "Earthmoving",
        "Access & Lifting",
        "Power & Site",
        "Cleaning",
        "Events",
      ],
    },
  },
  {
    archetypeId: "self-storage",
    name: "Self-Storage Facility",
    category: "asset-rental",
    ctaType: "rental",
    tags: ["self-storage", "storage", "occupancy", "units", "subscription", "asset-pool"],
    itemTemplates: [
      { name: "5x5 Unit", description: "Small storage unit (locker) — billed monthly", priceType: "from", ctaType: "rental", ctaLabel: "Reserve unit" },
      { name: "10x10 Unit", description: "Medium storage unit — billed monthly", priceType: "from", ctaType: "rental", ctaLabel: "Reserve unit" },
      { name: "10x20 Unit", description: "Large storage unit (one-car garage) — billed monthly", priceType: "from", ctaType: "rental", ctaLabel: "Reserve unit" },
      { name: "Climate-Controlled 10x10", description: "Temperature & humidity controlled unit — billed monthly", priceType: "from", ctaType: "rental", ctaLabel: "Reserve unit" },
      { name: "Check Availability & Waitlist", description: "Tell us the size you need — reserve now or join the waitlist if full", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "About Our Facility", sortOrder: 1 },
      { type: "items", title: "Unit Sizes & Rates", sortOrder: 2 },
      { type: "team", title: "Facility Team", sortOrder: 3 },
      { type: "contact", title: "Reserve a Unit", sortOrder: 4 },
    ],
    formSchema: [
      ...RENTER_CONTACT_FIELDS,
      { name: "unitSize", label: "Unit size", type: "select" as const, required: true, options: ["5x5", "10x10", "10x20", "Climate-Controlled 10x10", "Not sure"] },
      { name: "moveInDate", label: "Desired move-in date", type: "text" as const, required: false, placeholder: "e.g. 2026-07-01" },
      { name: "notes", label: "What are you storing?", type: "textarea" as const, required: false },
    ],
    // Tenant/occupancy skin over the asset-rental category vocabulary.
    vocabulary: {
      itemsLabel: "Unit Sizes & Rates",
      portalLabel: "Storage Portal",
      stakeholderLabel: "Tenants",
      inboxLabel: "Move-ins",
      agentName: "Storage Manager",
    },
    activationProfile: {
      profileType: "standard",
      modules: ["rental-fleet", "rental-agreements", "billing-readiness", "lifecycle-signals"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "individual",
        consumptionChannel: "onsite-plus-portal",
        // Occupancy is billed as a recurring subscription against a fixed unit
        // inventory; KPI = occupancy %, the hard-cap hybrid in §10.1.
        commercialModel: "subscription",
        provisioning: "reservation-and-return",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "Small Units",
        "Medium Units",
        "Large Units",
        "Climate-Controlled",
      ],
    },
  },
  {
    // Production-equipment rental (camera / lighting / grip / audio) is one of the
    // businesses that support film, commercial, and event production. It is a
    // clean reuse of the asset-rental value stream (reserve → hand out → use →
    // return → inspect → re-pool) rather than a new category — the kernel's
    // reusability axis and the verify-substrate-first commandment both point here
    // instead of inventing a bespoke rental type under media-production.
    archetypeId: "production-equipment-rental",
    name: "Film & Production Equipment Rental",
    category: "asset-rental",
    ctaType: "rental",
    tags: ["rental", "film", "production", "camera", "lighting", "grip", "audio", "asset-pool", "reservation"],
    itemTemplates: [
      { name: "Camera Package", description: "Cinema camera body, lenses, and media — daily/weekly hire", priceType: "from", ctaType: "rental", ctaLabel: "Reserve" },
      { name: "Lighting Kit", description: "LED / HMI lighting package with stands and control", priceType: "from", ctaType: "rental", ctaLabel: "Reserve" },
      { name: "Grip & Rigging", description: "Dolly, tripods, rigging, and grip stands", priceType: "from", ctaType: "rental", ctaLabel: "Reserve" },
      { name: "Audio Package", description: "Boom, radio mics, recorder, and monitoring", priceType: "from", ctaType: "rental", ctaLabel: "Reserve" },
      { name: "Drone / Aerial Kit", description: "Aerial platform with camera — operator optional", priceType: "from", ctaType: "rental", ctaLabel: "Reserve" },
      { name: "Check Availability", description: "Tell us your kit list and shoot dates — we'll confirm availability", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "About the Rental House", sortOrder: 1 },
      { type: "items", title: "Kit & Rates", sortOrder: 2 },
      { type: "team", title: "Our Team", sortOrder: 3 },
      { type: "contact", title: "Reserve or Ask", sortOrder: 4 },
    ],
    formSchema: [
      ...RENTER_CONTACT_FIELDS,
      { name: "kit", label: "What kit do you need?", type: "text" as const, required: true },
      { name: "pickupDate", label: "Shoot / pickup date", type: "text" as const, required: true, placeholder: "e.g. 2026-09-15" },
      { name: "returnDate", label: "Return date", type: "text" as const, required: true, placeholder: "e.g. 2026-09-17" },
      { name: "notes", label: "Production / project details", type: "textarea" as const, required: false },
    ],
    vocabulary: {
      itemsLabel: "Kit & Rates",
      portalLabel: "Rental Portal",
      stakeholderLabel: "Productions",
      inboxLabel: "Reservations",
      agentName: "Rental Desk",
    },
    activationProfile: {
      profileType: "standard",
      modules: ["rental-fleet", "rental-agreements", "billing-readiness", "lifecycle-signals"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "business",
        consumptionChannel: "onsite-plus-portal",
        commercialModel: "usage-based",
        provisioning: "reservation-and-return",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill", "detect-to-correct"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "Camera",
        "Lighting",
        "Grip",
        "Audio",
        "Aerial",
      ],
    },
  },
];
