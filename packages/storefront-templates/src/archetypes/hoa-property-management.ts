import type { ArchetypeDefinition } from "../types";

const CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
  { name: "unit", label: "Unit / lot number", type: "text" as const, required: true },
  { name: "notes", label: "Message", type: "textarea" as const, required: false },
];

export const hoaPropertyManagementArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "homeowners-association",
    name: "Homeowners Association",
    category: "hoa-property-management",
    ctaType: "inquiry",
    tags: ["hoa", "homeowners", "association", "property", "community", "residential"],
    itemTemplates: [
      { name: "Annual Dues", description: "Annual homeowner association dues payment", priceType: "fixed", ctaType: "purchase" },
      { name: "Special Assessment", description: "One-time assessment for community improvements", priceType: "fixed", ctaType: "purchase" },
      { name: "Amenity Reservation", description: "Reserve the clubhouse, pool, or common area for an event", priceType: "fixed", ctaType: "booking" },
      { name: "Architectural Review Request", description: "Submit plans for exterior modifications for board review", priceType: "free", ctaType: "inquiry" },
      { name: "Maintenance Request", description: "Report a common-area maintenance issue", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "About Our Community", sortOrder: 1 },
      { type: "items", title: "Homeowner Services", sortOrder: 2 },
      { type: "team", title: "Board of Directors", sortOrder: 3 },
      { type: "contact", title: "Contact Us", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "requestType", label: "Request type", type: "select" as const, required: true, options: ["Maintenance", "Architectural Review", "Complaint", "General Inquiry", "Amenity Reservation"] },
    ],
  },
  {
    archetypeId: "condo-association",
    name: "Condominium Association",
    category: "hoa-property-management",
    ctaType: "inquiry",
    tags: ["condo", "condominium", "association", "property", "strata", "residential"],
    itemTemplates: [
      { name: "Monthly Condo Fees", description: "Monthly condominium maintenance fees", priceType: "fixed", ctaType: "purchase" },
      { name: "Special Assessment", description: "One-time levy for building repairs or improvements", priceType: "fixed", ctaType: "purchase" },
      { name: "Parking Allocation", description: "Apply for or change your parking space assignment", priceType: "free", ctaType: "inquiry" },
      { name: "Common Area Booking", description: "Reserve a party room, rooftop, or meeting space", priceType: "fixed", ctaType: "booking" },
      { name: "Maintenance Request", description: "Report an issue in shared areas or building systems", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "About Our Building", sortOrder: 1 },
      { type: "items", title: "Resident Services", sortOrder: 2 },
      { type: "team", title: "Board & Management", sortOrder: 3 },
      { type: "contact", title: "Contact Management", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "requestType", label: "Request type", type: "select" as const, required: true, options: ["Maintenance", "Noise Complaint", "Parking", "Move-in / Move-out", "General Inquiry"] },
    ],
  },
  {
    archetypeId: "property-management-company",
    name: "Property Management Company",
    category: "hoa-property-management",
    ctaType: "inquiry",
    tags: ["property-management", "rental", "landlord", "real-estate", "multi-family"],
    itemTemplates: [
      { name: "Management Services Proposal", description: "Request a proposal for property management services", priceType: "quote", ctaType: "inquiry" },
      { name: "Tenant Application", description: "Submit a rental application for a managed property", priceType: "free", ctaType: "inquiry" },
      { name: "Maintenance Request", description: "Report a repair or maintenance issue in your unit", priceType: "free", ctaType: "inquiry" },
      { name: "Lease Renewal", description: "Request a lease renewal or discuss terms", priceType: "free", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "About Our Services", sortOrder: 1 },
      { type: "items", title: "Services", sortOrder: 2 },
      { type: "testimonials", title: "Owner Testimonials", sortOrder: 3 },
      { type: "contact", title: "Get in Touch", sortOrder: 4 },
    ],
    formSchema: [
      { name: "name", label: "Full name", type: "text" as const, required: true },
      { name: "email", label: "Email", type: "email" as const, required: true },
      { name: "phone", label: "Phone", type: "tel" as const, required: false },
      { name: "inquiryType", label: "I am a", type: "select" as const, required: true, options: ["Property Owner", "Current Tenant", "Prospective Tenant", "HOA Board Member"] },
      { name: "notes", label: "Message", type: "textarea" as const, required: false },
    ],
  },
];
