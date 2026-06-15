import type { ArchetypeDefinition } from "../types";

const INQUIRY_BASE_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: true },
];

const TRADES_FORM_FIELDS = [
  ...INQUIRY_BASE_FIELDS,
  { name: "jobType", label: "Job description", type: "text" as const, required: true },
  { name: "urgency", label: "Urgency", type: "select" as const, required: true, options: ["Emergency", "Routine", "Planned"] },
  { name: "propertyType", label: "Property type", type: "select" as const, required: true, options: ["Residential", "Commercial", "Industrial"] },
  { name: "notes", label: "Additional details", type: "textarea" as const, required: false },
];

// Facilities maintenance is B2B-primary: who is asking and how many sites are in
// scope drive the quote, so the form captures company name and site count.
const FACILITIES_FORM_FIELDS = [
  ...INQUIRY_BASE_FIELDS,
  { name: "companyName", label: "Company name", type: "text" as const, required: true },
  { name: "siteCount", label: "Number of sites", type: "select" as const, required: true, options: ["1", "2–5", "6–20", "21–50", "50+"] },
  { name: "jobType", label: "Service required", type: "text" as const, required: true },
  { name: "urgency", label: "Urgency", type: "select" as const, required: true, options: ["Emergency", "Routine", "Planned"] },
  { name: "propertyType", label: "Property type", type: "select" as const, required: true, options: ["Residential", "Commercial", "Industrial"] },
  { name: "notes", label: "Additional details", type: "textarea" as const, required: false },
];

// Field-dispatch trades send a mobile technician or crew to the customer's
// property to work on a site or a piece of equipment. The load-bearing axis is
// `consumptionChannel: "onsite-plus-portal"` together with `form: "services"`
// and `delivery: "physical"` — that triple is what the (forthcoming) horizontal
// Field Dispatch capability reads via `needsFieldDispatch(axes)` to derive the
// dispatch board, dispatcher coworker, and map-pin "Dispatch" action without a
// per-archetype flag (capability design 2026-06-13 ADR-1/ADR-2). Until that
// module ships, field work composes under `service-operations`.
//
// Three operating shapes recur across the trades:
//  - RECURRING — maintenance plans / route-based recurring visits with an
//    ongoing customer relationship and serviced asset (HVAC, pest, pool).
//  - ONE_OFF   — a single diagnose-and-fix visit, billed per job (appliance,
//    pressure washing).
//  - PROJECT   — a quoted, milestone-billed build/replacement (roofing).
const TRADES_DISPATCH_RECURRING: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: [
    "customer-estate",
    "service-operations",
    "service-agreements",
    "billing-readiness",
    "lifecycle-signals",
  ],
  billingReadinessMode: "prepared-not-prescribed",
  customerGraph: "separate-customer-projection",
  estateSeparation: "shared",
  axes: {
    form: "services",
    delivery: "physical",
    primaryConsumer: "household",
    consumptionChannel: "onsite-plus-portal",
    commercialModel: "recurring-agreement",
    provisioning: "account-with-billing",
    platform: "no",
  },
  portfolios: {
    foundational: { scope: "minimal" },
    manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill", "detect-to-correct"] },
    forEmployees: { scope: "standard" },
    productsAndServicesSold: { scope: "primary" },
  },
};

const TRADES_DISPATCH_ONE_OFF: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: ["service-operations"],
  billingReadinessMode: "none",
  customerGraph: "none",
  estateSeparation: "shared",
  axes: {
    form: "services",
    delivery: "physical",
    primaryConsumer: "household",
    consumptionChannel: "onsite-plus-portal",
    commercialModel: "transactional",
    provisioning: "account-with-billing",
    platform: "no",
  },
  portfolios: {
    foundational: { scope: "minimal" },
    manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill"] },
    forEmployees: { scope: "standard" },
    productsAndServicesSold: { scope: "primary" },
  },
};

const TRADES_DISPATCH_PROJECT: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: ["service-operations", "projects", "billing-readiness", "customer-estate"],
  billingReadinessMode: "prepared-not-prescribed",
  customerGraph: "separate-customer-projection",
  estateSeparation: "shared",
  axes: {
    form: "services",
    delivery: "physical",
    primaryConsumer: "household",
    consumptionChannel: "onsite-plus-portal",
    commercialModel: "transactional",
    provisioning: "account-with-billing",
    platform: "no",
  },
  portfolios: {
    foundational: { scope: "minimal" },
    manufactureAndDeliver: { scope: "primary", it4itStages: ["requirement-to-deploy", "request-to-fulfill"] },
    forEmployees: { scope: "standard" },
    productsAndServicesSold: { scope: "primary" },
  },
};

export const tradesMaintenanceArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "facilities-maintenance",
    name: "Facilities Maintenance",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["facilities", "maintenance", "commercial", "repair"],
    itemTemplates: [
      { name: "Planned Maintenance Contract", description: "Regular scheduled maintenance visits", priceType: "quote" },
      { name: "Reactive Repair", description: "On-call repair service for unexpected faults", priceType: "from" },
      { name: "Building Inspection", description: "Full building condition survey and report", priceType: "quote" },
      { name: "HVAC Servicing", description: "Heating, ventilation, and air conditioning maintenance", priceType: "from" },
      { name: "Electrical Testing", description: "PAT testing and electrical safety inspection", priceType: "from" },
      { name: "Emergency Call-Out", description: "24/7 emergency response service", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Client Feedback", sortOrder: 3 },
      { type: "contact", title: "Request a Quote", sortOrder: 4 },
    ],
    formSchema: FACILITIES_FORM_FIELDS,
  },
  {
    archetypeId: "plumber",
    name: "Plumber",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["plumbing", "trades", "repair", "emergency"],
    itemTemplates: [
      { name: "Emergency Call-Out", description: "Fast response for burst pipes, leaks, and blockages", priceType: "from" },
      { name: "Boiler Service", description: "Annual boiler inspection and service", priceType: "fixed" },
      { name: "Boiler Repair", description: "Diagnosis and repair of boiler faults", priceType: "from" },
      { name: "Bathroom Installation", description: "Full bathroom suite fitting", priceType: "quote" },
      { name: "Drain Unblocking", description: "Clearing blocked drains and toilets", priceType: "from" },
      { name: "Leak Detection & Repair", description: "Locate and fix water leaks", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "contact", title: "Get a Quote", sortOrder: 3 },
    ],
    formSchema: TRADES_FORM_FIELDS,
  },
  {
    archetypeId: "electrician",
    name: "Electrician",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["electrical", "trades", "wiring", "installation"],
    itemTemplates: [
      { name: "Electrical Safety Certificate", description: "EICR inspection and certification", priceType: "from" },
      { name: "Consumer Unit Replacement", description: "Upgrade your fuse box to modern standards", priceType: "from" },
      { name: "Socket & Switch Installation", description: "Adding or replacing sockets and switches", priceType: "from" },
      { name: "Lighting Installation", description: "Internal and external lighting fitting", priceType: "from" },
      { name: "EV Charger Installation", description: "Home electric vehicle charging point", priceType: "from" },
      { name: "Emergency Call-Out", description: "24/7 emergency electrical fault response", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 3 },
      { type: "contact", title: "Get a Quote", sortOrder: 4 },
    ],
    formSchema: TRADES_FORM_FIELDS,
  },
  {
    archetypeId: "cleaning-service",
    name: "Cleaning Service",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["cleaning", "domestic", "commercial", "maintenance"],
    itemTemplates: [
      { name: "Regular Domestic Clean", description: "Weekly or fortnightly home cleaning", priceType: "per-hour" },
      { name: "One-Off Deep Clean", description: "Thorough top-to-bottom clean", priceType: "quote" },
      { name: "End of Tenancy Clean", description: "Full professional clean for rental properties", priceType: "from" },
      { name: "Office Cleaning", description: "Flexible commercial office cleaning contract", priceType: "quote" },
      { name: "Carpet & Upholstery Clean", description: "Professional steam cleaning", priceType: "from" },
      { name: "Window Cleaning", description: "Internal and external window cleaning", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "What Clients Say", sortOrder: 3 },
      { type: "contact", title: "Get a Quote", sortOrder: 4 },
    ],
    formSchema: [
      ...INQUIRY_BASE_FIELDS,
      { name: "jobType", label: "Type of clean", type: "select" as const, required: true, options: ["Regular domestic", "One-off deep clean", "End of tenancy", "Office", "Carpet cleaning", "Window cleaning"] },
      { name: "propertyType", label: "Property type", type: "select" as const, required: true, options: ["Residential", "Commercial", "Industrial"] },
      { name: "propertySize", label: "Property size", type: "select" as const, required: true, options: ["Studio / 1 bed", "2 bed", "3 bed", "4+ bed", "Commercial premises"] },
      { name: "frequency", label: "Frequency", type: "select" as const, required: false, options: ["One-off", "Weekly", "Fortnightly", "Monthly"] },
      { name: "notes", label: "Additional details", type: "textarea" as const, required: false },
    ],
  },
  {
    archetypeId: "landscaping",
    name: "Landscaping & Grounds",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["landscaping", "garden", "grounds", "outdoor"],
    itemTemplates: [
      { name: "Garden Design Consultation", description: "On-site design meeting and concept plan", priceType: "fixed" },
      { name: "Lawn Maintenance Contract", description: "Regular lawn cutting and edging", priceType: "from" },
      { name: "Patio & Decking Installation", description: "Design and build outdoor living spaces", priceType: "quote" },
      { name: "Fencing & Gates", description: "Supply and installation of fencing and gates", priceType: "from" },
      { name: "Tree Surgery", description: "Tree pruning, felling, and stump removal", priceType: "quote" },
      { name: "Irrigation Systems", description: "Automated watering system design and installation", priceType: "quote" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "gallery", title: "Our Projects", sortOrder: 2 },
      { type: "about", title: "About Us", sortOrder: 3 },
      { type: "contact", title: "Request a Quote", sortOrder: 4 },
    ],
    formSchema: [
      ...INQUIRY_BASE_FIELDS,
      { name: "jobType", label: "Type of work", type: "text" as const, required: true },
      { name: "urgency", label: "Urgency", type: "select" as const, required: true, options: ["Emergency", "Routine", "Planned"] },
      { name: "propertyType", label: "Property type", type: "select" as const, required: true, options: ["Residential", "Commercial", "Industrial"] },
      { name: "gardenSize", label: "Property / garden size", type: "select" as const, required: true, options: ["Small (under 50m²)", "Medium (50–200m²)", "Large (200m²+)"] },
      { name: "frequency", label: "Frequency", type: "select" as const, required: false, options: ["One-off", "Weekly", "Fortnightly", "Monthly", "Seasonal"] },
      { name: "notes", label: "Additional details", type: "textarea" as const, required: false },
    ],
  },
  {
    // The Field Dispatch capability's reference vertical (Dale's HVAC business).
    // The EPA 608 refrigerant-handling overlay is captured at job close by the
    // capability's compliance framework (design §6.2 / ADR-5), not modelled here.
    archetypeId: "hvac-contractor",
    name: "HVAC Contractor",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["hvac", "heating", "cooling", "air conditioning", "furnace", "heat pump", "ductwork", "trades", "installation", "repair"],
    itemTemplates: [
      { name: "AC Repair", description: "Diagnose and repair air conditioning faults", priceType: "from" },
      { name: "Heating / Furnace Repair", description: "Furnace, boiler, and heat pump fault diagnosis and repair", priceType: "from" },
      { name: "System Installation", description: "Supply and install a new HVAC system — quoted after a site survey", priceType: "quote" },
      { name: "Maintenance Plan", description: "Seasonal tune-ups and priority service on an annual agreement", priceType: "from" },
      { name: "Indoor Air Quality", description: "Air purification, humidity control, and ventilation upgrades", priceType: "from" },
      { name: "Emergency Call-Out", description: "24/7 response for no-heat and no-cool emergencies", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 3 },
      { type: "contact", title: "Request Service", sortOrder: 4 },
    ],
    formSchema: [
      ...TRADES_FORM_FIELDS,
      { name: "systemType", label: "System type", type: "select" as const, required: false, options: ["Central air conditioning", "Furnace", "Heat pump", "Boiler", "Mini-split / ductless", "Not sure"] },
    ],
    activationProfile: TRADES_DISPATCH_RECURRING,
  },
  {
    // Pesticide-applicator licensing + per-application logs are a capability-layer
    // compliance overlay (design ADR-5); weather/re-entry gating lives in the
    // dispatcher, not the storefront template.
    archetypeId: "pest-control",
    name: "Pest Control",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["pest control", "exterminator", "termite", "rodent", "insects", "wildlife", "trades"],
    itemTemplates: [
      { name: "General Pest Treatment", description: "Treatment for ants, spiders, roaches, and common pests", priceType: "from" },
      { name: "Recurring Protection Plan", description: "Quarterly preventative treatment on an annual agreement", priceType: "from" },
      { name: "Termite Inspection & Treatment", description: "Inspection, report, and treatment for termites", priceType: "quote" },
      { name: "Rodent Control", description: "Exclusion, trapping, and removal of mice and rats", priceType: "from" },
      { name: "Bed Bug Treatment", description: "Heat or chemical treatment for bed bug infestations", priceType: "quote" },
      { name: "Wildlife Removal", description: "Humane removal of raccoons, squirrels, and other wildlife", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 3 },
      { type: "contact", title: "Request a Quote", sortOrder: 4 },
    ],
    formSchema: [
      ...TRADES_FORM_FIELDS,
      { name: "pestType", label: "Pest problem", type: "select" as const, required: false, options: ["General insects", "Termites", "Rodents", "Bed bugs", "Wasps / hornets", "Wildlife", "Not sure"] },
    ],
    activationProfile: TRADES_DISPATCH_RECURRING,
  },
  {
    archetypeId: "appliance-repair",
    name: "Appliance Repair",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["appliance repair", "refrigerator", "washer", "dryer", "dishwasher", "oven", "trades"],
    itemTemplates: [
      { name: "Diagnostic Visit", description: "On-site diagnosis with the fee credited toward the repair", priceType: "fixed" },
      { name: "Refrigerator / Freezer Repair", description: "Cooling, leak, and ice-maker fault repair", priceType: "from" },
      { name: "Washer / Dryer Repair", description: "Repair for washing machines and dryers", priceType: "from" },
      { name: "Oven / Range / Cooktop Repair", description: "Heating element, ignition, and control repair", priceType: "from" },
      { name: "Dishwasher Repair", description: "Drainage, leak, and cleaning-performance repair", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 3 },
      { type: "contact", title: "Book a Repair", sortOrder: 4 },
    ],
    formSchema: [
      ...TRADES_FORM_FIELDS,
      { name: "applianceType", label: "Appliance", type: "select" as const, required: true, options: ["Refrigerator / freezer", "Washer", "Dryer", "Oven / range", "Cooktop", "Dishwasher", "Microwave", "Other"] },
      { name: "brand", label: "Brand & model (if known)", type: "text" as const, required: false },
    ],
    activationProfile: TRADES_DISPATCH_ONE_OFF,
  },
  {
    archetypeId: "pool-spa-service",
    name: "Pool & Spa Service",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["pool", "spa", "hot tub", "pool cleaning", "pool maintenance", "trades"],
    itemTemplates: [
      { name: "Weekly Pool Service", description: "Recurring cleaning, water testing, and chemical balancing", priceType: "from" },
      { name: "Pool Opening / Closing", description: "Seasonal opening and winterization service", priceType: "from" },
      { name: "Equipment Repair", description: "Pumps, heaters, filters, and automation repair", priceType: "from" },
      { name: "Green-to-Clean Recovery", description: "Restore a neglected or algae-filled pool to swimmable", priceType: "quote" },
      { name: "Leak Detection & Repair", description: "Locate and repair pool and plumbing leaks", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 3 },
      { type: "contact", title: "Request Service", sortOrder: 4 },
    ],
    formSchema: [
      ...TRADES_FORM_FIELDS,
      { name: "poolType", label: "Pool / spa type", type: "select" as const, required: false, options: ["In-ground pool", "Above-ground pool", "Spa / hot tub", "Pool and spa combo"] },
      { name: "frequency", label: "Service frequency", type: "select" as const, required: false, options: ["One-off", "Weekly", "Fortnightly", "Monthly", "Seasonal"] },
    ],
    activationProfile: TRADES_DISPATCH_RECURRING,
  },
  {
    archetypeId: "pressure-washing",
    name: "Pressure Washing & Exterior Cleaning",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["pressure washing", "power washing", "soft wash", "exterior cleaning", "driveway", "trades"],
    itemTemplates: [
      { name: "House Soft Wash", description: "Low-pressure exterior wash for siding, render, and brick", priceType: "from" },
      { name: "Driveway & Concrete Cleaning", description: "Pressure cleaning for driveways, paths, and patios", priceType: "from" },
      { name: "Deck & Fence Cleaning", description: "Restore timber and composite decking and fences", priceType: "from" },
      { name: "Roof Cleaning", description: "Soft-wash moss and algae removal from roofs", priceType: "quote" },
      { name: "Gutter Clearing", description: "Clear and flush blocked gutters and downpipes", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "gallery", title: "Before & After", sortOrder: 2 },
      { type: "about", title: "About Us", sortOrder: 3 },
      { type: "contact", title: "Request a Quote", sortOrder: 4 },
    ],
    formSchema: [
      ...TRADES_FORM_FIELDS,
      { name: "surfaceType", label: "Surface to clean", type: "select" as const, required: false, options: ["House exterior", "Driveway / concrete", "Deck / fence", "Roof", "Gutters", "Multiple"] },
    ],
    activationProfile: TRADES_DISPATCH_ONE_OFF,
  },
  {
    // Project-flavored: replacements are quoted, milestone-billed builds. OSHA
    // fall-protection is a capability-layer compliance overlay (design ADR-5).
    archetypeId: "roofing-gutters",
    name: "Roofing & Gutters",
    category: "trades-maintenance",
    ctaType: "inquiry",
    tags: ["roofing", "roofer", "roof repair", "roof replacement", "gutters", "storm damage", "trades"],
    itemTemplates: [
      { name: "Roof Inspection", description: "Condition survey with a photo report and recommendations", priceType: "from" },
      { name: "Roof Repair", description: "Leak, flashing, and storm-damage repair", priceType: "from" },
      { name: "Roof Replacement", description: "Full re-roof — quoted after an inspection", priceType: "quote" },
      { name: "Gutter Installation", description: "New seamless gutters and downpipes", priceType: "from" },
      { name: "Storm Damage & Emergency Tarp", description: "Rapid response and temporary weatherproofing", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "gallery", title: "Our Work", sortOrder: 2 },
      { type: "about", title: "About Us", sortOrder: 3 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 4 },
      { type: "contact", title: "Request a Quote", sortOrder: 5 },
    ],
    formSchema: [
      ...TRADES_FORM_FIELDS,
      { name: "serviceType", label: "What do you need?", type: "select" as const, required: true, options: ["Inspection", "Repair", "Full replacement", "Gutters", "Storm damage", "Not sure"] },
      { name: "roofType", label: "Roof type (if known)", type: "select" as const, required: false, options: ["Asphalt shingle", "Tile", "Metal", "Flat / membrane", "Slate", "Not sure"] },
    ],
    activationProfile: TRADES_DISPATCH_PROJECT,
  },
];
