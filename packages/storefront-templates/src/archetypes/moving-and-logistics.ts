import type { ArchetypeDefinition } from "../types";

// Moving & last-mile logistics: a crew and a truck travel to the customer to
// load, haul, and deliver. form=services + delivery=physical +
// consumptionChannel=onsite-plus-portal is what derives the forthcoming Field
// Dispatch capability (crew+truck routing, on-my-way ETAs). The DOT
// hours-of-service overlay is a capability-layer compliance concern (Field
// Dispatch design ADR-5), not modelled in the template. Distinct from
// wholesale-distribution (B2B route delivery of a goods brand's own stock).

const CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: true },
];

// Consumer move/haul — household primary, quoted per job.
const MOVING_HOUSEHOLD_ACTIVATION: ArchetypeDefinition["activationProfile"] = {
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

// B2B courier / freight — business accounts, recurring routes; customer-accounts
// derive from the business consumer.
const LOGISTICS_B2B_ACTIVATION: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: ["customer-estate", "service-operations", "billing-readiness"],
  billingReadinessMode: "prepared-not-prescribed",
  customerGraph: "separate-customer-projection",
  estateSeparation: "shared",
  axes: {
    form: "services",
    delivery: "physical",
    primaryConsumer: "business",
    consumptionChannel: "onsite-plus-portal",
    commercialModel: "account-based-fees",
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

// Non-asset freight brokerage — the one leaf in this category that is NOT
// dispatch-native. The broker sells from a desk, so `consumptionChannel` is
// `sales-assisted` rather than `onsite-plus-portal`; that alone makes
// `needsFieldDispatch` derive false, so no `fieldDispatch` override is needed.
// Revenue is the spread on a load, which reads as account-based fees against a
// shipper account rather than a per-job transaction.
const FREIGHT_BROKERAGE_ACTIVATION: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: ["customer-estate", "service-operations", "billing-readiness", "integrations"],
  billingReadinessMode: "prepared-not-prescribed",
  customerGraph: "separate-customer-projection",
  estateSeparation: "shared",
  axes: {
    form: "services",
    delivery: "physical",
    primaryConsumer: "business",
    consumptionChannel: "sales-assisted",
    commercialModel: "account-based-fees",
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

export const movingAndLogisticsArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "moving-company",
    name: "Moving Company",
    category: "moving-and-logistics",
    ctaType: "inquiry",
    tags: ["movers", "moving company", "relocation", "packing", "removals", "logistics"],
    itemTemplates: [
      { name: "Local Move", description: "Door-to-door move within the metro area", priceType: "from" },
      { name: "Long-Distance Move", description: "Interstate or cross-country relocation — quoted", priceType: "quote" },
      { name: "Packing & Unpacking", description: "Professional packing with materials supplied", priceType: "from" },
      { name: "Loading / Unloading Only", description: "Labor-only help for a rented truck or container", priceType: "from" },
      { name: "Specialty Item Move", description: "Pianos, safes, and oversized or fragile items", priceType: "quote" },
      { name: "Short-Term Storage", description: "Secure storage between move-out and move-in", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 3 },
      { type: "contact", title: "Get a Moving Quote", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "moveFrom", label: "Moving from", type: "text" as const, required: true, placeholder: "Origin address or area" },
      { name: "moveTo", label: "Moving to", type: "text" as const, required: true, placeholder: "Destination address or area" },
      { name: "homeSize", label: "Home size", type: "select" as const, required: true, options: ["Studio / 1 bed", "2 bed", "3 bed", "4+ bed", "Office / commercial"] },
      { name: "moveDate", label: "Preferred move date", type: "text" as const, required: false, placeholder: "DD/MM/YYYY" },
    ],
    activationProfile: MOVING_HOUSEHOLD_ACTIVATION,
  },
  {
    archetypeId: "junk-removal",
    name: "Junk Removal & Hauling",
    category: "moving-and-logistics",
    ctaType: "inquiry",
    tags: ["junk removal", "hauling", "rubbish removal", "cleanout", "debris", "logistics"],
    itemTemplates: [
      { name: "Single-Item Pickup", description: "Haul away one large item (sofa, fridge, mattress)", priceType: "fixed" },
      { name: "Truck-Load Haul", description: "Fill our truck — priced by volume", priceType: "from" },
      { name: "Furniture & Appliance Removal", description: "Remove and responsibly dispose of bulky goods", priceType: "from" },
      { name: "Estate / Property Cleanout", description: "Full cleanout of a home, garage, or unit", priceType: "quote" },
      { name: "Construction Debris", description: "Haul away renovation and construction waste", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "gallery", title: "Before & After", sortOrder: 2 },
      { type: "about", title: "About Us", sortOrder: 3 },
      { type: "contact", title: "Book a Pickup", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "pickupAddress", label: "Pickup address", type: "text" as const, required: true },
      { name: "itemsDescription", label: "What needs hauling?", type: "textarea" as const, required: false, placeholder: "Describe the items or volume" },
    ],
    activationProfile: MOVING_HOUSEHOLD_ACTIVATION,
  },
  {
    archetypeId: "courier-delivery",
    name: "Courier & Delivery Service",
    category: "moving-and-logistics",
    ctaType: "inquiry",
    tags: ["courier", "delivery", "same-day", "medical courier", "dispatch", "logistics"],
    itemTemplates: [
      { name: "Same-Day Courier", description: "On-demand pickup and delivery across the metro", priceType: "from" },
      { name: "Scheduled Route", description: "Recurring scheduled pickups for business clients", priceType: "quote" },
      { name: "Medical / Lab Courier", description: "Time- and temperature-sensitive specimen transport", priceType: "quote" },
      { name: "Legal & Document Courier", description: "Chain-of-custody delivery for sensitive documents", priceType: "from" },
      { name: "Account Setup", description: "Open a business account with consolidated billing", priceType: "free" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "contact", title: "Request a Pickup", sortOrder: 3 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "companyName", label: "Company name", type: "text" as const, required: false },
      { name: "pickupAddress", label: "Pickup address", type: "text" as const, required: true },
      { name: "deliveryAddress", label: "Delivery address", type: "text" as const, required: true },
      { name: "serviceType", label: "Service type", type: "select" as const, required: false, options: ["Same-day", "Scheduled route", "Medical / lab", "Legal / document", "Not sure"] },
    ],
    activationProfile: LOGISTICS_B2B_ACTIVATION,
  },
  {
    archetypeId: "last-mile-freight",
    name: "Last-Mile Freight & Delivery",
    category: "moving-and-logistics",
    ctaType: "inquiry",
    tags: ["last mile", "freight", "ltl", "delivery", "white glove", "logistics", "b2b"],
    itemTemplates: [
      { name: "LTL / Local Freight", description: "Less-than-truckload local and regional delivery", priceType: "quote" },
      { name: "White-Glove Freight", description: "Delivery with placement, assembly, and packaging removal", priceType: "from" },
      { name: "Scheduled Distribution Route", description: "Recurring multi-stop delivery routes", priceType: "quote" },
      { name: "Returns & Reverse Logistics", description: "Scheduled pickup of returns and exchanges", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "contact", title: "Request a Quote", sortOrder: 3 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "companyName", label: "Company name", type: "text" as const, required: true },
      { name: "volume", label: "Estimated volume / frequency", type: "select" as const, required: false, options: ["One-off shipment", "Daily", "Weekly", "Multiple times a week"] },
      { name: "details", label: "What do you need delivered?", type: "textarea" as const, required: false },
    ],
    activationProfile: LOGISTICS_B2B_ACTIVATION,
  },
  {
    // Non-asset freight brokerage: matches a shipper's load to a carrier's
    // capacity on a lane and earns the spread (typically ~15%). It owns no
    // trucks and takes no custody, so it is neither a custody archetype
    // (warehousing-fulfilment) nor a dispatch one — a broker moves other
    // people's vehicles and has no fleet of its own to route. US operation
    // requires FMCSA broker authority and a $75,000 surety bond; that is a
    // compliance overlay, not template substrate.
    archetypeId: "freight-brokerage",
    name: "Freight Brokerage & Forwarding",
    category: "moving-and-logistics",
    ctaType: "inquiry",
    tags: ["freight broker", "brokerage", "freight forwarding", "load matching", "3pl", "logistics", "b2b"],
    itemTemplates: [
      { name: "Full Truckload (FTL)", description: "A dedicated trailer for your load, priced by lane", priceType: "quote" },
      { name: "Less-Than-Truckload (LTL)", description: "Shared trailer space, priced by freight class and weight", priceType: "quote" },
      { name: "Expedited & Hot-Shot Freight", description: "Time-critical loads covered at short notice", priceType: "quote" },
      { name: "Specialised & Oversized Freight", description: "Flatbed, reefer, and out-of-gauge loads", priceType: "quote" },
      { name: "Freight Forwarding & Customs", description: "International movements with customs documentation handled", priceType: "quote" },
      { name: "Carrier Onboarding", description: "Join our carrier network — authority and insurance verified", priceType: "free" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "What Shippers Say", sortOrder: 3 },
      { type: "contact", title: "Get a Freight Quote", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "companyName", label: "Company name", type: "text" as const, required: true },
      { name: "enquiryType", label: "I am a", type: "select" as const, required: true, options: ["Shipper with freight to move", "Carrier looking for loads", "Both"] },
      { name: "originDestination", label: "Origin and destination", type: "text" as const, required: false, placeholder: "Collection city / postcode to delivery city / postcode" },
      { name: "freightMode", label: "Freight mode", type: "select" as const, required: false, options: ["Full truckload (FTL)", "Less-than-truckload (LTL)", "Expedited", "Specialised / oversized", "International", "Not sure"] },
      { name: "loadDetails", label: "Load details", type: "textarea" as const, required: false, placeholder: "Commodity, weight, pallet count, and any timing requirements" },
    ],
    // A broker's board IS a pipeline — loads moving quote → tender → covered →
    // in transit → delivered → invoiced — so PIPELINE is the right template,
    // but its default nouns ("matters", "professionals") are a law-firm's.
    // ADR-4 override rebinds them to the trade's own words.
    twinProfile: {
      resourceNoun: { singular: "broker", plural: "brokers" },
      workItemNoun: { singular: "load", plural: "loads" },
      queues: [
        { key: "quotes", label: "Quotes out" },
        { key: "uncovered", label: "Loads to cover" },
        { key: "intransit", label: "In transit" },
      ],
      capacityChips: ["loads to cover", "margin per load", "in transit"],
    },
    activationProfile: FREIGHT_BROKERAGE_ACTIVATION,
  },
];
