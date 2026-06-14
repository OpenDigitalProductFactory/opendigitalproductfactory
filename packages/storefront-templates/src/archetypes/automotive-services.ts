import type { ArchetypeDefinition } from "../types";

// Automotive field services: a technician travels to the customer's vehicle
// (driveway, workplace, roadside) rather than the customer coming to a shop.
// form=services + delivery=physical + consumptionChannel=onsite-plus-portal is
// what the forthcoming horizontal Field Dispatch capability reads via
// needsFieldDispatch(axes) to derive the dispatch board, technician routing, and
// map-pin "Dispatch" action — no per-archetype flag (capability design ADR-1/2).
// Until that module ships, field work composes under service-operations.
//
// The distinctive substrate here is VIN→part resolution and the ADAS
// (Advanced Driver-Assistance Systems) calibration compliance overlay for auto
// glass — a moat sibling to HVAC's EPA 608 that no FSM in the market covers.
// Those overlays are captured at the capability layer (design ADR-5), not in the
// storefront template.

const AUTO_CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: true },
];

const VEHICLE_FIELDS = [
  { name: "vehicle", label: "Vehicle (year, make, model)", type: "text" as const, required: true, placeholder: "e.g. 2021 Toyota RAV4" },
  { name: "vin", label: "VIN (if known)", type: "text" as const, required: false, placeholder: "Helps us quote the exact part" },
  { name: "serviceAddress", label: "Service location", type: "text" as const, required: true, placeholder: "Where the vehicle will be" },
];

// Scheduled mobile auto service — settles at the appointment (pay the tech on
// completion).
const AUTO_MOBILE_ACTIVATION: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: ["service-operations"],
  billingReadinessMode: "none",
  customerGraph: "none",
  estateSeparation: "shared",
  axes: {
    form: "services",
    delivery: "physical",
    primaryConsumer: "individual",
    consumptionChannel: "onsite-plus-portal",
    commercialModel: "appointment-checkout",
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

// Real-time emergency dispatch — roadside and locksmith are per-incident calls,
// not scheduled appointments.
const AUTO_EMERGENCY_ACTIVATION: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: ["service-operations"],
  billingReadinessMode: "none",
  customerGraph: "none",
  estateSeparation: "shared",
  axes: {
    form: "services",
    delivery: "physical",
    primaryConsumer: "individual",
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

export const automotiveServicesArchetypes: ArchetypeDefinition[] = [
  {
    // The capability spec's named example (Mark's windshield case). VIN→glass-SKU
    // resolution and the post-install ADAS calibration certificate are the
    // distinctive substrate; calibration is a capability-layer compliance overlay.
    archetypeId: "auto-glass",
    name: "Windshield & Auto Glass Replacement",
    category: "automotive-services",
    ctaType: "inquiry",
    tags: ["auto glass", "windshield", "windscreen", "adas", "calibration", "chip repair", "mobile", "automotive"],
    itemTemplates: [
      { name: "Windshield Replacement", description: "Full windshield replacement with OEM-quality glass — quoted from your VIN", priceType: "quote" },
      { name: "Rock Chip / Crack Repair", description: "Resin repair to stop a chip or crack from spreading", priceType: "fixed" },
      { name: "Side & Rear Glass", description: "Door, quarter, and back-glass replacement", priceType: "from" },
      { name: "ADAS Calibration", description: "Recalibrate driver-assistance cameras and sensors after glass replacement", priceType: "from" },
      { name: "Mobile Service", description: "We come to your home or workplace — no shop visit needed", priceType: "free" },
      { name: "Fleet & Commercial Glass", description: "Volume glass service for fleets and dealerships", priceType: "quote" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 3 },
      { type: "contact", title: "Get a Quote", sortOrder: 4 },
    ],
    formSchema: [
      ...AUTO_CONTACT_FIELDS,
      ...VEHICLE_FIELDS,
      { name: "damageType", label: "What needs fixing?", type: "select" as const, required: true, options: ["Windshield replacement", "Chip / crack repair", "Side window", "Rear glass", "ADAS calibration", "Not sure"] },
      { name: "insuranceClaim", label: "Filing an insurance claim?", type: "select" as const, required: false, options: ["Yes", "No", "Not sure"] },
    ],
    activationProfile: AUTO_MOBILE_ACTIVATION,
  },
  {
    archetypeId: "mobile-mechanic",
    name: "Mobile Mechanic",
    category: "automotive-services",
    ctaType: "inquiry",
    tags: ["mobile mechanic", "auto repair", "car repair", "diagnostics", "automotive", "at-home"],
    itemTemplates: [
      { name: "Diagnostic Visit", description: "On-site diagnosis of warning lights and faults", priceType: "fixed" },
      { name: "Brake Service", description: "Pad, rotor, and brake-fluid service at your location", priceType: "from" },
      { name: "Battery / Alternator / Starter", description: "Charging-system diagnosis and replacement", priceType: "from" },
      { name: "Oil & Filter Change", description: "Mobile oil and filter service", priceType: "fixed" },
      { name: "Pre-Purchase Inspection", description: "Independent inspection before you buy a used car", priceType: "fixed" },
      { name: "No-Start / Won't-Run", description: "Diagnose and fix a vehicle that won't start", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 3 },
      { type: "contact", title: "Book a Mechanic", sortOrder: 4 },
    ],
    formSchema: [
      ...AUTO_CONTACT_FIELDS,
      ...VEHICLE_FIELDS,
      { name: "symptom", label: "What's the problem?", type: "textarea" as const, required: false, placeholder: "Describe the symptoms or service you need" },
    ],
    activationProfile: AUTO_MOBILE_ACTIVATION,
  },
  {
    archetypeId: "mobile-detailing",
    name: "Mobile Auto Detailing",
    category: "automotive-services",
    ctaType: "inquiry",
    tags: ["auto detailing", "car wash", "mobile detailing", "ceramic coating", "valeting", "automotive"],
    itemTemplates: [
      { name: "Full Detail", description: "Interior and exterior deep clean and protection", priceType: "from" },
      { name: "Interior Detail", description: "Vacuum, shampoo, and condition the cabin", priceType: "from" },
      { name: "Exterior Wash & Wax", description: "Hand wash, clay, and wax for lasting shine", priceType: "from" },
      { name: "Ceramic Coating", description: "Long-life paint protection — quoted after assessment", priceType: "quote" },
      { name: "Headlight Restoration", description: "Restore clarity to cloudy headlights", priceType: "fixed" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Packages", sortOrder: 1 },
      { type: "gallery", title: "Before & After", sortOrder: 2 },
      { type: "about", title: "About Us", sortOrder: 3 },
      { type: "contact", title: "Book a Detail", sortOrder: 4 },
    ],
    formSchema: [
      ...AUTO_CONTACT_FIELDS,
      ...VEHICLE_FIELDS,
      { name: "package", label: "Package of interest", type: "select" as const, required: false, options: ["Full detail", "Interior", "Exterior wash & wax", "Ceramic coating", "Not sure"] },
    ],
    activationProfile: AUTO_MOBILE_ACTIVATION,
  },
  {
    archetypeId: "mobile-tire",
    name: "Mobile Tire Service",
    category: "automotive-services",
    ctaType: "inquiry",
    tags: ["mobile tire", "tyres", "tire replacement", "flat repair", "tpms", "automotive"],
    itemTemplates: [
      { name: "Tire Replacement", description: "Supply and fit new tires at your location", priceType: "from" },
      { name: "Flat Repair", description: "Plug or patch a repairable puncture", priceType: "fixed" },
      { name: "Rotation & Balance", description: "Rotate and balance for even wear", priceType: "fixed" },
      { name: "TPMS Service", description: "Tire-pressure sensor diagnosis and replacement", priceType: "from" },
      { name: "Seasonal Swap", description: "Switch between summer and winter tires", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "contact", title: "Request Service", sortOrder: 3 },
    ],
    formSchema: [
      ...AUTO_CONTACT_FIELDS,
      ...VEHICLE_FIELDS,
      { name: "tireSize", label: "Tire size (if known)", type: "text" as const, required: false, placeholder: "e.g. 225/65R17" },
      { name: "serviceNeeded", label: "Service needed", type: "select" as const, required: false, options: ["New tires", "Flat repair", "Rotation & balance", "TPMS", "Seasonal swap", "Not sure"] },
    ],
    activationProfile: AUTO_MOBILE_ACTIVATION,
  },
  {
    // Real-time dispatch: location-based, time-critical, motor-club integrations.
    // DOT applies to towing operations (capability-layer overlay).
    archetypeId: "roadside-assistance",
    name: "Roadside Assistance & Towing",
    category: "automotive-services",
    ctaType: "inquiry",
    tags: ["roadside assistance", "towing", "tow truck", "jump start", "lockout", "recovery", "automotive"],
    itemTemplates: [
      { name: "Jump Start", description: "Get a dead battery started and back on the road", priceType: "fixed" },
      { name: "Lockout Service", description: "Locked out of your vehicle? We'll get you in", priceType: "fixed" },
      { name: "Flat Tire Change", description: "Swap to your spare at the roadside", priceType: "fixed" },
      { name: "Fuel Delivery", description: "Out of fuel? We bring enough to reach a station", priceType: "fixed" },
      { name: "Towing", description: "Tow to the repair shop or destination of your choice", priceType: "from" },
      { name: "Winch-Out / Recovery", description: "Recover a vehicle stuck off the road", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "contact", title: "Request Help Now", sortOrder: 3 },
    ],
    formSchema: [
      ...AUTO_CONTACT_FIELDS,
      { name: "location", label: "Your current location", type: "text" as const, required: true, placeholder: "Address, highway marker, or what's nearby" },
      { name: "vehicle", label: "Vehicle (year, make, model)", type: "text" as const, required: false },
      { name: "situation", label: "What happened?", type: "select" as const, required: true, options: ["Dead battery", "Locked out", "Flat tire", "Out of fuel", "Need a tow", "Stuck / off-road", "Other"] },
    ],
    activationProfile: AUTO_EMERGENCY_ACTIVATION,
  },
  {
    // Serves both vehicles and property (auto + residential), so it sits in
    // automotive but the serviced entity spans vehicle and property-site.
    archetypeId: "locksmith",
    name: "Locksmith (Auto & Residential)",
    category: "automotive-services",
    ctaType: "inquiry",
    tags: ["locksmith", "car key", "key programming", "lockout", "rekey", "automotive", "residential"],
    itemTemplates: [
      { name: "Car Lockout", description: "Fast entry when you're locked out of your vehicle", priceType: "fixed" },
      { name: "Car Key Replacement & Programming", description: "Cut and program transponder and smart keys", priceType: "from" },
      { name: "Home / Business Lockout", description: "Regain entry to a locked property", priceType: "fixed" },
      { name: "Rekey & Lock Change", description: "Rekey existing locks or install new ones", priceType: "from" },
      { name: "Lock Installation & Upgrade", description: "Install deadbolts, smart locks, and high-security hardware", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "contact", title: "Request a Locksmith", sortOrder: 3 },
    ],
    formSchema: [
      ...AUTO_CONTACT_FIELDS,
      { name: "location", label: "Service location", type: "text" as const, required: true },
      { name: "serviceType", label: "What do you need?", type: "select" as const, required: true, options: ["Car lockout", "Car key / fob", "Home / business lockout", "Rekey / lock change", "New lock install", "Other"] },
    ],
    activationProfile: AUTO_EMERGENCY_ACTIVATION,
  },
];
