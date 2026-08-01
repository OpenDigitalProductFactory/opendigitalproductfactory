import type { ArchetypeDefinition } from "../types";

const CONTACT_FIELDS = [
  { name: "name", label: "Name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
];

const AGRICULTURE_ACTIVATION: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: ["service-operations", "projects", "lifecycle-signals", "billing-readiness", "integrations"],
  billingReadinessMode: "prepared-not-prescribed",
  customerGraph: "separate-customer-projection",
  estateSeparation: "strict",
  axes: {
    form: "goods",
    delivery: "physical",
    primaryConsumer: "business",
    consumptionChannel: "multi-channel",
    commercialModel: "hybrid",
    provisioning: "account-with-billing",
    platform: "no",
  },
  portfolios: {
    foundational: { scope: "standard" },
    manufactureAndDeliver: {
      scope: "primary",
      it4itStages: ["strategy-to-portfolio", "request-to-fulfill", "detect-to-correct"],
    },
    forEmployees: { scope: "primary" },
    productsAndServicesSold: { scope: "primary" },
  },
};

const SECTIONS: ArchetypeDefinition["sectionTemplates"] = [
  { type: "hero", title: "Farm & Ranch", sortOrder: 0 },
  { type: "items", title: "Products & Services", sortOrder: 1 },
  { type: "about", title: "Our Land & Practices", sortOrder: 2 },
  { type: "gallery", title: "Land, Livestock & Harvest", sortOrder: 3 },
  { type: "contact", title: "Contact the Farm", sortOrder: 4 },
];

const VOCABULARY: ArchetypeDefinition["vocabulary"] = {
  stakeholderLabel: "Customers",
  teamLabel: "Farm & Ranch Team",
  agentName: "Farm & Ranch Steward",
  inboxLabel: "Farm & Ranch Requests",
};

export const agricultureRanchingArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "mixed-farm-ranch",
    name: "Mixed Farm & Ranch",
    category: "agriculture-ranching",
    ctaType: "inquiry",
    tags: ["farm", "ranch", "cattle", "hay", "pasture", "equipment", "working horses"],
    itemTemplates: [
      { name: "Cattle & Livestock Sales", description: "Available cattle and other livestock with health, breeding, and handling information", priceType: "quote" },
      { name: "Hay & Forage", description: "Baled hay and forage offered by cutting, grade, quantity, and pickup window", priceType: "quote" },
      { name: "Grazing or Land Services", description: "Seasonal grazing, pasture, custom hay, or land-management arrangements", priceType: "quote" },
      { name: "Farm Products", description: "Seasonal crops and farm products with current availability", priceType: "from" },
    ],
    sectionTemplates: SECTIONS,
    formSchema: [...CONTACT_FIELDS, { name: "requestType", label: "What are you interested in?", type: "select", required: true, options: ["Cattle or livestock", "Hay or forage", "Grazing or land service", "Farm product", "Other"] }, { name: "details", label: "Quantity, timing, and details", type: "textarea", required: true }],
    activationProfile: AGRICULTURE_ACTIVATION,
    vocabulary: VOCABULARY,
  },
  {
    archetypeId: "crop-hay-farm",
    name: "Crop & Hay Farm",
    category: "agriculture-ranching",
    ctaType: "inquiry",
    tags: ["crop", "hay", "forage", "fertility", "harvest", "custom cutting", "equipment"],
    itemTemplates: [
      { name: "Hay by Cutting", description: "Hay offered by crop, cutting, bale type, analysis, quantity, and availability", priceType: "quote" },
      { name: "Field Crops", description: "Seasonal grain, forage, and specialty crops available under current terms", priceType: "quote" },
      { name: "Custom Field Work", description: "Custom planting, spraying, cutting, baling, or hauling subject to schedule and conditions", priceType: "quote" },
    ],
    sectionTemplates: SECTIONS,
    formSchema: [...CONTACT_FIELDS, { name: "requestType", label: "Product or service", type: "select", required: true, options: ["Hay or forage", "Field crop", "Custom field work", "Other"] }, { name: "details", label: "Quantity, quality, field, and timing details", type: "textarea", required: true }],
    activationProfile: AGRICULTURE_ACTIVATION,
    vocabulary: VOCABULARY,
  },
  {
    archetypeId: "cattle-ranch",
    name: "Cattle Ranch",
    category: "agriculture-ranching",
    ctaType: "inquiry",
    tags: ["cattle", "herd", "breeding", "calving", "grazing", "health", "market"],
    itemTemplates: [
      { name: "Breeding Stock", description: "Bulls, cows, and heifers offered with lineage, health, breeding, and handling records", priceType: "quote" },
      { name: "Feeder or Market Cattle", description: "Groups of cattle offered by class, weight range, condition, and sale window", priceType: "quote" },
      { name: "Grazing & Cattle Services", description: "Seasonal grazing, backgrounding, handling, or ranch services by arrangement", priceType: "quote" },
      { name: "Hay & Supplemental Feed", description: "Ranch hay or forage offered by type, lot, and availability", priceType: "quote" },
    ],
    sectionTemplates: SECTIONS,
    formSchema: [...CONTACT_FIELDS, { name: "requestType", label: "What are you interested in?", type: "select", required: true, options: ["Breeding stock", "Feeder or market cattle", "Grazing or cattle service", "Hay or feed", "Other"] }, { name: "details", label: "Head count, class, timing, and handling details", type: "textarea", required: true }],
    activationProfile: AGRICULTURE_ACTIVATION,
    vocabulary: VOCABULARY,
  },
];
