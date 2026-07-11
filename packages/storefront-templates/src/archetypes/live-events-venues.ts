import type { ArchetypeDefinition, SchedulingDefaults } from "../types";

// Live Events & Venues archetypes — the businesses that SELL the show:
// ticketed event venues (theatres, concert halls, live-music clubs — box
// office), tour / concert promoters (arrange tours, book talent + venues, carry
// the box-office risk), and talent & booking agencies (represent performers and
// place them into gigs). The defining value stream is event-driven and ticketed:
// announce → put on sale → sell tickets → run the event → settle. Capacity is a
// physical hard cap (seats / room), and demand is event-driven (spikes at
// on-sale and event date), which is why the kernel split this from the
// project-based media-production category (see media-production.ts header).

// Venue box offices and agency consultations open bookable slots (private hire
// walk-through, artist consultation) even though the archetype CTAs are
// purchase / inquiry — so schedulingDefaults is required (AUDIT-R3/R4).
const LIVE_EVENTS_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "customer-choice",
  // Box offices and event teams run long days including weekends.
  defaultOperatingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: "10:00", end: "20:00" })),
  defaultBeforeBuffer: 0,
  defaultAfterBuffer: 15,
  minimumNoticeHours: 12,
  maxAdvanceDays: 120,
};

const GUEST_CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
];

export const liveEventsVenuesArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "event-venue",
    name: "Event Venue & Box Office",
    category: "live-events-venues",
    ctaType: "purchase",
    tags: ["venue", "box-office", "tickets", "theatre", "concert-hall", "live-music", "seating", "events"],
    itemTemplates: [
      { name: "General Admission Ticket", description: "Standing / unreserved admission to the show", priceType: "fixed", priceAmount: 25, ctaType: "purchase", ctaLabel: "Buy tickets" },
      { name: "Reserved Seating", description: "Allocated seat — choose your section", priceType: "from", priceAmount: 35, ctaType: "purchase", ctaLabel: "Buy tickets" },
      { name: "VIP / Premium Package", description: "Best seats, early entry, and hospitality", priceType: "from", priceAmount: 75, ctaType: "purchase", ctaLabel: "Buy tickets" },
      { name: "Season Pass / Membership", description: "Priority booking and discounts across the season", priceType: "fixed", priceAmount: 150, ctaType: "purchase" },
      { name: "Group Booking (10+)", description: "Discounted rate for groups of ten or more", priceType: "from", priceAmount: 20, ctaType: "inquiry" },
      { name: "Private Venue Hire", description: "Hire the space for your own event — tell us your dates", priceType: "quote", ctaType: "booking", bookingDurationMinutes: 45 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "What's On & Tickets", sortOrder: 1 },
      { type: "about", title: "About the Venue", sortOrder: 2 },
      { type: "gallery", title: "The Space", sortOrder: 3 },
      { type: "contact", title: "Box Office", sortOrder: 4 },
    ],
    formSchema: [
      ...GUEST_CONTACT_FIELDS,
      { name: "event", label: "Which event?", type: "text" as const, required: false },
      { name: "ticketQuantity", label: "How many tickets?", type: "select" as const, required: false, options: ["1", "2", "3–4", "5–9", "10+"] },
      { name: "accessibility", label: "Accessibility needs", type: "textarea" as const, required: false },
    ],
    schedulingDefaults: LIVE_EVENTS_SCHEDULING,
    vocabulary: {
      itemsLabel: "What's On & Tickets",
      singleItemLabel: "Event",
      addButtonLabel: "Add event",
      portalLabel: "Box Office",
      stakeholderLabel: "Guests",
      teamLabel: "Venue Team",
      inboxLabel: "Bookings",
      agentName: "Box Office Manager",
    },
    activationProfile: {
      profileType: "standard",
      modules: ["billing-readiness", "service-operations", "lifecycle-signals"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "individual",
        consumptionChannel: "multi-channel",
        commercialModel: "transactional",
        provisioning: "none",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "Ticketed Events",
        "Memberships & Passes",
        "Private Hire",
        "Hospitality",
      ],
    },
  },
  {
    archetypeId: "tour-promoter",
    name: "Concert Promoter & Tour Operator",
    category: "live-events-venues",
    ctaType: "purchase",
    tags: ["promoter", "tour", "concert", "live-music", "tickets", "booking", "festival", "events"],
    itemTemplates: [
      { name: "Event Ticket", description: "Tickets to a promoted show", priceType: "from", priceAmount: 30, ctaType: "purchase", ctaLabel: "Buy tickets" },
      { name: "Tour Package (Multi-City)", description: "Follow the tour — bundled tickets across dates", priceType: "from", priceAmount: 90, ctaType: "purchase", ctaLabel: "Buy tickets" },
      { name: "VIP Experience", description: "Meet-and-greet, early entry, and premium seating", priceType: "from", priceAmount: 150, ctaType: "purchase", ctaLabel: "Buy tickets" },
      { name: "Book an Act (Venues & Buyers)", description: "Bring one of our shows or artists to your venue", priceType: "quote", ctaType: "inquiry" },
      { name: "Sponsorship & Partnership", description: "Partner with a tour or festival", priceType: "quote", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Shows & Tours", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "gallery", title: "Past Shows", sortOrder: 3 },
      { type: "contact", title: "Get in Touch", sortOrder: 4 },
    ],
    formSchema: [
      ...GUEST_CONTACT_FIELDS,
      { name: "interest", label: "I'm interested in", type: "select" as const, required: false, options: ["Buying tickets", "Booking an act", "Sponsorship / partnership", "Press / media", "Other"] },
      { name: "show", label: "Which show / tour?", type: "text" as const, required: false },
      { name: "message", label: "Message", type: "textarea" as const, required: false },
    ],
    vocabulary: {
      itemsLabel: "Shows & Tours",
      singleItemLabel: "Show",
      addButtonLabel: "Add show",
      portalLabel: "Promoter Portal",
      stakeholderLabel: "Fans",
      teamLabel: "Team",
      inboxLabel: "Enquiries",
      agentName: "Tour Manager",
    },
    activationProfile: {
      profileType: "standard",
      modules: ["projects", "billing-readiness", "lifecycle-signals"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "individual",
        consumptionChannel: "multi-channel",
        commercialModel: "transactional",
        provisioning: "none",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "primary", it4itStages: ["strategy-to-portfolio", "request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "Ticketed Shows",
        "Tours",
        "Artist Booking",
        "Sponsorship",
      ],
    },
  },
  {
    archetypeId: "talent-booking-agency",
    name: "Talent & Booking Agency",
    category: "live-events-venues",
    ctaType: "inquiry",
    tags: ["talent", "booking-agency", "artists", "performers", "entertainment", "roster", "corporate-entertainment", "events"],
    itemTemplates: [
      { name: "Book an Artist", description: "Bands, DJs, and performers for your event", priceType: "quote", ctaType: "inquiry" },
      { name: "Corporate Entertainment", description: "Acts, hosts, and speakers for corporate events", priceType: "quote", ctaType: "inquiry" },
      { name: "Weddings & Private Events", description: "Live music and entertainment for private occasions", priceType: "quote", ctaType: "inquiry" },
      { name: "Speaker / Host Booking", description: "Keynote speakers, MCs, and hosts", priceType: "quote", ctaType: "inquiry" },
      { name: "Roster Representation (Artists)", description: "Are you a performer? Apply to join our roster", priceType: "free", ctaType: "inquiry" },
      { name: "Consultation Call", description: "Free call to find the right act for your event", priceType: "free", ctaType: "booking", bookingDurationMinutes: 30 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Booking Services", sortOrder: 1 },
      { type: "team", title: "Our Roster", sortOrder: 2 },
      { type: "about", title: "About the Agency", sortOrder: 3 },
      { type: "contact", title: "Make a Booking", sortOrder: 4 },
    ],
    formSchema: [
      ...GUEST_CONTACT_FIELDS,
      { name: "bookingType", label: "What are you booking?", type: "select" as const, required: false, options: ["Band / live music", "DJ", "Corporate entertainment", "Wedding / private", "Speaker / host", "Roster application", "Other"] },
      { name: "eventDate", label: "Event date", type: "text" as const, required: false, placeholder: "DD/MM/YYYY" },
      { name: "budget", label: "Budget", type: "text" as const, required: false },
      { name: "details", label: "Event details", type: "textarea" as const, required: false },
    ],
    schedulingDefaults: LIVE_EVENTS_SCHEDULING,
    vocabulary: {
      itemsLabel: "Booking Services",
      portalLabel: "Booking Portal",
      stakeholderLabel: "Clients",
      teamLabel: "Roster",
      inboxLabel: "Booking Enquiries",
      agentName: "Booking Agent",
    },
    activationProfile: {
      profileType: "standard",
      modules: ["service-operations", "billing-readiness", "lifecycle-signals"],
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
        manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
      seededServiceCategories: [
        "Live Music",
        "Corporate Entertainment",
        "Private Events",
        "Speakers & Hosts",
      ],
    },
  },
];
