import type { ArchetypeDefinition } from "../types";

const CONTACT_FIELDS = [
  { name: "name", label: "Name", type: "text" as const, required: true },
  { name: "email", label: "Work email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
  { name: "companyName", label: "Company", type: "text" as const, required: true },
];

const MANUFACTURING_ACTIVATION: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: [
    "customer-estate",
    "projects",
    "lifecycle-signals",
    "billing-readiness",
    "integrations",
  ],
  billingReadinessMode: "prepared-not-prescribed",
  customerGraph: "separate-customer-projection",
  estateSeparation: "strict",
  axes: {
    form: "goods",
    delivery: "physical",
    primaryConsumer: "business",
    consumptionChannel: "sales-assisted",
    commercialModel: "transactional",
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
  { type: "hero", title: "Engineered Products", sortOrder: 0 },
  { type: "items", title: "Product Families & Capabilities", sortOrder: 1 },
  { type: "about", title: "Engineering & Manufacturing", sortOrder: 2 },
  { type: "gallery", title: "Products & Facilities", sortOrder: 3 },
  { type: "contact", title: "Request Engineering Review", sortOrder: 4 },
];

export const manufacturingArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "industrial-equipment-oem",
    name: "Industrial Equipment OEM",
    category: "manufacturing",
    ctaType: "inquiry",
    tags: [
      "manufacturer",
      "industrial oem",
      "engineered to order",
      "build to order",
      "production line",
      "quality",
      "serialized equipment",
    ],
    itemTemplates: [
      {
        name: "Configured Production Equipment",
        description:
          "Application-engineered equipment configured to the customer's duty, environment, interfaces, and acceptance criteria",
        priceType: "quote",
      },
      {
        name: "Standard Product Family",
        description:
          "Repeatable catalog configurations with controlled options, documented lead time, and serialized build records",
        priceType: "quote",
      },
      {
        name: "Prototype & NPI Build",
        description:
          "Design-for-manufacture review, prototype build, qualification, and controlled release into production",
        priceType: "quote",
      },
      {
        name: "Spares & Lifecycle Support",
        description:
          "Traceable replacement parts, repair, retrofit, and lifecycle support for installed equipment",
        priceType: "quote",
      },
    ],
    sectionTemplates: SECTIONS,
    formSchema: [
      ...CONTACT_FIELDS,
      {
        name: "requestType",
        label: "What do you need?",
        type: "select",
        required: true,
        options: [
          "Configured product",
          "Standard product",
          "Prototype / NPI",
          "Spares / support",
          "Other",
        ],
      },
      {
        name: "applicationRequirements",
        label: "Application, quantity, timing, and acceptance requirements",
        type: "textarea",
        required: true,
      },
    ],
    activationProfile: MANUFACTURING_ACTIVATION,
    vocabulary: {
      stakeholderLabel: "Customers",
      teamLabel: "Engineering & Operations",
      agentName: "Operations Coordinator",
      inboxLabel: "Commercial & Engineering Requests",
    },
  },
];
