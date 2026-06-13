import type { ArchetypeDefinition, SchedulingDefaults } from "../types";

// Model home tours and design centre appointments run 7 days a week —
// model homes are the builder's "store" and keep retail hours including weekends.
const MODEL_HOME_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "customer-choice",
  defaultOperatingHours: [
    { day: 0, start: "12:00", end: "17:00" }, // Sunday
    { day: 1, start: "10:00", end: "18:00" }, // Monday
    { day: 2, start: "10:00", end: "18:00" }, // Tuesday
    { day: 3, start: "10:00", end: "18:00" }, // Wednesday
    { day: 4, start: "10:00", end: "18:00" }, // Thursday
    { day: 5, start: "10:00", end: "18:00" }, // Friday
    { day: 6, start: "10:00", end: "17:00" }, // Saturday
  ],
  defaultBeforeBuffer: 15,
  defaultAfterBuffer: 15,
  minimumNoticeHours: 2,
  maxAdvanceDays: 30,
};

// Custom builder design consultations are substantive, project-scoped meetings —
// business hours only, with sufficient buffer for site briefing and questions.
const CONSULTATION_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "customer-choice",
  defaultOperatingHours: [
    { day: 1, start: "09:00", end: "17:00" }, // Monday
    { day: 2, start: "09:00", end: "17:00" }, // Tuesday
    { day: 3, start: "09:00", end: "17:00" }, // Wednesday
    { day: 4, start: "09:00", end: "17:00" }, // Thursday
    { day: 5, start: "09:00", end: "17:00" }, // Friday
  ],
  defaultBeforeBuffer: 30,
  defaultAfterBuffer: 30,
  minimumNoticeHours: 24,
  maxAdvanceDays: 60,
};

const BUYER_CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: true },
];

export const realEstateConstructionArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "new-home-builder",
    name: "New Home Builder",
    category: "real-estate-construction",
    ctaType: "inquiry",
    tags: [
      "new homes", "home builder", "property", "residential",
      "development", "community", "house and land", "construction",
      "display homes", "master planned community",
    ],
    itemTemplates: [
      {
        name: "Model Home Tour",
        description: "Walk through our display homes with a sales consultant — book your appointment",
        priceType: "free",
        ctaType: "booking",
        bookingDurationMinutes: 60,
        mediaRole: "facility",
      },
      {
        name: "Design Centre Appointment",
        description: "Choose your colour palette, fixtures, flooring, and upgrade options with our design consultant",
        priceType: "free",
        ctaType: "booking",
        bookingDurationMinutes: 60,
        mediaRole: "facility",
      },
      {
        name: "3-Bedroom Home Plans",
        description: "Enquire about availability, lots, and pricing for our 3-bedroom designs",
        priceType: "from",
        ctaType: "inquiry",
        mediaRole: "product",
      },
      {
        name: "4-Bedroom Home Plans",
        description: "Enquire about availability, lots, and pricing for our 4-bedroom designs",
        priceType: "from",
        ctaType: "inquiry",
        mediaRole: "product",
      },
      {
        name: "Community Information Pack",
        description: "Receive detailed information about our communities, amenities, stages, and pricing",
        priceType: "free",
        ctaType: "inquiry",
      },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "gallery", title: "Display Homes & Communities", sortOrder: 1 },
      { type: "items", title: "Communities & Homes", sortOrder: 2 },
      { type: "team", title: "Sales Team", sortOrder: 3 },
      { type: "testimonials", title: "Buyer Stories", sortOrder: 4 },
      { type: "about", title: "About Us", sortOrder: 5 },
      { type: "contact", title: "Schedule a Visit", sortOrder: 6 },
    ],
    formSchema: [
      ...BUYER_CONTACT_FIELDS,
      {
        name: "communityOfInterest",
        label: "Community or area of interest",
        type: "text" as const,
        required: false,
        placeholder: "e.g. Riverside Estate, or any community near [suburb]",
      },
      {
        name: "bedroomsRequired",
        label: "Bedrooms needed",
        type: "select" as const,
        required: true,
        options: ["2 bedrooms", "3 bedrooms", "4 bedrooms", "5+ bedrooms"],
      },
      {
        name: "targetBudget",
        label: "Budget range",
        type: "select" as const,
        required: false,
        options: ["Under $400k", "$400k–$550k", "$550k–$750k", "$750k–$1M", "Over $1M", "Not sure yet"],
      },
      {
        name: "purchaseTimeline",
        label: "When are you looking to buy?",
        type: "select" as const,
        required: true,
        options: ["Within 3 months", "3–6 months", "6–12 months", "12+ months"],
      },
      {
        name: "buyingStatus",
        label: "Buying situation",
        type: "select" as const,
        required: false,
        options: ["First-time buyer", "Upsizing", "Downsizing", "Relocating", "Investment"],
      },
      {
        name: "notes",
        label: "Anything else you would like us to know?",
        type: "textarea" as const,
        required: false,
      },
    ],
    schedulingDefaults: MODEL_HOME_SCHEDULING,
    activationProfile: {
      profileType: "standard",
      modules: ["customer-estate", "projects", "billing-readiness", "lifecycle-signals"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "shared",
      axes: {
        form: "goods",
        delivery: "physical",
        primaryConsumer: "household",
        consumptionChannel: "sales-assisted",
        commercialModel: "transactional",
        provisioning: "account-with-billing",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: {
          scope: "primary",
          it4itStages: ["requirement-to-deploy", "request-to-fulfill"],
          offerings: ["new-home-communities", "design-centre-packages", "house-and-land"],
        },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "land-and-community-development",
        "home-design-and-floor-plans",
        "permitting-and-approvals",
        "site-preparation",
        "construction",
        "design-centre-selections",
        "sales-and-contracts",
        "quality-inspections",
        "settlement-and-handover",
        "warranty-and-aftercare",
      ],
    },
  },
  {
    archetypeId: "custom-home-builder",
    name: "Custom Home Builder",
    category: "real-estate-construction",
    ctaType: "inquiry",
    tags: [
      "custom home", "home builder", "build on your lot", "BYOL", "BOYL",
      "construction", "bespoke", "residential", "knockdown rebuild",
      "architect builder", "project home",
    ],
    itemTemplates: [
      {
        name: "Initial Design Consultation",
        description: "Meet our team to discuss your vision, site, and build options — obligation-free",
        priceType: "free",
        ctaType: "booking",
        bookingDurationMinutes: 60,
      },
      {
        name: "Custom Home Design",
        description: "Fully bespoke architectural design and floor plan drawn to your brief",
        priceType: "quote",
        ctaType: "inquiry",
        mediaRole: "product",
      },
      {
        name: "Full Build Contract",
        description: "Design, permits, and end-to-end construction of your custom home on your lot",
        priceType: "quote",
        ctaType: "inquiry",
      },
      {
        name: "Knockdown & Rebuild",
        description: "Remove an existing dwelling and build your new home on the same lot",
        priceType: "quote",
        ctaType: "inquiry",
      },
      {
        name: "Renovation & Extension",
        description: "Major renovation, addition, or extension — quoted after a site assessment",
        priceType: "quote",
        ctaType: "inquiry",
      },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "gallery", title: "Portfolio", sortOrder: 1 },
      { type: "items", title: "Services", sortOrder: 2 },
      { type: "team", title: "Build Team", sortOrder: 3 },
      { type: "testimonials", title: "Client Stories", sortOrder: 4 },
      { type: "about", title: "Our Craftsmanship", sortOrder: 5 },
      { type: "contact", title: "Start Your Build", sortOrder: 6 },
    ],
    formSchema: [
      ...BUYER_CONTACT_FIELDS,
      {
        name: "lotAddress",
        label: "Do you have a lot or site? If so, where is it located?",
        type: "text" as const,
        required: false,
        placeholder: "e.g. 42 Smith Street, Suburb — or 'Not yet'",
      },
      {
        name: "serviceType",
        label: "What are you looking to do?",
        type: "select" as const,
        required: true,
        options: ["Build on my own lot", "Knockdown & rebuild", "Major renovation or extension", "Not sure yet"],
      },
      {
        name: "bedroomsRequired",
        label: "Bedrooms required",
        type: "select" as const,
        required: true,
        options: ["2 bedrooms", "3 bedrooms", "4 bedrooms", "5 bedrooms", "6+ bedrooms"],
      },
      {
        name: "targetBudget",
        label: "Build budget (excluding land)",
        type: "select" as const,
        required: false,
        options: ["Under $500k", "$500k–$750k", "$750k–$1M", "$1M–$1.5M", "$1.5M–$2.5M", "Over $2.5M", "Not sure yet"],
      },
      {
        name: "buildTimeline",
        label: "When are you hoping to start building?",
        type: "select" as const,
        required: false,
        options: ["As soon as possible", "Within 6 months", "6–12 months", "12+ months"],
      },
      {
        name: "notes",
        label: "Tell us about your dream home",
        type: "textarea" as const,
        required: false,
      },
    ],
    schedulingDefaults: CONSULTATION_SCHEDULING,
    activationProfile: {
      profileType: "standard",
      modules: [
        "customer-estate",
        "projects",
        "billing-readiness",
        "service-operations",
        "lifecycle-signals",
      ],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "shared",
      axes: {
        form: "goods",
        delivery: "physical",
        primaryConsumer: "household",
        consumptionChannel: "sales-assisted",
        commercialModel: "transactional",
        provisioning: "account-with-billing",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: {
          scope: "primary",
          it4itStages: ["requirement-to-deploy", "request-to-fulfill"],
          offerings: ["custom-home-design", "full-build-contracts", "knockdown-rebuild"],
        },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "design-and-planning",
        "permitting-and-approvals",
        "site-preparation",
        "foundation",
        "framing-and-structure",
        "mechanical-electrical-plumbing",
        "insulation-and-drywall",
        "interior-finishes",
        "exterior-finishes",
        "quality-inspections-and-handover",
        "warranty-and-aftercare",
      ],
    },
    vocabulary: {
      stakeholderLabel: "Clients",
      teamLabel: "Build Team",
      agentName: "Build Consultant",
      inboxLabel: "Project Enquiries",
      itemsLabel: "Services",
      singleItemLabel: "Service",
      addButtonLabel: "Add service",
      portalLabel: "Client Portal",
    },
  },
];
