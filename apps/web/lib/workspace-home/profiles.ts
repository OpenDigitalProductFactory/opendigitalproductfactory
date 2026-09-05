import type {
  WorkspaceHomeComponentDescriptor,
  WorkspaceHomeContribution,
  WorkspaceHomePrimitiveKey,
  WorkspaceHomeSlot,
} from "./types";

type CategoryProfileInput = {
  id: string;
  label: string;
  description: string;
  primaryOperatingQuestion: string;
  topConcerns: string[];
  archetypeCategories: string[];
  semanticArchetypeIds?: string[];
  primitives: WorkspaceHomePrimitiveKey[];
  components: Array<{
    key: WorkspaceHomeComponentDescriptor["key"];
    slotId: WorkspaceHomeSlot["id"];
    primitiveKey: WorkspaceHomePrimitiveKey;
    title: string;
    dataRefs: WorkspaceHomeComponentDescriptor["dataRefs"];
  }>;
  requiredCanonicalData?: string[];
  requiredSignals?: string[];
};

const BASELINE_SLOTS: WorkspaceHomeSlot[] = [
  { id: "today-now", label: "Today / now", zone: "critical-strip" },
  { id: "exceptions-needs-review", label: "Needs review", zone: "primary" },
  { id: "coworker-handoffs", label: "Coworker handoffs", zone: "briefing" },
];

const DEFAULT_CANONICAL_DATA = ["customer-account", "work-item"];
const DEFAULT_SIGNALS = ["urgent-exception", "coworker-handoff"];

function profile(input: CategoryProfileInput): WorkspaceHomeContribution {
  return {
    id: input.id,
    label: input.label,
    description: input.description,
    primaryOperatingQuestion: input.primaryOperatingQuestion,
    topConcerns: input.topConcerns,
    semanticArchetypeIds: input.semanticArchetypeIds ?? [],
    archetypeCategories: input.archetypeCategories,
    setupActivation: {
      status: "needs-data",
      primitiveWidgets: input.primitives,
      requiredCanonicalData: input.requiredCanonicalData ?? DEFAULT_CANONICAL_DATA,
      requiredSignals: input.requiredSignals ?? DEFAULT_SIGNALS,
      missingDataBehavior: "render-empty-state",
    },
    slots: BASELINE_SLOTS,
    components: input.components,
  };
}

const scheduledWork = { kind: "signal", key: "scheduled-work", required: true } as const;
const urgentException = { kind: "signal", key: "urgent-exception", required: true } as const;
const coworkerHandoff = { kind: "signal", key: "coworker-handoff", required: false } as const;
const failedCommunication = { kind: "signal", key: "communication-failed", required: false } as const;
const workItem = { kind: "canonical-data", key: "work-item", required: true } as const;
const customerAccount = { kind: "canonical-data", key: "customer-account", required: true } as const;
const calendarEvent = { kind: "canonical-data", key: "calendar-event", required: false } as const;
const workSchedule = { kind: "canonical-data", key: "work-schedule", required: false } as const;
const configurationItem = {
  kind: "canonical-data",
  key: "customer-configuration-item",
  required: false,
} as const;

export const DEFAULT_WORKSPACE_HOME_CONTRIBUTIONS: WorkspaceHomeContribution[] = [
  profile({
    id: "home-care-practice",
    label: "Care practice command home",
    description:
      "Patient arrival, care-team schedule, communication, and clinical handoff attention for small medical and dental practices.",
    primaryOperatingQuestion: "which patient, appointment, or care-team handoff needs attention now?",
    topConcerns: [
      "patients waiting or not yet checked in",
      "unconfirmed or changed appointments",
      "clinical handoffs awaiting acknowledgement",
      "patient communication failures",
      "rooms, practitioners, or hygienists not ready",
    ],
    semanticArchetypeIds: ["medical-practice", "dental-practice"],
    archetypeCategories: [],
    primitives: ["appointment-schedule", "case-board", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "today-schedule", slotId: "today-now", primitiveKey: "appointment-schedule", title: "Patient appointments and care-team schedule", dataRefs: [calendarEvent, scheduledWork] },
      { key: "patient-queue", slotId: "exceptions-needs-review", primitiveKey: "case-board", title: "Patients waiting or needing front-desk review", dataRefs: [customerAccount, workItem, urgentException] },
      { key: "notification-status", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Appointment and patient communication exceptions", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Clinical and front-desk handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-trades-maintenance",
    label: "Field service command home",
    description:
      "Dispatch, route, parts, customer callback, and crew handoff visibility for trades and maintenance companies.",
    primaryOperatingQuestion: "what has to be dispatched or rescued today?",
    topConcerns: [
      "unassigned or blocked jobs",
      "crew capacity and route timing",
      "parts or site readiness",
      "customer callbacks",
      "handoffs needing acknowledgement",
    ],
    archetypeCategories: ["trades-maintenance"],
    primitives: [
      "capacity-lanes",
      "decision-queue",
      "inventory-watch",
      "communication-exceptions",
      "handoff-queue",
    ],
    requiredCanonicalData: ["customer-account", "work-item", "work-schedule", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "technician-load", slotId: "today-now", primitiveKey: "capacity-lanes", title: "Crew capacity and route timing", dataRefs: [workSchedule, calendarEvent, scheduledWork] },
      { key: "unassigned-work", slotId: "exceptions-needs-review", primitiveKey: "decision-queue", title: "Jobs needing attention", dataRefs: [workItem, urgentException] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Customer callbacks and failed notices", dataRefs: [customerAccount, failedCommunication] },
      { key: "parts-watch", slotId: "exceptions-needs-review", primitiveKey: "inventory-watch", title: "Parts and site readiness", dataRefs: [workItem] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Coworker handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-professional-services",
    label: "Client work command home",
    description:
      "Case, client, decision, schedule, and revenue attention for advisory and professional service firms.",
    primaryOperatingQuestion: "which client commitments need a decision or follow-up today?",
    topConcerns: [
      "client work waiting on a decision",
      "upcoming meetings and deliverables",
      "handoffs across advisors",
      "client communication gaps",
      "revenue-impacting follow-up",
    ],
    archetypeCategories: ["professional-services"],
    primitives: [
      "case-board",
      "decision-queue",
      "appointment-schedule",
      "communication-exceptions",
      "handoff-queue",
    ],
    requiredCanonicalData: ["customer-account", "work-item", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "today-schedule", slotId: "today-now", primitiveKey: "appointment-schedule", title: "Client meetings and deliverables", dataRefs: [calendarEvent, scheduledWork] },
      { key: "unassigned-work", slotId: "exceptions-needs-review", primitiveKey: "case-board", title: "Client work needing review", dataRefs: [workItem, customerAccount] },
      { key: "notification-status", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Client communication exceptions", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Advisor handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-media-production",
    label: "Production pipeline home",
    description:
      "Project, deliverable, schedule, and client-approval attention for film, video, and event production teams.",
    primaryOperatingQuestion: "which production or deliverable needs a decision or handoff today?",
    topConcerns: [
      "projects waiting on a decision or approval",
      "upcoming shoots, sessions, and delivery deadlines",
      "crew and vendor handoffs",
      "client communication gaps",
      "revenue-impacting follow-up",
    ],
    archetypeCategories: ["media-production"],
    primitives: [
      "case-board",
      "decision-queue",
      "appointment-schedule",
      "communication-exceptions",
      "handoff-queue",
    ],
    requiredCanonicalData: ["customer-account", "work-item", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "today-schedule", slotId: "today-now", primitiveKey: "appointment-schedule", title: "Shoots, sessions, and deadlines", dataRefs: [calendarEvent, scheduledWork] },
      { key: "unassigned-work", slotId: "exceptions-needs-review", primitiveKey: "case-board", title: "Projects needing review or approval", dataRefs: [workItem, customerAccount] },
      { key: "notification-status", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Client communication exceptions", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Crew and vendor handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-live-events-venues",
    label: "Show-day command home",
    description:
      "Event schedule, sales momentum, guest communication, and team handoffs for venues, promoters, and booking agencies.",
    primaryOperatingQuestion: "what needs attention before the next show or on-sale?",
    topConcerns: [
      "upcoming events and on-sale moments",
      "ticket sales and capacity risk",
      "guest and booking communication exceptions",
      "staff and production coverage",
      "handoffs before show day",
    ],
    archetypeCategories: ["live-events-venues"],
    primitives: [
      "appointment-schedule",
      "decision-queue",
      "communication-exceptions",
      "handoff-queue",
    ],
    requiredCanonicalData: ["customer-account", "work-item", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "today-schedule", slotId: "today-now", primitiveKey: "appointment-schedule", title: "Events and on-sale moments", dataRefs: [calendarEvent, scheduledWork] },
      { key: "unassigned-work", slotId: "exceptions-needs-review", primitiveKey: "decision-queue", title: "Bookings and exceptions needing action", dataRefs: [workItem, urgentException] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Guest and booking follow-up", dataRefs: [customerAccount, failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Show-day handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-retail-goods",
    label: "Retail operations home",
    description:
      "Revenue, replenishment, inventory, customer activity, and coworker follow-up for retail and ecommerce operations.",
    primaryOperatingQuestion: "what is at risk of missing demand today?",
    topConcerns: [
      "stockout or replenishment risk",
      "customer orders and inquiries",
      "sales momentum",
      "supplier or fulfillment exceptions",
      "handoffs across store and back office",
    ],
    archetypeCategories: ["retail-goods"],
    primitives: ["inventory-watch", "decision-queue", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item"],
    requiredSignals: ["urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "retail-replenishment", slotId: "today-now", primitiveKey: "inventory-watch", title: "Inventory and replenishment watch", dataRefs: [workItem] },
      { key: "unassigned-work", slotId: "exceptions-needs-review", primitiveKey: "decision-queue", title: "Orders and exceptions needing action", dataRefs: [workItem, urgentException] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Customer follow-up", dataRefs: [customerAccount, failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Store and back-office handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    // Custody operations are not mobile field ops (the work happens at the
    // operator's own facility) and not retail (the stock belongs to clients),
    // so warehousing gets its own home rather than joining either.
    id: "home-warehousing-fulfilment",
    label: "Warehouse operations home",
    description:
      "Inbound bookings, stock accuracy, outbound waves, and client exceptions for warehousing and fulfilment operations.",
    primaryOperatingQuestion: "what is at risk of missing cut-off or going out wrong today?",
    topConcerns: [
      "inbound waiting to be booked in",
      "orders at risk of missing carrier cut-off",
      "stock accuracy and count variances",
      "space and dock capacity",
      "client exceptions and handoffs",
    ],
    archetypeCategories: ["warehousing-fulfilment"],
    primitives: ["inventory-watch", "capacity-lanes", "decision-queue", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item", "work-schedule"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "stock-accuracy", slotId: "today-now", primitiveKey: "inventory-watch", title: "Stock accuracy and count variances", dataRefs: [workItem] },
      { key: "dock-capacity", slotId: "today-now", primitiveKey: "capacity-lanes", title: "Dock, space, and wave capacity", dataRefs: [workSchedule, scheduledWork] },
      { key: "unassigned-work", slotId: "exceptions-needs-review", primitiveKey: "decision-queue", title: "Receipts and orders needing action", dataRefs: [workItem, urgentException] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Client follow-up", dataRefs: [customerAccount, failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Warehouse and office handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    // Manufacturing is modeled around released work and constrained production
    // flow. It intentionally does not imply write authority over PLCs, robots,
    // safety systems, or machine controllers.
    id: "home-manufacturing",
    label: "Manufacturing operations home",
    description:
      "Released work, line and cell capacity, material and equipment readiness, quality holds, and production handoffs in one operating view.",
    primaryOperatingQuestion:
      "which released work is at risk of missing its quality or delivery commitment today?",
    topConcerns: [
      "released work waiting on a line, cell, station, or operator",
      "material, tooling, or equipment readiness constraints",
      "work in progress aging or missing its next operation",
      "quality holds, nonconformance, and inspection decisions",
      "engineering, production, supply, and service handoffs",
    ],
    archetypeCategories: ["manufacturing"],
    primitives: ["capacity-lanes", "inventory-watch", "decision-queue", "handoff-queue"],
    requiredCanonicalData: ["work-item", "work-schedule"],
    requiredSignals: ["scheduled-work", "urgent-exception", "coworker-handoff"],
    components: [
      {
        key: "technician-load",
        slotId: "today-now",
        primitiveKey: "capacity-lanes",
        title: "Line, cell, station, and operator capacity",
        dataRefs: [workSchedule, scheduledWork],
      },
      {
        key: "parts-watch",
        slotId: "today-now",
        primitiveKey: "inventory-watch",
        title: "Material, tooling, and equipment readiness",
        dataRefs: [workItem],
      },
      {
        key: "unassigned-work",
        slotId: "exceptions-needs-review",
        primitiveKey: "decision-queue",
        title: "Released work, WIP, and quality constraints",
        dataRefs: [workItem, urgentException],
      },
      {
        key: "coworker-handoffs",
        slotId: "coworker-handoffs",
        primitiveKey: "handoff-queue",
        title: "Engineering, production, supply, quality, and service handoffs",
        dataRefs: [coworkerHandoff],
      },
    ],
  }),
  profile({
    id: "home-fabric-care-services",
    label: "Fabric care operations home",
    description:
      "Claim tickets, plant capacity, ready promises, pickup routes, and customer exceptions for dry-cleaning and laundry operations.",
    primaryOperatingQuestion: "which garment order is at risk of missing its ready promise today?",
    topConcerns: [
      "orders due or promised today",
      "claim tickets with missing or exception items",
      "plant and workroom capacity",
      "pickup and delivery route timing",
      "customer ready-notice or delay communication failures",
    ],
    archetypeCategories: ["fabric-care-services"],
    primitives: ["capacity-lanes", "decision-queue", "inventory-watch", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item", "work-schedule"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "plant-capacity", slotId: "today-now", primitiveKey: "capacity-lanes", title: "Plant, counter, and workroom capacity", dataRefs: [workSchedule, scheduledWork] },
      { key: "ticket-exceptions", slotId: "exceptions-needs-review", primitiveKey: "decision-queue", title: "Claim tickets and garment exceptions", dataRefs: [workItem, urgentException] },
      { key: "garment-tracking", slotId: "exceptions-needs-review", primitiveKey: "inventory-watch", title: "Orders at risk of missing ready promise", dataRefs: [workItem] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Ready notices and delay follow-up", dataRefs: [customerAccount, failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Counter, plant, and route handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-agriculture-ranching",
    label: "Farm & ranch operations home",
    description:
      "Seasonal work windows, herd and working-animal care, field and pasture readiness, equipment, materials, outside services, and owner decisions in one operating view.",
    primaryOperatingQuestion: "what has to be ready before the next biological or weather window closes?",
    topConcerns: [
      "animal health, breeding, farrier, and handling actions due",
      "field, pasture, crop, hay, and grazing windows",
      "tractors, implements, parts, fuel, and maintenance readiness",
      "feed, seed, fertilizer, regulated inputs, and inventory risk",
      "outside-service bookings, market decisions, and regulatory deadlines",
    ],
    archetypeCategories: ["agriculture-ranching"],
    primitives: ["appointment-schedule", "capacity-lanes", "inventory-watch", "decision-queue", "handoff-queue"],
    requiredCanonicalData: ["work-item", "work-schedule", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "coworker-handoff"],
    components: [
      { key: "today-schedule", slotId: "today-now", primitiveKey: "appointment-schedule", title: "Seasonal work, animal care, and outside-service windows", dataRefs: [calendarEvent, scheduledWork] },
      { key: "technician-load", slotId: "today-now", primitiveKey: "capacity-lanes", title: "People, equipment, field, and pasture capacity", dataRefs: [workSchedule, scheduledWork] },
      { key: "parts-watch", slotId: "exceptions-needs-review", primitiveKey: "inventory-watch", title: "Feed, seed, inputs, parts, fuel, and implement readiness", dataRefs: [workItem] },
      { key: "unassigned-work", slotId: "exceptions-needs-review", primitiveKey: "decision-queue", title: "Herd, land, market, weather, and compliance decisions", dataRefs: [workItem, urgentException] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Owner, veterinarian, farrier, dealer, applicator, and service handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-food-hospitality",
    label: "Service period home",
    description:
      "Service period readiness for restaurants, bakeries, catering, and hospitality teams.",
    primaryOperatingQuestion: "are we ready for the next service period?",
    topConcerns: [
      "reservations or orders due now",
      "ingredient and prep readiness",
      "guest communication exceptions",
      "staff coverage",
      "handoffs before service",
    ],
    archetypeCategories: ["food-hospitality"],
    primitives: [
      "service-period-board",
      "inventory-watch",
      "appointment-schedule",
      "communication-exceptions",
      "handoff-queue",
    ],
    requiredCanonicalData: ["customer-account", "work-item", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "shift-summary", slotId: "today-now", primitiveKey: "service-period-board", title: "Service period readiness", dataRefs: [workItem, scheduledWork] },
      { key: "today-schedule", slotId: "today-now", primitiveKey: "appointment-schedule", title: "Bookings and orders due", dataRefs: [calendarEvent] },
      { key: "inventory-alerts", slotId: "exceptions-needs-review", primitiveKey: "inventory-watch", title: "Prep and ingredient watch", dataRefs: [workItem] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Guest communication exceptions", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Service handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-healthcare-wellness",
    label: "Care flow home",
    description:
      "Appointment, patient/client queue, communication, and handoff visibility for healthcare and wellness practices.",
    primaryOperatingQuestion: "which patient or client needs attention before the day slips?",
    topConcerns: [
      "appointments due today",
      "patients or clients waiting",
      "care handoffs",
      "communication failures",
      "equipment or service readiness",
    ],
    archetypeCategories: ["healthcare-wellness"],
    primitives: ["appointment-schedule", "case-board", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "today-schedule", slotId: "today-now", primitiveKey: "appointment-schedule", title: "Appointments and visits", dataRefs: [calendarEvent, scheduledWork] },
      { key: "patient-queue", slotId: "exceptions-needs-review", primitiveKey: "case-board", title: "Patients or clients needing review", dataRefs: [customerAccount, workItem] },
      { key: "notification-status", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Care communication exceptions", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Care handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-appointment-services",
    label: "Appointment service home",
    description:
      "Schedule, client readiness, supplies, and team handoffs for beauty, fitness, pet, and training appointment businesses.",
    primaryOperatingQuestion: "which bookings, clients, or supplies need attention today?",
    topConcerns: [
      "today's booked services",
      "late or unconfirmed clients",
      "staff capacity",
      "supplies or room readiness",
      "handoffs before appointments",
    ],
    archetypeCategories: ["beauty-personal-care", "fitness-recreation", "pet-services", "education-training"],
    primitives: [
      "appointment-schedule",
      "capacity-lanes",
      "inventory-watch",
      "communication-exceptions",
      "handoff-queue",
    ],
    requiredCanonicalData: ["customer-account", "work-item", "calendar-event", "work-schedule"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "today-schedule", slotId: "today-now", primitiveKey: "appointment-schedule", title: "Bookings and sessions", dataRefs: [calendarEvent, scheduledWork] },
      { key: "technician-load", slotId: "today-now", primitiveKey: "capacity-lanes", title: "Team capacity", dataRefs: [workSchedule] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Client follow-up", dataRefs: [customerAccount, failedCommunication] },
      { key: "inventory-alerts", slotId: "exceptions-needs-review", primitiveKey: "inventory-watch", title: "Supplies and room readiness", dataRefs: [workItem] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Team handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-msp-it-services",
    label: "Managed service health home",
    description:
      "Customer estate health, incidents, integration posture, and oversight decisions for MSP-style operating models.",
    primaryOperatingQuestion: "what is red on the customer estate?",
    topConcerns: [
      "customer systems in degraded health",
      "incidents waiting for triage",
      "security or integration alerts",
      "human approvals required",
      "customer communication follow-up",
    ],
    semanticArchetypeIds: ["it-managed-services", "managed-service-provider", "msp"],
    archetypeCategories: [],
    primitives: ["health-board", "decision-queue", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "customer-configuration-item", "work-item"],
    requiredSignals: ["urgent-exception", "governor-require-hitl", "communication-failed", "coworker-handoff"],
    components: [
      { key: "notification-status", slotId: "today-now", primitiveKey: "health-board", title: "Customer estate health", dataRefs: [customerAccount, configurationItem] },
      { key: "unassigned-work", slotId: "exceptions-needs-review", primitiveKey: "decision-queue", title: "Incidents and approvals needing action", dataRefs: [workItem, urgentException] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Customer communication exceptions", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Escalation handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-fractional-cxo",
    label: "Fractional executive home",
    description:
      "Portfolio-client decisions, meeting prep, executive follow-through, and delegated handoffs for fractional CXO businesses.",
    primaryOperatingQuestion: "which client leadership decision needs me next?",
    topConcerns: [
      "client decisions awaiting executive input",
      "board or leadership meetings due",
      "follow-through on delegated work",
      "client-risk signals",
      "handoffs across advisors and coworkers",
    ],
    semanticArchetypeIds: ["fractional-cxo", "fractional-cio", "fractional-cto", "fractional-cfo", "fractional-coo"],
    archetypeCategories: [],
    primitives: ["decision-queue", "case-board", "appointment-schedule", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "coworker-handoff"],
    components: [
      { key: "unassigned-work", slotId: "today-now", primitiveKey: "decision-queue", title: "Executive decisions needing input", dataRefs: [workItem, urgentException] },
      { key: "today-schedule", slotId: "today-now", primitiveKey: "appointment-schedule", title: "Leadership meetings and prep", dataRefs: [calendarEvent, scheduledWork] },
      { key: "patient-queue", slotId: "exceptions-needs-review", primitiveKey: "case-board", title: "Client portfolio risks", dataRefs: [customerAccount, workItem] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Delegated follow-through", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-software-platform",
    label: "Software operator home",
    description:
      "Service health, customer-impacting incidents, release decisions, integration status, and coworker handoffs.",
    primaryOperatingQuestion: "what customer-impacting platform issue needs action?",
    topConcerns: [
      "service or integration health",
      "customer-impacting incidents",
      "release or rollback decisions",
      "support communication gaps",
      "handoffs across product and engineering",
    ],
    archetypeCategories: ["software-platform"],
    primitives: ["health-board", "decision-queue", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "customer-configuration-item", "work-item"],
    requiredSignals: ["urgent-exception", "governor-require-hitl", "communication-failed", "coworker-handoff"],
    components: [
      { key: "notification-status", slotId: "today-now", primitiveKey: "health-board", title: "Service and integration health", dataRefs: [configurationItem, urgentException] },
      { key: "unassigned-work", slotId: "exceptions-needs-review", primitiveKey: "decision-queue", title: "Incidents and release decisions", dataRefs: [workItem] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Customer-impacting communication gaps", dataRefs: [customerAccount, failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Product and engineering handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-pet-rescue",
    label: "Rescue operations home",
    description:
      "Animal intake, safe capacity, daily care, placement, and donor stewardship for pet rescue teams.",
    primaryOperatingQuestion: "which animal or care commitment needs attention now?",
    topConcerns: [
      "animals waiting for intake or safe housing",
      "medication, veterinary, and welfare exceptions",
      "legal holds and placement readiness",
      "adoption applications and returns",
      "restricted donations and animal costs",
    ],
    semanticArchetypeIds: ["pet-rescue"],
    archetypeCategories: [],
    primitives: ["case-board", "capacity-lanes", "appointment-schedule", "handoff-queue"],
    requiredCanonicalData: ["animal-profile", "work-item", "calendar-event", "resource"],
    requiredSignals: ["animal-attention", "scheduled-work", "urgent-exception", "coworker-handoff"],
    components: [
      { key: "patient-queue", slotId: "today-now", primitiveKey: "case-board", title: "Animals needing attention", dataRefs: [{ kind: "projection", key: "rescue.animals", required: true }, urgentException] },
      { key: "technician-load", slotId: "today-now", primitiveKey: "capacity-lanes", title: "Housing and foster capacity", dataRefs: [{ kind: "projection", key: "rescue.capacity", required: true }] },
      { key: "today-schedule", slotId: "exceptions-needs-review", primitiveKey: "appointment-schedule", title: "Care rounds and appointments", dataRefs: [calendarEvent, scheduledWork] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Rescue team handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-nonprofit-community",
    label: "Mission operations home",
    description:
      "Programs, volunteers, donors or members, service commitments, and team handoffs for nonprofit/community organizations.",
    primaryOperatingQuestion: "which mission commitment needs attention today?",
    topConcerns: [
      "program delivery due today",
      "volunteer or member coordination",
      "donor/supporter follow-up",
      "case or service exceptions",
      "team handoffs",
    ],
    archetypeCategories: ["nonprofit-community"],
    primitives: ["volunteer-program-board", "case-board", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "shift-summary", slotId: "today-now", primitiveKey: "volunteer-program-board", title: "Programs and volunteer coverage", dataRefs: [calendarEvent, scheduledWork] },
      { key: "patient-queue", slotId: "exceptions-needs-review", primitiveKey: "case-board", title: "Service commitments needing review", dataRefs: [workItem, customerAccount] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Supporter and member follow-up", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Mission handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-property-governance",
    label: "Property governance home",
    description:
      "Resident/unit requests, inspections, contractor follow-up, communications, and board or management handoffs.",
    primaryOperatingQuestion: "which property, resident, or board issue needs action?",
    topConcerns: [
      "resident or owner requests",
      "maintenance and inspection status",
      "contractor follow-up",
      "board decisions",
      "communication exceptions",
    ],
    archetypeCategories: ["hoa-property-management", "real-estate-construction", "asset-rental"],
    primitives: ["case-board", "capacity-lanes", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "unassigned-work", slotId: "today-now", primitiveKey: "case-board", title: "Property cases needing attention", dataRefs: [workItem, customerAccount] },
      { key: "today-schedule", slotId: "today-now", primitiveKey: "capacity-lanes", title: "Inspections, bookings, and site work", dataRefs: [calendarEvent, scheduledWork] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Resident and customer communication gaps", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Board, manager, and contractor handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-civic-public-sector",
    label: "Civic service home",
    description:
      "Service requests, permits, incidents, resident communications, and staff handoffs for public-sector operations.",
    primaryOperatingQuestion: "which resident service or civic obligation needs action?",
    topConcerns: [
      "resident service requests",
      "permits or inspections due",
      "incident and compliance exceptions",
      "public communications",
      "staff handoffs",
    ],
    archetypeCategories: ["public-sector"],
    primitives: ["case-board", "decision-queue", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "unassigned-work", slotId: "today-now", primitiveKey: "case-board", title: "Resident services needing action", dataRefs: [workItem, customerAccount] },
      { key: "today-schedule", slotId: "today-now", primitiveKey: "decision-queue", title: "Permits, inspections, and civic deadlines", dataRefs: [calendarEvent, scheduledWork] },
      { key: "notification-status", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Public communication exceptions", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Staff handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-banking-financial-services",
    label: "Financial services home",
    description:
      "Applications, customer/member follow-up, compliance-sensitive decisions, and relationship handoffs.",
    primaryOperatingQuestion: "which customer or member decision needs compliant follow-up?",
    topConcerns: [
      "applications waiting on review",
      "customer/member follow-up",
      "compliance-sensitive decisions",
      "relationship handoffs",
      "service communication exceptions",
    ],
    archetypeCategories: ["banking-financial-services"],
    primitives: ["decision-queue", "case-board", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item"],
    requiredSignals: ["urgent-exception", "governor-require-hitl", "communication-failed", "coworker-handoff"],
    components: [
      { key: "unassigned-work", slotId: "today-now", primitiveKey: "decision-queue", title: "Applications and decisions needing review", dataRefs: [workItem, urgentException] },
      { key: "patient-queue", slotId: "exceptions-needs-review", primitiveKey: "case-board", title: "Customer/member cases", dataRefs: [customerAccount, workItem] },
      { key: "notification-status", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Required follow-up and notices", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Relationship handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-field-mobility",
    label: "Mobile field operations home",
    description:
      "Route, crew, vehicle, site, customer, and exception visibility for automotive, logistics, moving, and security teams.",
    primaryOperatingQuestion: "which route, vehicle, or field exception needs action now?",
    topConcerns: [
      "route and dispatch timing",
      "crew or vehicle capacity",
      "customer/site readiness",
      "urgent exceptions",
      "field handoffs",
    ],
    archetypeCategories: ["automotive-services", "moving-and-logistics", "security-services"],
    primitives: ["geo-map", "capacity-lanes", "decision-queue", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item", "work-schedule", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "customer-map", slotId: "today-now", primitiveKey: "geo-map", title: "Routes and field locations", dataRefs: [customerAccount, scheduledWork] },
      { key: "technician-load", slotId: "today-now", primitiveKey: "capacity-lanes", title: "Crew, vehicle, and route capacity", dataRefs: [workSchedule, calendarEvent] },
      { key: "unassigned-work", slotId: "exceptions-needs-review", primitiveKey: "decision-queue", title: "Field exceptions needing dispatch", dataRefs: [workItem, urgentException] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Customer/site communication exceptions", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Field handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
  profile({
    id: "home-waste-management",
    label: "Waste route operations home",
    description:
      "Route completion, truck/crew capacity, missed pickups, disposal exceptions, and dispatcher handoffs for waste and junk-removal companies.",
    primaryOperatingQuestion: "which route or missed pickup needs dispatch attention now?",
    topConcerns: [
      "missed pickups or contaminated loads",
      "route completion risk",
      "truck and crew capacity",
      "customer/site access issues",
      "disposal or transfer-station exceptions",
    ],
    semanticArchetypeIds: ["waste-management", "waste-hauling", "junk-removal", "sanitation-services"],
    archetypeCategories: [],
    primitives: ["geo-map", "capacity-lanes", "decision-queue", "communication-exceptions", "handoff-queue"],
    requiredCanonicalData: ["customer-account", "work-item", "work-schedule", "calendar-event"],
    requiredSignals: ["scheduled-work", "urgent-exception", "communication-failed", "coworker-handoff"],
    components: [
      { key: "customer-map", slotId: "today-now", primitiveKey: "geo-map", title: "Route completion and missed pickups", dataRefs: [customerAccount, scheduledWork] },
      { key: "technician-load", slotId: "today-now", primitiveKey: "capacity-lanes", title: "Truck and crew capacity", dataRefs: [workSchedule, calendarEvent] },
      { key: "unassigned-work", slotId: "exceptions-needs-review", primitiveKey: "decision-queue", title: "Route exceptions needing dispatch", dataRefs: [workItem, urgentException] },
      { key: "customer-callbacks", slotId: "exceptions-needs-review", primitiveKey: "communication-exceptions", title: "Customer/site communication issues", dataRefs: [failedCommunication] },
      { key: "coworker-handoffs", slotId: "coworker-handoffs", primitiveKey: "handoff-queue", title: "Dispatcher handoffs", dataRefs: [coworkerHandoff] },
    ],
  }),
];
