import type { ActivationProfile, ArchetypeDefinition } from "../types";

const CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
  { name: "notes", label: "Message", type: "textarea" as const, required: false },
];

const DONATION_FORM_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "donationAmount", label: "Donation amount", type: "select" as const, required: true, options: ["£5", "£10", "£25", "£50", "£100", "Other"] },
  { name: "customAmount", label: "Custom amount (£)", type: "text" as const, required: false, placeholder: "e.g. 30" },
  { name: "campaignId", label: "Campaign", type: "text" as const, required: false },
  { name: "isAnonymous", label: "Make donation anonymous?", type: "select" as const, required: false, options: ["No", "Yes"] },
  { name: "notes", label: "Message", type: "textarea" as const, required: false },
];

const ANIMAL_WELFARE_ACTIVATION_PROFILE = {
  profileType: "standard",
  modules: [],
  billingReadinessMode: "none",
  customerGraph: "none",
  estateSeparation: "shared",
  processProfile: {
    catalogModes: ["donation", "unpriced"],
    subjectTypes: ["animal"],
    housesSubjects: true,
    schedulesSubjects: true,
    resourceKinds: [
      { kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 },
    ],
  },
} satisfies ActivationProfile;

export const nonprofitCommunityArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "pet-rescue",
    name: "Pet Rescue",
    category: "nonprofit-community",
    ctaType: "donation",
    tags: ["rescue", "animals", "charity", "adoption"],
    itemTemplates: [
      { name: "Sponsor an Animal", description: "Monthly sponsorship to support an animal in our care", priceType: "donation", ctaType: "donation" },
      { name: "One-off Donation", description: "A one-time gift to help us care for rescued animals", priceType: "donation", ctaType: "donation" },
      { name: "Monthly Giving", description: "Set up a regular monthly donation", priceType: "donation", ctaType: "donation" },
      { name: "Adopt a Pet", description: "Give a rescued animal a forever home", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "animals-available", title: "Animals Available for Adoption", sortOrder: 1 },
      { type: "items", title: "Support Us", sortOrder: 2 },
      { type: "about", title: "About Us", sortOrder: 3 },
      { type: "donate", title: "Make a Donation", sortOrder: 4 },
      { type: "contact", title: "Get in Touch", sortOrder: 5 },
    ],
    formSchema: DONATION_FORM_FIELDS,
    activationProfile: ANIMAL_WELFARE_ACTIVATION_PROFILE,
  },
  {
    archetypeId: "animal-shelter",
    name: "Animal Shelter",
    category: "nonprofit-community",
    ctaType: "donation",
    tags: ["shelter", "animals", "charity", "adoption"],
    itemTemplates: [
      { name: "Sponsor an Animal", description: "Support a specific animal in our shelter monthly", priceType: "donation", ctaType: "donation" },
      { name: "One-off Donation", description: "Help us cover food, vet bills, and care costs", priceType: "donation", ctaType: "donation" },
      { name: "Monthly Giving", description: "Set up a regular monthly gift", priceType: "donation", ctaType: "donation" },
      { name: "Volunteer Sign-up", description: "Give your time to help animals in need", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "animals-available", title: "Find Your Perfect Pet", sortOrder: 1 },
      { type: "items", title: "Ways to Help", sortOrder: 2 },
      { type: "about", title: "About the Shelter", sortOrder: 3 },
      { type: "donate", title: "Donate Now", sortOrder: 4 },
      { type: "contact", title: "Contact Us", sortOrder: 5 },
    ],
    formSchema: DONATION_FORM_FIELDS,
    activationProfile: ANIMAL_WELFARE_ACTIVATION_PROFILE,
  },
  {
    archetypeId: "community-shelter",
    name: "Community Shelter",
    category: "nonprofit-community",
    ctaType: "donation",
    tags: ["shelter", "homelessness", "community", "charity"],
    itemTemplates: [
      { name: "Emergency Fund Donation", description: "Help provide immediate support to those in crisis", priceType: "donation", ctaType: "donation" },
      { name: "Volunteer Sign-up", description: "Give your time to support shelter residents", priceType: "free", ctaType: "inquiry" },
      { name: "Supply Donation", description: "Donate clothing, food, or essential supplies", priceType: "donation", ctaType: "donation" },
      { name: "Corporate Partnership", description: "Partner with us to support our community mission", priceType: "quote", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "How You Can Help", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "donate", title: "Donate", sortOrder: 3 },
      { type: "contact", title: "Get Involved", sortOrder: 4 },
    ],
    formSchema: DONATION_FORM_FIELDS,
  },
  {
    archetypeId: "charity",
    name: "Charity",
    category: "nonprofit-community",
    ctaType: "donation",
    tags: ["charity", "donation", "fundraising", "nonprofit"],
    itemTemplates: [
      { name: "Make a Donation", description: "Your gift makes a real difference", priceType: "donation", ctaType: "donation" },
      { name: "Become a Regular Donor", description: "Set up a monthly gift and multiply your impact", priceType: "donation", ctaType: "donation" },
      { name: "Fundraising Pack", description: "Get everything you need to fundraise on our behalf", priceType: "free", ctaType: "inquiry" },
      { name: "In Memory Giving", description: "Donate in memory of a loved one", priceType: "donation", ctaType: "donation" },
      { name: "Corporate Giving", description: "Partner with us for a charity of the year campaign", priceType: "quote", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "Our Mission", sortOrder: 1 },
      { type: "items", title: "Ways to Give", sortOrder: 2 },
      { type: "donate", title: "Donate Now", sortOrder: 3 },
      { type: "contact", title: "Get in Touch", sortOrder: 4 },
    ],
    formSchema: DONATION_FORM_FIELDS,
  },
  {
    archetypeId: "sports-club",
    name: "Sports Club",
    category: "nonprofit-community",
    ctaType: "purchase",
    tags: ["sports", "club", "membership", "community"],
    itemTemplates: [
      { name: "Annual Membership", description: "Full club membership for one year", priceType: "fixed", priceAmount: 150, ctaType: "purchase" },
      { name: "Family Membership", description: "Membership for up to 2 adults and 3 children", priceType: "fixed", priceAmount: 350, ctaType: "purchase" },
      { name: "Junior Membership", description: "Membership for under-18s", priceType: "fixed", priceAmount: 60, ctaType: "purchase" },
      { name: "Match Day Ticket", description: "Single match admission ticket", priceType: "fixed", priceAmount: 15, ctaType: "purchase" },
      { name: "Social Membership", description: "Non-playing social membership", priceType: "fixed", priceAmount: 75, ctaType: "purchase" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Memberships", sortOrder: 1 },
      { type: "about", title: "About the Club", sortOrder: 2 },
      { type: "team", title: "Club Officials", sortOrder: 3 },
      { type: "contact", title: "Join the Club", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "membershipType", label: "Membership type", type: "select" as const, required: true, options: ["Adult", "Family", "Junior", "Social", "Student"] },
      { name: "position", label: "Playing position / role (if applicable)", type: "text" as const, required: false },
    ],
  },
  {
    // First member-owned activation (civic spec §6.4/§7): cooperative-ness lives in
    // the governance axis, so one general-purpose archetype covers ag / electric /
    // consumer-food / housing / worker co-ops; sub-type template tuning is a
    // documented follow-up, like the utility's ownership question.
    archetypeId: "cooperative",
    name: "Cooperative (Member-Owned)",
    category: "nonprofit-community",
    ctaType: "inquiry",
    tags: ["cooperative", "co-op", "member-owned", "patronage", "worker-coop", "food-coop", "housing-coop", "agricultural"],
    itemTemplates: [
      { name: "Membership Share", description: "Purchase a membership share to become a member-owner of the cooperative", priceType: "fixed", priceAmount: 100, ctaType: "purchase" },
      { name: "Membership Application", description: "Apply to join the cooperative as a member-owner", priceType: "free", ctaType: "inquiry" },
      { name: "Member Account Question", description: "Ask about your member account, statements, or services", priceType: "free", ctaType: "inquiry" },
      { name: "Patronage & Equity Inquiry", description: "Ask about your patronage allocation, capital credits, or equity retirement", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "About Our Co-op", sortOrder: 1 },
      { type: "items", title: "Products & Services", sortOrder: 2 },
      { type: "team", title: "Board & Committees", sortOrder: 3 },
      { type: "contact", title: "Contact Us", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "requestType", label: "Request type", type: "select" as const, required: true, options: ["Membership", "Member account", "Patronage / equity", "Board & governance", "Other"] },
    ],
    // Member-owner skin over the nonprofit-community category vocabulary (civic spec §8).
    vocabulary: {
      itemsLabel: "Products & Services",
      portalLabel: "Member Portal",
      stakeholderLabel: "Member-Owners",
      inboxLabel: "Member Requests",
      agentName: "Member Services",
    },
    activationProfile: {
      profileType: "standard",
      modules: ["service-operations", "projects"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "member",
        consumptionChannel: "onsite-plus-portal",
        commercialModel: "transactional",
        provisioning: "account-with-billing",
        platform: "no",
        governance: "member-owned",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "standard", it4itStages: ["request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      capabilityOverrides: [
        {
          capabilityKey: "member-equity",
          applicability: "required",
          reason: "Cooperatives allocate patronage and retire member equity by statute (Subchapter T) — not optional for this archetype.",
        },
      ],
      seededServiceCategories: [
        "Membership",
        "Member Services",
        "Patronage & Equity",
        "Governance",
      ],
    },
  },
  {
    // Agricultural shared-machinery cooperative — the intersection of member-owned
    // governance and the reservation-and-return rental value stream (value-stream
    // doc §10.1). Members jointly own a pooled machinery fleet; demand is the
    // sharpest synchronized-contention case (everyone needs the combine in the
    // same harvest fortnight), so it must ration EQUITABLY among member-owners,
    // not clear by price. Retires one of the cooperative archetype's documented
    // unbuilt sub-types (the comment on `cooperative` flags ag as a follow-up).
    archetypeId: "agricultural-cooperative",
    name: "Agricultural Cooperative (Shared Machinery)",
    category: "nonprofit-community",
    ctaType: "rental",
    tags: ["cooperative", "agricultural", "shared-machinery", "member-owned", "asset-pool", "patronage", "reservation"],
    itemTemplates: [
      { name: "Combine Harvester", description: "Reserve the shared combine for your harvest window — allocated equitably among members", priceType: "from", ctaType: "rental", ctaLabel: "Request booking" },
      { name: "Grain Drill / Planter", description: "Shared planter — reserve for your planting window", priceType: "from", ctaType: "rental", ctaLabel: "Request booking" },
      { name: "Sprayer", description: "Self-propelled sprayer — member usage rate", priceType: "from", ctaType: "rental", ctaLabel: "Request booking" },
      { name: "Become a Member", description: "Join the cooperative to access the shared machinery pool", priceType: "free", ctaType: "inquiry", ctaLabel: "Join" },
      { name: "Patronage & Equity Inquiry", description: "Ask about your usage-based patronage allocation or capital credits", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "About Our Co-op", sortOrder: 1 },
      { type: "items", title: "Shared Machinery", sortOrder: 2 },
      { type: "team", title: "Board & Committees", sortOrder: 3 },
      { type: "contact", title: "Contact Us", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "requestType", label: "Request type", type: "select" as const, required: true, options: ["Machinery booking", "Membership", "Patronage / equity", "Board & governance", "Other"] },
    ],
    vocabulary: {
      itemsLabel: "Shared Machinery",
      portalLabel: "Member Portal",
      stakeholderLabel: "Member-Owners",
      inboxLabel: "Booking Requests",
      agentName: "Co-op Coordinator",
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
        primaryConsumer: "member",
        consumptionChannel: "onsite-plus-portal",
        commercialModel: "usage-based",
        // The intersection: a reservation-and-return pool (rental capabilities)
        // governed member-owned (member-governance/eligibility/equity). The
        // equitable-rationing layer over conflicting reservations is the
        // genuinely new build (BI-D7FCD029, Phase 4).
        provisioning: "reservation-and-return",
        platform: "no",
        governance: "member-owned",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill", "detect-to-correct"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      // No member-equity override here (unlike the credit union): ag co-ops DO
      // allocate usage-based patronage, so member-equity stays derived.
      seededServiceCategories: [
        "Harvest Equipment",
        "Planting Equipment",
        "Application Equipment",
        "Membership & Patronage",
      ],
    },
  },
  {
    // Meals-on-Wheels-style program: a nonprofit funded by donation whose
    // *operating model* is a physical, route-based meal-delivery service to
    // homebound recipients. The donation CTA funds it; the volunteer-driver
    // dispatch is the operational layer that derives the Field Dispatch
    // capability (form=services + delivery=physical + onsite-plus-portal).
    // Food-handling is a capability-layer compliance overlay (design ADR-5).
    archetypeId: "meal-delivery-program",
    name: "Meal Delivery Program",
    category: "nonprofit-community",
    ctaType: "donation",
    tags: ["meals on wheels", "meal delivery", "food", "seniors", "homebound", "charity", "volunteer", "route"],
    itemTemplates: [
      { name: "Donate", description: "Fund meals for homebound neighbours in need", priceType: "donation", ctaType: "donation" },
      { name: "Sponsor a Route", description: "Underwrite a full delivery route for a month", priceType: "donation", ctaType: "donation" },
      { name: "Request Meal Service", description: "Sign up yourself or a loved one to receive meals", priceType: "free", ctaType: "inquiry" },
      { name: "Volunteer as a Driver", description: "Deliver meals and a friendly check-in on a local route", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "About Our Program", sortOrder: 1 },
      { type: "items", title: "Get Involved", sortOrder: 2 },
      { type: "donate", title: "Donate", sortOrder: 3 },
      { type: "contact", title: "Contact Us", sortOrder: 4 },
    ],
    formSchema: DONATION_FORM_FIELDS,
    activationProfile: {
      profileType: "standard",
      modules: ["service-operations", "lifecycle-signals"],
      billingReadinessMode: "none",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "individual",
        consumptionChannel: "onsite-plus-portal",
        commercialModel: "transactional",
        provisioning: "none",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
    },
  },
];
