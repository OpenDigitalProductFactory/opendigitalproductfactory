import type { ArchetypeDefinition } from "../types";

// Physical security services. Guard/patrol is genuinely dispatch-native — post
// assignments, patrol routes, and incident response are a real-time variant of
// the dispatch loop — while alarm/CCTV is field-service installation. Both set
// form=services + delivery=physical + consumptionChannel=onsite-plus-portal so
// the forthcoming Field Dispatch capability derives officer/technician routing.
// Guard licensing (PSO) and low-voltage licensing are capability-layer
// compliance overlays (Field Dispatch design ADR-5), not modelled here.

const CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: true },
];

const BUSINESS_FIELDS = [
  { name: "companyName", label: "Company / organization", type: "text" as const, required: false },
  { name: "siteAddress", label: "Site address", type: "text" as const, required: false },
];

export const securityServicesArchetypes: ArchetypeDefinition[] = [
  {
    // Officer-on-a-post / patrol-route dispatch with incident response — the
    // real-time variant of the field-dispatch loop. B2B contracts (recurring
    // agreements) over managed client sites.
    archetypeId: "guard-patrol",
    name: "Security Guard & Patrol Services",
    category: "security-services",
    ctaType: "inquiry",
    tags: ["security guard", "patrol", "manned guarding", "event security", "alarm response", "security"],
    itemTemplates: [
      { name: "Manned Guarding", description: "Static security officers posted at your site", priceType: "from" },
      { name: "Mobile Patrol", description: "Scheduled and random patrols across one or more sites", priceType: "from" },
      { name: "Event Security", description: "Crowd management and access control for events", priceType: "quote" },
      { name: "Alarm Response & Keyholding", description: "Rapid response to alarm activations on your behalf", priceType: "from" },
      { name: "Concierge / Front-of-House", description: "Reception and access control with a security mandate", priceType: "from" },
      { name: "Loss Prevention", description: "Retail and warehouse loss-prevention officers", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Client Reviews", sortOrder: 3 },
      { type: "contact", title: "Request a Proposal", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      ...BUSINESS_FIELDS,
      { name: "serviceType", label: "Service needed", type: "select" as const, required: true, options: ["Manned guarding", "Mobile patrol", "Event security", "Alarm response", "Concierge", "Loss prevention", "Not sure"] },
      { name: "coverage", label: "Coverage required", type: "select" as const, required: false, options: ["Daytime", "Overnight", "24/7", "One-off / event", "Not sure"] },
    ],
    activationProfile: {
      profileType: "standard",
      modules: ["customer-estate", "service-operations", "service-agreements", "billing-readiness", "lifecycle-signals"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "business",
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
    },
  },
  {
    // Field-service installation + recurring monitoring. The install is the
    // dispatch (technician to the property-site); monitoring is the recurring
    // revenue that anchors the recurring-agreement commercial model.
    archetypeId: "alarm-cctv-install",
    name: "Alarm & CCTV Installation",
    category: "security-services",
    ctaType: "inquiry",
    tags: ["alarm", "cctv", "security cameras", "access control", "monitoring", "low voltage", "security"],
    itemTemplates: [
      { name: "Alarm System Installation", description: "Intruder alarm design and installation", priceType: "from" },
      { name: "CCTV Installation", description: "Camera system design, install, and setup", priceType: "from" },
      { name: "Access Control", description: "Keypad, fob, and smart-lock access systems", priceType: "quote" },
      { name: "Monitoring Plan", description: "24/7 professional alarm monitoring on a monthly plan", priceType: "from" },
      { name: "Smart-Home Security", description: "Integrated cameras, sensors, and app control", priceType: "from" },
      { name: "Service & Upgrade", description: "Maintenance, fault-fix, and system upgrades", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 3 },
      { type: "contact", title: "Get a Quote", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "propertyType", label: "Property type", type: "select" as const, required: true, options: ["Residential", "Commercial", "Industrial"] },
      { name: "systemInterest", label: "What are you interested in?", type: "select" as const, required: false, options: ["Alarm", "CCTV", "Access control", "Monitoring", "Smart-home security", "Not sure"] },
      { name: "siteAddress", label: "Property address", type: "text" as const, required: false },
    ],
    activationProfile: {
      profileType: "standard",
      modules: ["service-operations", "service-agreements", "billing-readiness", "lifecycle-signals"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
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
        manufactureAndDeliver: { scope: "primary", it4itStages: ["requirement-to-deploy", "request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
    },
  },
];
