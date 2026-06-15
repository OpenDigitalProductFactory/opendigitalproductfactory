import type { ArchetypeDefinition, SchedulingDefaults } from "../types";

const HEALTHCARE_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "customer-choice",
  defaultOperatingHours: [1, 2, 3, 4, 5].map((day) => ({ day, start: "08:00", end: "17:00" })),
  defaultBeforeBuffer: 5,
  defaultAfterBuffer: 10,
  minimumNoticeHours: 24,
  maxAdvanceDays: 90,
};

const BOOKING_CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
  { name: "notes", label: "Additional notes", type: "textarea" as const, required: false },
];

// Mobile / in-home healthcare sends a clinician to the patient rather than the
// patient to a clinic. form=services + delivery=physical + onsite-plus-portal
// (with episode-of-care provisioning) is what the forthcoming Field Dispatch
// capability reads to derive the dispatch board and clinician routing. The
// HIPAA / clinical-notes compliance overlay is captured at the capability layer
// (Field Dispatch design ADR-5), not in the storefront template.
const MOBILE_HEALTH_ACTIVATION: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: ["service-operations", "billing-readiness", "lifecycle-signals"],
  billingReadinessMode: "prepared-not-prescribed",
  customerGraph: "none",
  estateSeparation: "shared",
  axes: {
    form: "services",
    delivery: "physical",
    // Patients are individuals from the storefront's perspective; the precise
    // patient-and-payer consumer is a clinical-billing refinement for later.
    primaryConsumer: "individual",
    consumptionChannel: "onsite-plus-portal",
    commercialModel: "encounter-based",
    provisioning: "episode-of-care",
    platform: "no",
  },
  portfolios: {
    foundational: { scope: "minimal" },
    manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill"] },
    forEmployees: { scope: "standard" },
    productsAndServicesSold: { scope: "primary" },
  },
};

// Mobile visits run back-to-back with travel time between homes; phlebotomy
// favours early-morning fasting draws.
const MOBILE_VISIT_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "next-available",
  defaultOperatingHours: [1, 2, 3, 4, 5, 6].map((day) => ({ day, start: "07:00", end: "16:00" })),
  defaultBeforeBuffer: 15,
  defaultAfterBuffer: 20,
  minimumNoticeHours: 24,
  maxAdvanceDays: 60,
};

export const healthcareWellnessArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "veterinary-clinic",
    name: "Veterinary Clinic",
    category: "healthcare-wellness",
    ctaType: "booking",
    tags: ["pets", "healthcare", "appointment", "animals"],
    itemTemplates: [
      { name: "General Consultation", description: "Full health check for your pet", priceType: "fixed", bookingDurationMinutes: 30 },
      { name: "Vaccination", description: "Annual or booster vaccinations", priceType: "fixed", bookingDurationMinutes: 20 },
      { name: "Dental Check", description: "Oral health examination", priceType: "fixed", bookingDurationMinutes: 30 },
      { name: "Emergency Consultation", description: "Urgent care when you need it most", priceType: "from", bookingDurationMinutes: 45 },
      { name: "Microchipping", description: "Permanent ID for your pet", priceType: "fixed", bookingDurationMinutes: 15 },
      { name: "Neutering / Spaying", description: "Surgical procedures — contact us for a quote", priceType: "quote" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Our Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "team", title: "Meet the Team", sortOrder: 3 },
      { type: "testimonials", title: "What Pet Owners Say", sortOrder: 4 },
      { type: "contact", title: "Find Us", sortOrder: 5 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      { name: "petName", label: "Pet name", type: "text" as const, required: true },
      { name: "species", label: "Species", type: "select" as const, required: true, options: ["Dog", "Cat", "Rabbit", "Bird", "Reptile", "Other"] },
      { name: "breed", label: "Breed (optional)", type: "text" as const, required: false },
    ],
    schedulingDefaults: HEALTHCARE_SCHEDULING,
  },
  {
    archetypeId: "dental-practice",
    name: "Dental Practice",
    category: "healthcare-wellness",
    ctaType: "booking",
    tags: ["dental", "healthcare", "appointment"],
    itemTemplates: [
      { name: "New Patient Examination", description: "Comprehensive first visit for new patients", priceType: "fixed", bookingDurationMinutes: 60 },
      { name: "Check-up & Clean", description: "Routine examination and hygiene clean", priceType: "fixed", bookingDurationMinutes: 45 },
      { name: "Teeth Whitening", description: "Professional whitening treatment", priceType: "from", bookingDurationMinutes: 90 },
      { name: "Fillings", description: "White composite fillings", priceType: "from", bookingDurationMinutes: 45 },
      { name: "Orthodontic Consultation", description: "Assessment for braces or aligners", priceType: "free", bookingDurationMinutes: 30 },
      { name: "Emergency Appointment", description: "Urgent dental care", priceType: "from", bookingDurationMinutes: 30 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Treatments", sortOrder: 1 },
      { type: "about", title: "About the Practice", sortOrder: 2 },
      { type: "team", title: "Our Dentists", sortOrder: 3 },
      { type: "gallery", title: "Our Practice", sortOrder: 4 },
      { type: "contact", title: "Find Us", sortOrder: 5 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      { name: "patientType", label: "Patient type", type: "select" as const, required: true, options: ["New patient", "Existing patient"] },
    ],
    schedulingDefaults: HEALTHCARE_SCHEDULING,
  },
  {
    archetypeId: "physiotherapy",
    name: "Physiotherapy",
    category: "healthcare-wellness",
    ctaType: "booking",
    tags: ["physio", "healthcare", "rehabilitation", "appointment"],
    itemTemplates: [
      { name: "Initial Assessment", description: "Full assessment of your condition and treatment plan", priceType: "fixed", bookingDurationMinutes: 60 },
      { name: "Follow-up Session", description: "Ongoing treatment session", priceType: "fixed", bookingDurationMinutes: 45 },
      { name: "Sports Injury Rehab", description: "Specialised sports injury rehabilitation", priceType: "per-session", bookingDurationMinutes: 60 },
      { name: "Post-Surgery Rehab", description: "Recovery support after surgery", priceType: "per-session", bookingDurationMinutes: 60 },
      { name: "Dry Needling", description: "Targeted muscle release treatment", priceType: "fixed", bookingDurationMinutes: 30 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Treatments", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "team", title: "Our Therapists", sortOrder: 3 },
      { type: "contact", title: "Book an Appointment", sortOrder: 4 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      { name: "condition", label: "Area of concern", type: "text" as const, required: false, placeholder: "e.g. lower back pain" },
      { name: "referral", label: "Referred by", type: "select" as const, required: false, options: ["GP", "Specialist", "Self-referred", "Employer", "Insurance"] },
    ],
    schedulingDefaults: HEALTHCARE_SCHEDULING,
  },
  {
    archetypeId: "counselling",
    name: "Counselling / Therapy",
    category: "healthcare-wellness",
    ctaType: "booking",
    tags: ["mental health", "therapy", "counselling", "appointment"],
    itemTemplates: [
      { name: "Free Initial Consultation", description: "15-minute call to discuss your needs", priceType: "free", bookingDurationMinutes: 15 },
      { name: "Individual Session", description: "One-to-one therapy session", priceType: "per-session", bookingDurationMinutes: 60 },
      { name: "Couples Session", description: "Session for couples or partners", priceType: "per-session", bookingDurationMinutes: 75 },
      { name: "Group Therapy", description: "Facilitated group session", priceType: "per-session", bookingDurationMinutes: 90 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "about", title: "About", sortOrder: 1 },
      { type: "items", title: "Sessions", sortOrder: 2 },
      { type: "team", title: "Our Therapists", sortOrder: 3 },
      { type: "contact", title: "Get in Touch", sortOrder: 4 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      { name: "sessionType", label: "Session type", type: "select" as const, required: true, options: ["Individual", "Couples", "Group"] },
      { name: "preferredContact", label: "Preferred contact method", type: "select" as const, required: false, options: ["Email", "Phone", "Either"] },
    ],
    schedulingDefaults: HEALTHCARE_SCHEDULING,
  },
  {
    archetypeId: "optician",
    name: "Optician",
    category: "healthcare-wellness",
    ctaType: "booking",
    tags: ["vision", "eyes", "healthcare", "appointment"],
    itemTemplates: [
      { name: "Eye Test", description: "Full sight test and eye health examination", priceType: "fixed", bookingDurationMinutes: 30 },
      { name: "Contact Lens Consultation", description: "Assessment and fitting for contact lenses", priceType: "fixed", bookingDurationMinutes: 45 },
      { name: "Glasses Frames", description: "Browse our range of designer and own-brand frames", priceType: "from", priceAmount: 89, ctaType: "purchase" },
      { name: "Prescription Lenses", description: "Single-vision, varifocal, and tinted lenses", priceType: "from", priceAmount: 120, ctaType: "purchase" },
      { name: "Children's Eye Test", description: "NHS-funded sight test for under-16s", priceType: "free", bookingDurationMinutes: 30 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services & Products", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "gallery", title: "Our Frames", sortOrder: 3 },
      { type: "contact", title: "Visit Us", sortOrder: 4 },
    ],
    formSchema: BOOKING_CONTACT_FIELDS,
    schedulingDefaults: HEALTHCARE_SCHEDULING,
  },
  {
    archetypeId: "home-health-care",
    name: "Home Health & In-Home Care",
    category: "healthcare-wellness",
    ctaType: "inquiry",
    tags: ["home health", "in-home care", "nursing", "caregiver", "elder care", "domiciliary care"],
    itemTemplates: [
      { name: "Free Care Assessment", description: "In-home assessment of needs and a personalised care plan", priceType: "free" },
      { name: "Skilled Nursing Visit", description: "Wound care, medication management, and clinical monitoring at home", priceType: "from" },
      { name: "Personal Care & Companionship", description: "Help with bathing, dressing, meals, and daily living", priceType: "per-hour" },
      { name: "Post-Hospital Recovery Care", description: "Short-term support after a hospital stay or surgery", priceType: "from" },
      { name: "Respite Care", description: "Temporary cover so family caregivers can take a break", priceType: "per-hour" },
      { name: "24-Hour / Live-In Care", description: "Round-the-clock care in the comfort of home", priceType: "quote" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Our Care Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "team", title: "Our Caregivers", sortOrder: 3 },
      { type: "testimonials", title: "Family Stories", sortOrder: 4 },
      { type: "contact", title: "Request an Assessment", sortOrder: 5 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      { name: "careFor", label: "Who is the care for?", type: "select" as const, required: true, options: ["A parent", "A spouse / partner", "Myself", "Another relative", "A client"] },
      { name: "careType", label: "Type of care needed", type: "select" as const, required: false, options: ["Skilled nursing", "Personal care", "Companionship", "Post-hospital recovery", "Respite", "Live-in / 24-hour", "Not sure"] },
    ],
    activationProfile: MOBILE_HEALTH_ACTIVATION,
  },
  {
    archetypeId: "mobile-phlebotomy",
    name: "Mobile Phlebotomy & Lab Draw",
    category: "healthcare-wellness",
    ctaType: "booking",
    tags: ["phlebotomy", "blood draw", "mobile lab", "specimen collection", "at-home testing"],
    itemTemplates: [
      { name: "At-Home Blood Draw", description: "A certified phlebotomist comes to you for a single draw", priceType: "fixed", bookingDurationMinutes: 30 },
      { name: "Lab Test Panel Collection", description: "Collection and courier of your ordered lab panel", priceType: "from", bookingDurationMinutes: 30 },
      { name: "Fasting Draw (Early AM)", description: "Early-morning fasting blood collection", priceType: "fixed", bookingDurationMinutes: 30 },
      { name: "Corporate / Group Draw", description: "On-site collection for workplaces and wellness programs", priceType: "quote" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "contact", title: "Book a Draw", sortOrder: 3 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      { name: "address", label: "Collection address", type: "text" as const, required: true },
      { name: "hasLabOrder", label: "Do you have a lab order / requisition?", type: "select" as const, required: true, options: ["Yes", "No", "Not sure"] },
    ],
    schedulingDefaults: MOBILE_VISIT_SCHEDULING,
    activationProfile: MOBILE_HEALTH_ACTIVATION,
  },
  {
    // DME = durable medical equipment. The dispatch is the delivery + setup +
    // patient training visit. DMEPOS / HIPAA handling is a capability-layer
    // compliance overlay (Field Dispatch design ADR-5).
    archetypeId: "dme-delivery",
    name: "Medical Equipment Delivery & Setup",
    category: "healthcare-wellness",
    ctaType: "inquiry",
    tags: ["dme", "medical equipment", "durable medical equipment", "oxygen", "mobility", "home medical", "delivery"],
    itemTemplates: [
      { name: "Hospital Bed Delivery & Setup", description: "Delivery, assembly, and demonstration of a home hospital bed", priceType: "from" },
      { name: "Oxygen Equipment Setup", description: "Concentrator or cylinder delivery with patient training", priceType: "quote" },
      { name: "Mobility Equipment", description: "Wheelchairs, walkers, and scooters fitted to the patient", priceType: "from" },
      { name: "CPAP / Respiratory Setup", description: "Delivery, fitting, and education for respiratory devices", priceType: "from" },
      { name: "Equipment Service & Pickup", description: "Maintenance, repair, and collection of returned equipment", priceType: "from" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Equipment & Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "contact", title: "Request Equipment", sortOrder: 3 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      { name: "equipmentType", label: "Equipment needed", type: "select" as const, required: false, options: ["Hospital bed", "Oxygen", "Mobility (wheelchair / walker)", "CPAP / respiratory", "Other", "Not sure"] },
      { name: "deliveryAddress", label: "Delivery address", type: "text" as const, required: true },
    ],
    activationProfile: {
      profileType: "standard",
      modules: ["service-operations", "billing-readiness"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "individual",
        consumptionChannel: "onsite-plus-portal",
        commercialModel: "transactional",
        provisioning: "account-with-billing",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill"] },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
    },
  },
];
