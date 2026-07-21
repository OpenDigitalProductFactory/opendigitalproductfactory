import type { ArchetypeDefinition } from "../types";

// Warehousing & fulfilment: the operator takes custody of goods it does not own
// and is paid to hold and handle them. `provisioning: "custody-and-fulfilment"`
// is the discriminator — it derives the goods-custody / warehouse-operations /
// storage-and-handling-billing triad, the Receive & Store value-stream stage,
// and the DOCK twin, and it excludes field dispatch (the work happens at the
// operator's facility, not the customer's site).
//
// Distinct from asset-rental's `self-storage` (customer keeps the key, no
// custody, no handling), from retail-goods' `wholesale-distribution` (sells
// stock it owns), and from moving-and-logistics (custody is transient and
// in-transit, with no facility inventory of record).
//
// Design: docs/superpowers/specs/2026-07-21-warehousing-fulfilment-archetype-design.md

const CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: true },
  { name: "companyName", label: "Company name", type: "text" as const, required: true },
];

// Custody work is contracted per client account against a rate card, with
// storage and handling billed as two meters on one invoice. `sales-assisted` is
// the honest consumption channel: a 3PL relationship starts with a scoping
// conversation and a rate card, not a self-serve checkout.
const CUSTODY_ACTIVATION: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: [
    "customer-estate",
    "service-operations",
    "billing-readiness",
    "service-agreements",
    "integrations",
  ],
  billingReadinessMode: "prepared-not-prescribed",
  customerGraph: "separate-customer-projection",
  // One client's stock must never surface in another's view — the multi-client
  // tenancy that defines a 3PL WMS.
  estateSeparation: "strict",
  axes: {
    form: "services",
    delivery: "physical",
    primaryConsumer: "business",
    consumptionChannel: "sales-assisted",
    commercialModel: "account-based-fees",
    provisioning: "custody-and-fulfilment",
    platform: "no",
  },
  portfolios: {
    foundational: { scope: "minimal" },
    manufactureAndDeliver: {
      scope: "primary",
      it4itStages: ["request-to-fulfill", "detect-to-correct"],
    },
    forEmployees: { scope: "standard" },
    productsAndServicesSold: { scope: "primary" },
  },
};

const CUSTODY_SECTIONS: ArchetypeDefinition["sectionTemplates"] = [
  { type: "hero", title: "Hero", sortOrder: 0 },
  { type: "items", title: "Services", sortOrder: 1 },
  { type: "about", title: "About Us", sortOrder: 2 },
  { type: "gallery", title: "Our Facility", sortOrder: 3 },
  { type: "contact", title: "Request a Quote", sortOrder: 4 },
];

export const warehousingFulfilmentArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "third-party-logistics",
    name: "3PL Contract Warehousing",
    category: "warehousing-fulfilment",
    ctaType: "inquiry",
    tags: ["3pl", "warehousing", "contract storage", "pallet storage", "custody", "logistics", "b2b"],
    itemTemplates: [
      { name: "Pallet Storage", description: "Racked pallet positions billed per pallet per month", priceType: "from" },
      { name: "Goods-In & Receiving", description: "Booking in, checking against the ASN, and put-away", priceType: "from" },
      { name: "Pick & Despatch", description: "Order picking, packing, and handover to your carrier", priceType: "from" },
      { name: "Bonded & Duty-Suspended Storage", description: "Customs-bonded storage for imported goods", priceType: "quote" },
      { name: "Kitting & Value-Added Services", description: "Assembly, relabelling, and repacking to your spec", priceType: "quote" },
      { name: "Stock Reporting & Cycle Counts", description: "Live stock visibility with scheduled count cycles", priceType: "quote" },
    ],
    sectionTemplates: CUSTODY_SECTIONS,
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "palletVolume", label: "Approximate pallets stored", type: "select" as const, required: true, options: ["Under 50", "50–250", "250–1,000", "1,000–5,000", "Over 5,000"] },
      { name: "throughput", label: "Typical throughput", type: "select" as const, required: false, options: ["A few pallets a week", "Daily inbound and outbound", "High-volume, multiple loads a day", "Seasonal peaks only"] },
      { name: "goodsType", label: "What are you storing?", type: "textarea" as const, required: false, placeholder: "Product type, packaging, any handling or hazard requirements" },
    ],
    activationProfile: CUSTODY_ACTIVATION,
  },
  {
    archetypeId: "ecommerce-fulfilment",
    name: "E-Commerce Fulfilment Centre",
    category: "warehousing-fulfilment",
    ctaType: "inquiry",
    tags: ["fulfilment", "fulfillment", "pick and pack", "ecommerce", "d2c", "3pl", "custody", "logistics"],
    itemTemplates: [
      { name: "Pick & Pack", description: "Per-order picking and packing with your branded packaging", priceType: "from" },
      { name: "Storage by Bin or Pallet", description: "Flexible storage scaled to your SKU count", priceType: "from" },
      { name: "Same-Day Despatch", description: "Orders received before cut-off ship the same day", priceType: "from" },
      { name: "Returns Processing", description: "Inspect, restock or dispose, and refund-ready reporting", priceType: "from" },
      { name: "Channel & Marketplace Integration", description: "Connect your store and marketplaces for automatic order flow", priceType: "quote" },
      { name: "Subscription & Bundle Fulfilment", description: "Recurring boxes and multi-item bundles assembled to order", priceType: "quote" },
    ],
    sectionTemplates: CUSTODY_SECTIONS,
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "monthlyOrders", label: "Orders per month", type: "select" as const, required: true, options: ["Under 250", "250–1,000", "1,000–5,000", "5,000–20,000", "Over 20,000"] },
      { name: "skuCount", label: "Number of SKUs", type: "select" as const, required: false, options: ["Under 20", "20–100", "100–500", "Over 500"] },
      { name: "salesChannels", label: "Where do you sell?", type: "textarea" as const, required: false, placeholder: "Shopify, Amazon, eBay, your own site, wholesale…" },
    ],
    activationProfile: CUSTODY_ACTIVATION,
  },
  {
    archetypeId: "cold-chain-storage",
    name: "Cold & Temperature-Controlled Storage",
    category: "warehousing-fulfilment",
    ctaType: "inquiry",
    tags: ["cold storage", "chilled", "frozen", "temperature controlled", "cold chain", "custody", "logistics"],
    itemTemplates: [
      { name: "Frozen Storage", description: "Deep-frozen pallet storage with continuous monitoring", priceType: "from" },
      { name: "Chilled Storage", description: "Temperature-controlled storage for fresh and chilled goods", priceType: "from" },
      { name: "Ambient Storage", description: "Standard racked storage alongside your cold lines", priceType: "from" },
      { name: "Blast Freezing", description: "Rapid freezing on intake to protect product quality", priceType: "quote" },
      { name: "Temperature Monitoring & Reporting", description: "Continuous logging with audit-ready temperature records", priceType: "quote" },
      { name: "Pharma & GDP-Compliant Storage", description: "Validated storage under Good Distribution Practice", priceType: "quote" },
    ],
    sectionTemplates: CUSTODY_SECTIONS,
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "temperatureRange", label: "Temperature required", type: "select" as const, required: true, options: ["Ambient", "Chilled (0–8°C)", "Frozen (−18°C or below)", "Deep frozen (−25°C or below)", "Mixed / multiple ranges"] },
      { name: "palletVolume", label: "Approximate pallets stored", type: "select" as const, required: false, options: ["Under 50", "50–250", "250–1,000", "Over 1,000"] },
      { name: "complianceNeeds", label: "Compliance requirements", type: "textarea" as const, required: false, placeholder: "BRC, GDP, organic, halal, or other certification you need us to hold" },
    ],
    activationProfile: CUSTODY_ACTIVATION,
  },
  {
    archetypeId: "cross-dock-transload",
    name: "Cross-Dock & Transload",
    category: "warehousing-fulfilment",
    ctaType: "inquiry",
    tags: ["cross dock", "crossdock", "transload", "consolidation", "deconsolidation", "custody", "logistics"],
    itemTemplates: [
      { name: "Cross-Docking", description: "Inbound to outbound within hours — no storage charge", priceType: "from" },
      { name: "Container Devanning", description: "Unload containers and rework to pallets or cases", priceType: "from" },
      { name: "Consolidation & Deconsolidation", description: "Combine or split loads to suit onward delivery", priceType: "from" },
      { name: "Trailer & Yard Parking", description: "Secure yard space for drop trailers and containers", priceType: "from" },
      { name: "Short-Term Overflow Storage", description: "Buffer storage when the onward leg is delayed", priceType: "quote" },
    ],
    sectionTemplates: CUSTODY_SECTIONS,
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "flowType", label: "What do you need?", type: "select" as const, required: true, options: ["Cross-dock, straight through", "Container devanning", "Consolidation", "Deconsolidation", "Not sure — advise me"] },
      { name: "loadsPerWeek", label: "Loads per week", type: "select" as const, required: false, options: ["1–5", "5–20", "20–50", "Over 50"] },
      { name: "details", label: "Tell us about the flow", type: "textarea" as const, required: false, placeholder: "Origin, destination, handling units, and any timing constraints" },
    ],
    activationProfile: CUSTODY_ACTIVATION,
  },
];
