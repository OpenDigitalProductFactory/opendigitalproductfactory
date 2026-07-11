import type { ArchetypeDefinition, SchedulingDefaults } from "../types";

// Media & Production archetypes — the businesses that make the content:
// film / commercial / branded-video production companies, post-production &
// VFX studios, and event production / AV / staging houses. The defining value
// stream is project-based: brief → pre-production → shoot/build → post/strike →
// deliver, billed against milestones, coordinated through the `projects` module.
// Distinct from professional-services (advice/retainer) because the deliverable
// is a produced asset or a staged event, and from live-events-venues (which
// SELLS tickets to the show); these businesses PRODUCE the show for a client.
//
// Kernel decision (archetype-taxonomy-design, principle_decide → high
// confidence): split entertainment into two homogeneous categories rather than
// one heterogeneous one — production (project-based) here, ticketed live events
// in live-events-venues.ts — so category-default value streams stay accurate.

// Production and staging engagements open with a discovery/scoping call that the
// client books. Item-level booking items require schedulingDefaults (AUDIT-R3/R4)
// even though the archetype CTA is inquiry. Business-hours, customer-choice slot.
const PRODUCTION_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "customer-choice",
  defaultOperatingHours: [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "18:00" })),
  defaultBeforeBuffer: 0,
  defaultAfterBuffer: 15,
  minimumNoticeHours: 24,
  maxAdvanceDays: 60,
};

const CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
  { name: "company", label: "Company / brand", type: "text" as const, required: false },
];

export const mediaProductionArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "film-video-production",
    name: "Film & Video Production Company",
    category: "media-production",
    ctaType: "inquiry",
    tags: ["film", "video", "commercial", "production", "branded-content", "documentary", "crew", "project"],
    itemTemplates: [
      { name: "Commercial / Advertising Production", description: "TV, online, and social ad spots — concept to delivery", priceType: "quote", ctaType: "inquiry" },
      { name: "Brand & Corporate Video", description: "Brand films, explainers, and internal comms video", priceType: "quote", ctaType: "inquiry" },
      { name: "Music Video Production", description: "Full-service music video shoot and edit", priceType: "quote", ctaType: "inquiry" },
      { name: "Documentary / Short Film", description: "Long-form documentary or narrative short production", priceType: "quote", ctaType: "inquiry" },
      { name: "Full-Service Production Package", description: "Pre-production, crewed shoot, and post in one engagement", priceType: "from", ctaType: "inquiry" },
      { name: "Discovery Call", description: "Free 30-minute call to scope your project and budget", priceType: "free", ctaType: "booking", bookingDurationMinutes: 30 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "What We Produce", sortOrder: 1 },
      { type: "gallery", title: "Our Reel & Work", sortOrder: 2 },
      { type: "about", title: "About the Studio", sortOrder: 3 },
      { type: "team", title: "Our Crew", sortOrder: 4 },
      { type: "contact", title: "Start a Project", sortOrder: 5 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "projectType", label: "Project type", type: "select" as const, required: false, options: ["Commercial / Ad", "Brand / Corporate", "Music video", "Documentary / Short film", "Event coverage", "Other"] },
      { name: "budgetRange", label: "Budget range", type: "select" as const, required: false, options: ["Under £10k", "£10k–£50k", "£50k–£150k", "£150k+", "Not sure yet"] },
      { name: "timeline", label: "Target timeline", type: "text" as const, required: false, placeholder: "e.g. shoot in September" },
      { name: "brief", label: "Tell us about the project", type: "textarea" as const, required: false },
    ],
    schedulingDefaults: PRODUCTION_SCHEDULING,
    vocabulary: {
      itemsLabel: "What We Produce",
      portalLabel: "Client Portal",
      stakeholderLabel: "Clients",
      teamLabel: "Crew",
      inboxLabel: "Project Enquiries",
      agentName: "Production Coordinator",
    },
    activationProfile: {
      profileType: "standard",
      modules: ["projects", "billing-readiness", "service-operations", "lifecycle-signals"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "hybrid",
        primaryConsumer: "business",
        consumptionChannel: "sales-assisted",
        commercialModel: "transactional",
        provisioning: "none",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "primary", it4itStages: ["requirement-to-deploy", "request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "Pre-Production",
        "Production / Shoot",
        "Post-Production",
        "Delivery & Distribution",
      ],
    },
  },
  {
    archetypeId: "post-production-studio",
    name: "Post-Production & VFX Studio",
    category: "media-production",
    ctaType: "inquiry",
    tags: ["post-production", "editing", "vfx", "color-grading", "sound-design", "finishing", "project"],
    itemTemplates: [
      { name: "Video Editing", description: "Offline and online edit — story, pacing, and assembly", priceType: "quote", ctaType: "inquiry" },
      { name: "Color Grading", description: "Creative and technical color grade and finishing", priceType: "quote", ctaType: "inquiry" },
      { name: "VFX & Motion Graphics", description: "Visual effects, compositing, and animated graphics", priceType: "quote", ctaType: "inquiry" },
      { name: "Sound Design & Mix", description: "Dialogue edit, sound design, and final mix", priceType: "quote", ctaType: "inquiry" },
      { name: "Full Post Package", description: "Edit, grade, VFX, and mix under one delivery", priceType: "from", ctaType: "inquiry" },
      { name: "Discovery Call", description: "Free call to scope your post workflow and delivery specs", priceType: "free", ctaType: "booking", bookingDurationMinutes: 30 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Post Services", sortOrder: 1 },
      { type: "gallery", title: "Before & After", sortOrder: 2 },
      { type: "about", title: "About the Studio", sortOrder: 3 },
      { type: "contact", title: "Send Us Your Project", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "service", label: "Service needed", type: "select" as const, required: false, options: ["Editing", "Color grading", "VFX / motion graphics", "Sound design & mix", "Full post package", "Not sure"] },
      { name: "deliverySpec", label: "Delivery spec / format", type: "text" as const, required: false, placeholder: "e.g. 4K ProRes, 60s cutdown" },
      { name: "deadline", label: "Deadline", type: "text" as const, required: false },
      { name: "brief", label: "Project details", type: "textarea" as const, required: false },
    ],
    schedulingDefaults: PRODUCTION_SCHEDULING,
    vocabulary: {
      itemsLabel: "Post Services",
      portalLabel: "Client Portal",
      stakeholderLabel: "Clients",
      teamLabel: "Artists",
      inboxLabel: "Project Enquiries",
      agentName: "Post Producer",
    },
    activationProfile: {
      profileType: "standard",
      modules: ["projects", "billing-readiness", "service-operations"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "digital",
        primaryConsumer: "business",
        consumptionChannel: "sales-assisted",
        commercialModel: "transactional",
        provisioning: "none",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "primary", it4itStages: ["requirement-to-deploy", "request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "Editorial",
        "Color",
        "VFX & Graphics",
        "Audio",
        "Finishing & Delivery",
      ],
    },
  },
  {
    archetypeId: "event-production-staging",
    name: "Event Production, AV & Staging",
    category: "media-production",
    ctaType: "inquiry",
    tags: ["event-production", "staging", "av", "lighting", "sound", "led-screen", "conference", "concert", "project"],
    itemTemplates: [
      { name: "Stage & Set Build", description: "Custom stage, set, and scenic build for your event", priceType: "quote", ctaType: "inquiry" },
      { name: "Lighting Design & Rig", description: "Concert and event lighting design, rig, and operation", priceType: "quote", ctaType: "inquiry" },
      { name: "Sound & PA System", description: "PA, monitors, and audio engineering for live events", priceType: "quote", ctaType: "inquiry" },
      { name: "LED Screens & Video", description: "LED walls, projection, and live video / IMAG", priceType: "quote", ctaType: "inquiry" },
      { name: "Full Event Production", description: "End-to-end production management: staging, AV, and crew", priceType: "from", ctaType: "inquiry" },
      { name: "Site Visit & Consultation", description: "Free site visit to scope the technical plan", priceType: "free", ctaType: "booking", bookingDurationMinutes: 60 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Production Services", sortOrder: 1 },
      { type: "gallery", title: "Events We've Built", sortOrder: 2 },
      { type: "about", title: "About Us", sortOrder: 3 },
      { type: "team", title: "Our Crew", sortOrder: 4 },
      { type: "contact", title: "Plan Your Event", sortOrder: 5 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "eventType", label: "Event type", type: "select" as const, required: false, options: ["Conference / corporate", "Concert / live music", "Festival", "Awards / gala", "Product launch", "Private event", "Other"] },
      { name: "servicesNeeded", label: "Services needed", type: "select" as const, required: false, options: ["Staging & set", "Lighting", "Sound / PA", "LED / video", "Full production", "Not sure"] },
      { name: "eventDate", label: "Event date", type: "text" as const, required: false, placeholder: "DD/MM/YYYY" },
      { name: "venue", label: "Venue / location", type: "text" as const, required: false },
      { name: "brief", label: "Tell us about the event", type: "textarea" as const, required: false },
    ],
    schedulingDefaults: PRODUCTION_SCHEDULING,
    vocabulary: {
      itemsLabel: "Production Services",
      portalLabel: "Client Portal",
      stakeholderLabel: "Clients",
      teamLabel: "Crew",
      inboxLabel: "Event Enquiries",
      agentName: "Production Manager",
    },
    activationProfile: {
      profileType: "standard",
      modules: ["projects", "billing-readiness", "service-operations", "lifecycle-signals"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "business",
        consumptionChannel: "sales-assisted",
        commercialModel: "transactional",
        provisioning: "none",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "primary", it4itStages: ["requirement-to-deploy", "request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "Staging & Scenic",
        "Lighting",
        "Audio",
        "Video & LED",
        "Production Management",
      ],
    },
  },
];
