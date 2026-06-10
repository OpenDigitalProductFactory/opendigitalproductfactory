import type { ArchetypeDefinition } from "../types";

const RESIDENT_CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
  { name: "address", label: "Street address", type: "text" as const, required: true },
];

export const publicSectorArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "small-town-municipality",
    name: "Small Town / Municipality",
    category: "public-sector",
    ctaType: "inquiry",
    tags: ["town", "city", "municipality", "village", "township", "local-government", "public-sector", "civic"],
    itemTemplates: [
      { name: "Report an Issue (311)", description: "Report a pothole, streetlight outage, drainage problem, or other non-emergency issue", priceType: "free", ctaType: "inquiry" },
      { name: "Building Permit Application", description: "Apply for a residential or commercial building permit", priceType: "fixed", ctaType: "inquiry" },
      { name: "Business License", description: "Apply for or renew a business license to operate in town", priceType: "fixed", ctaType: "inquiry" },
      { name: "Public Records Request", description: "Request copies of public records, meeting minutes, or town documents", priceType: "free", ctaType: "inquiry" },
      { name: "Park Pavilion Reservation", description: "Reserve a pavilion, ball field, or community room for an event", priceType: "fixed", ctaType: "booking" },
      { name: "Special Event Permit", description: "Apply to hold a parade, street fair, or public gathering", priceType: "fixed", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "About Our Town", sortOrder: 1 },
      { type: "items", title: "Departments & Services", sortOrder: 2 },
      { type: "team", title: "Council & Staff", sortOrder: 3 },
      { type: "contact", title: "Town Hall", sortOrder: 4 },
    ],
    formSchema: [
      ...RESIDENT_CONTACT_FIELDS,
      { name: "department", label: "Department", type: "select" as const, required: true, options: ["Clerk's Office", "Public Works", "Parks & Recreation", "Planning & Zoning", "Code Enforcement", "Finance / Utility Billing", "Other"] },
      { name: "notes", label: "How can we help?", type: "textarea" as const, required: true },
    ],
    activationProfile: {
      profileType: "standard",
      modules: ["service-operations", "projects"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "resident",
        consumptionChannel: "onsite-plus-portal",
        commercialModel: "statutory-fees-and-levies",
        provisioning: "account-with-billing",
        platform: "no",
        governance: "public-body",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "standard", it4itStages: ["request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "Permits & Licenses",
        "Public Works",
        "Parks & Recreation",
        "Clerk's Office",
        "Code Enforcement",
      ],
    },
  },
];
