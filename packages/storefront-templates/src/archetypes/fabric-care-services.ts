import type { ArchetypeDefinition } from "../types";

// Fabric-care services: customer garments/textiles are accepted at a counter or
// via pickup, tagged to a claim ticket, processed through a plant/workroom, and
// returned to the same customer against a ready promise.
//
// Design: docs/superpowers/specs/2026-07-22-fabric-care-services-archetype-design.md

const CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: true },
];

const FABRIC_CARE_ACTIVATION: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: [
    "customer-estate",
    "service-operations",
    "billing-readiness",
    "integrations",
  ],
  billingReadinessMode: "prepared-not-prescribed",
  customerGraph: "separate-customer-projection",
  estateSeparation: "strict",
  axes: {
    form: "services",
    delivery: "physical",
    primaryConsumer: "individual",
    consumptionChannel: "multi-channel",
    commercialModel: "point-of-sale",
    provisioning: "account-with-billing",
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

const FABRIC_CARE_SECTIONS: ArchetypeDefinition["sectionTemplates"] = [
  { type: "hero", title: "Hero", sortOrder: 0 },
  { type: "items", title: "Services", sortOrder: 1 },
  { type: "about", title: "About Us", sortOrder: 2 },
  { type: "gallery", title: "Locations & Plant", sortOrder: 3 },
  { type: "contact", title: "Request Service", sortOrder: 4 },
];

export const fabricCareServicesArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "dry-cleaning-plant-network",
    name: "Dry Cleaning Plant & Store Network",
    category: "fabric-care-services",
    ctaType: "inquiry",
    tags: [
      "dry cleaning",
      "laundry",
      "plant",
      "satellite stores",
      "claim ticket",
      "garment tracking",
      "pickup and delivery",
    ],
    itemTemplates: [
      { name: "Dry Cleaning", description: "Garments tagged to a claim ticket, cleaned, pressed, and returned ready for pickup", priceType: "from" },
      { name: "Laundry & Press", description: "Shirts and everyday laundry processed through the plant with ready-by notification", priceType: "from" },
      { name: "Wash & Fold", description: "Bagged household laundry weighed, processed, folded, and returned by promised date", priceType: "from" },
      { name: "Alterations & Repairs", description: "Hemming, buttons, small repairs, and tailoring routed to the workroom", priceType: "quote" },
      { name: "Pickup & Delivery", description: "Scheduled route service from home, office, or satellite drop point", priceType: "quote" },
      { name: "Wedding Gown & Specialty Care", description: "Inspection, special handling, preservation, and clear exception communication", priceType: "quote" },
    ],
    sectionTemplates: FABRIC_CARE_SECTIONS,
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "preferredLocation", label: "Preferred location", type: "text" as const, required: false, placeholder: "Main plant, satellite store, or pickup area" },
      { name: "serviceMode", label: "How can we help?", type: "select" as const, required: true, options: ["Drop off", "Pickup and delivery", "Alteration", "Commercial account", "Question about an existing claim ticket"] },
      { name: "neededBy", label: "Needed by", type: "text" as const, required: false, placeholder: "Date or event deadline" },
      { name: "garmentNotes", label: "Garment or order notes", type: "textarea" as const, required: false, placeholder: "Garment count, stains, care instructions, claim ticket number, or delivery notes" },
    ],
    activationProfile: FABRIC_CARE_ACTIVATION,
  },
  {
    archetypeId: "wash-and-fold-laundry",
    name: "Wash & Fold Laundry",
    category: "fabric-care-services",
    ctaType: "inquiry",
    tags: ["laundry", "wash and fold", "bag tracking", "pickup and delivery", "subscriptions", "laundromat"],
    itemTemplates: [
      { name: "Wash & Fold by the Pound", description: "Every bag tagged to the customer, weighed, washed, folded, and marked ready", priceType: "from" },
      { name: "Recurring Laundry Plan", description: "Weekly or biweekly pickup, processing, and return with account billing readiness", priceType: "from" },
      { name: "Comforters & Household Textiles", description: "Bulky household laundry with clear ready-by estimate", priceType: "from" },
      { name: "Commercial Laundry", description: "Small-business towel, linen, or uniform laundry priced by volume", priceType: "quote" },
      { name: "Pickup & Delivery", description: "Route pickup and return with ready and driver communication", priceType: "quote" },
    ],
    sectionTemplates: FABRIC_CARE_SECTIONS,
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "preferredLocation", label: "Preferred location or pickup area", type: "text" as const, required: false },
      { name: "serviceMode", label: "Service type", type: "select" as const, required: true, options: ["One-time wash & fold", "Recurring plan", "Household textile", "Commercial laundry"] },
      { name: "neededBy", label: "Needed by", type: "text" as const, required: false },
      { name: "garmentNotes", label: "Laundry notes", type: "textarea" as const, required: false, placeholder: "Approximate bags, detergent preference, pickup instructions, or special handling" },
    ],
    activationProfile: FABRIC_CARE_ACTIVATION,
  },
  {
    archetypeId: "alterations-tailoring",
    name: "Alterations & Tailoring",
    category: "fabric-care-services",
    ctaType: "inquiry",
    tags: ["alterations", "tailoring", "repairs", "hemming", "fittings", "garment custody"],
    itemTemplates: [
      { name: "Hemming & Shortening", description: "Garment checked in, ticketed, fitted, altered, and marked ready for pickup", priceType: "from" },
      { name: "Repairs & Mending", description: "Buttons, seams, zips, and small garment repairs with ticketed status", priceType: "from" },
      { name: "Formalwear Alterations", description: "Fittings and alterations managed against the event date", priceType: "quote" },
      { name: "Fit Consultation", description: "In-store consultation before workroom routing and ready promise", priceType: "quote" },
    ],
    sectionTemplates: FABRIC_CARE_SECTIONS,
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "preferredLocation", label: "Preferred fitting location", type: "text" as const, required: false },
      { name: "serviceMode", label: "Alteration type", type: "select" as const, required: true, options: ["Hem or shorten", "Repair", "Formalwear", "Fit consultation", "Other alteration"] },
      { name: "neededBy", label: "Needed by", type: "text" as const, required: false, placeholder: "Event or pickup date" },
      { name: "garmentNotes", label: "Garment notes", type: "textarea" as const, required: false, placeholder: "Garment type, fit concern, fabric, or claim ticket number" },
    ],
    activationProfile: FABRIC_CARE_ACTIVATION,
  },
];
