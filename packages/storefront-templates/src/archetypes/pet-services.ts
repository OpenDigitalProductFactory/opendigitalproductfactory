import type { ArchetypeDefinition, SchedulingDefaults } from "../types";

const PET_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "next-available",
  defaultOperatingHours: [1, 2, 3, 4, 5, 6].map((day) => ({ day, start: "08:00", end: "18:00" })),
  defaultBeforeBuffer: 5,
  defaultAfterBuffer: 15,
  minimumNoticeHours: 4,
  maxAdvanceDays: 60,
};

const BOOKING_CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: true },
  { name: "notes", label: "Additional notes", type: "textarea" as const, required: false },
];

const PET_FIELDS = [
  { name: "petName", label: "Pet name", type: "text" as const, required: true },
  { name: "petSize", label: "Pet size", type: "select" as const, required: true, options: ["Small (under 10kg)", "Medium (10–25kg)", "Large (25–40kg)", "Extra large (40kg+)"] },
  { name: "breed", label: "Breed", type: "text" as const, required: false },
  { name: "vaccinationsUpToDate", label: "Vaccinations up to date?", type: "select" as const, required: true, options: ["Yes", "No", "Not sure"] },
];

// Mobile pet services bring the van to the customer's door (grooming) or the
// vet to the animal (home / farm calls). form=services + delivery=physical +
// onsite-plus-portal is what derives the forthcoming Field Dispatch capability;
// rabies-vax checks and DEA/controlled-substance handling are capability-layer
// overlays (Field Dispatch design ADR-5), not modelled in the template.
const MOBILE_PET_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "next-available",
  defaultOperatingHours: [1, 2, 3, 4, 5, 6].map((day) => ({ day, start: "08:00", end: "17:00" })),
  defaultBeforeBuffer: 15,
  defaultAfterBuffer: 20,
  minimumNoticeHours: 12,
  maxAdvanceDays: 60,
};

const MOBILE_PET_ACTIVATION: ArchetypeDefinition["activationProfile"] = {
  profileType: "standard",
  modules: ["service-operations"],
  billingReadinessMode: "none",
  customerGraph: "none",
  estateSeparation: "shared",
  axes: {
    form: "services",
    delivery: "physical",
    primaryConsumer: "individual",
    consumptionChannel: "onsite-plus-portal",
    commercialModel: "appointment-checkout",
    provisioning: "account-with-billing",
    platform: "no",
  },
  portfolios: {
    foundational: { scope: "minimal" },
    manufactureAndDeliver: { scope: "primary", it4itStages: ["request-to-fulfill"] },
    forEmployees: { scope: "standard" },
    productsAndServicesSold: { scope: "primary" },
  },
};

export const petServicesArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "pet-grooming",
    name: "Pet Grooming",
    category: "pet-services",
    ctaType: "booking",
    tags: ["pet grooming", "dog", "cat", "grooming", "salon"],
    itemTemplates: [
      { name: "Full Groom", description: "Bath, dry, trim, nail clip, and ear clean", priceType: "from", bookingDurationMinutes: 90 },
      { name: "Bath & Brush", description: "Shampoo, condition, and brush out", priceType: "from", bookingDurationMinutes: 60 },
      { name: "Puppy Groom", description: "Introductory groom for puppies", priceType: "fixed", bookingDurationMinutes: 60 },
      { name: "Nail Trim", description: "Claw clipping and filing", priceType: "fixed", bookingDurationMinutes: 20 },
      { name: "De-shedding Treatment", description: "Deep treatment to reduce shedding", priceType: "from", bookingDurationMinutes: 90 },
      { name: "Cat Grooming", description: "Full or partial grooming for cats", priceType: "from", bookingDurationMinutes: 60 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Grooming Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "gallery", title: "Our Grooming Results", sortOrder: 3 },
      { type: "contact", title: "Book a Groom", sortOrder: 4 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      ...PET_FIELDS,
      { name: "coatType", label: "Coat type", type: "select" as const, required: false, options: ["Short", "Medium", "Long", "Wire", "Curly", "Double coat"] },
    ],
    schedulingDefaults: PET_SCHEDULING,
  },
  {
    archetypeId: "dog-walking",
    name: "Dog Walking",
    category: "pet-services",
    ctaType: "booking",
    tags: ["dog walking", "pet care", "exercise"],
    itemTemplates: [
      { name: "30-Minute Walk", description: "Solo or group walk — 30 minutes", priceType: "fixed", bookingDurationMinutes: 30 },
      { name: "60-Minute Walk", description: "Solo or group walk — 1 hour", priceType: "fixed", bookingDurationMinutes: 60 },
      { name: "Solo Walk", description: "One-on-one walk for your dog", priceType: "from", bookingDurationMinutes: 60 },
      { name: "Puppy Visit", description: "Home visit and short walk for puppies", priceType: "fixed", bookingDurationMinutes: 30 },
      { name: "Weekly Package", description: "5 walks per week at a discounted rate", priceType: "fixed", priceAmount: 60, ctaType: "purchase" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Walking Packages", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Happy Dog Owners", sortOrder: 3 },
      { type: "contact", title: "Book a Walk", sortOrder: 4 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      ...PET_FIELDS,
      { name: "walkFrequency", label: "Walking frequency", type: "select" as const, required: false, options: ["One-off", "Daily", "Weekdays only", "A few times a week"] },
    ],
    schedulingDefaults: PET_SCHEDULING,
  },
  {
    archetypeId: "pet-boarding",
    name: "Pet Boarding",
    category: "pet-services",
    ctaType: "booking",
    tags: ["pet boarding", "kennels", "cattery", "pet care"],
    itemTemplates: [
      { name: "Dog Boarding (per night)", description: "Overnight care in our home boarding facility", priceType: "per-session" },
      { name: "Cat Boarding (per night)", description: "Comfortable cattery accommodation per night", priceType: "per-session" },
      { name: "Dog Day Care", description: "Full day of care and play for your dog", priceType: "fixed", bookingDurationMinutes: 480 },
      { name: "Small Animal Boarding", description: "Boarding for rabbits, guinea pigs, and small pets", priceType: "per-session" },
      { name: "Meet & Greet", description: "Initial visit to assess suitability before booking", priceType: "free", bookingDurationMinutes: 30 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Boarding Options", sortOrder: 1 },
      { type: "about", title: "Our Facilities", sortOrder: 2 },
      { type: "gallery", title: "Our Space", sortOrder: 3 },
      { type: "testimonials", title: "Pet Owner Reviews", sortOrder: 4 },
      { type: "contact", title: "Book a Stay", sortOrder: 5 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      ...PET_FIELDS,
      { name: "checkInDate", label: "Check-in date", type: "text" as const, required: true, placeholder: "DD/MM/YYYY" },
      { name: "checkOutDate", label: "Check-out date", type: "text" as const, required: true, placeholder: "DD/MM/YYYY" },
    ],
    schedulingDefaults: PET_SCHEDULING,
  },
  {
    // Distinct from the shop-based pet-grooming leaf: the groomer's van comes to
    // the customer (mobile-to-customer), which is why this one derives field
    // dispatch and the shop one does not.
    archetypeId: "mobile-pet-grooming",
    name: "Mobile Pet Grooming",
    category: "pet-services",
    ctaType: "booking",
    tags: ["mobile grooming", "pet grooming", "dog", "cat", "van", "at-home"],
    itemTemplates: [
      { name: "Mobile Full Groom", description: "Full groom at your door — bath, dry, trim, nails, ears", priceType: "from", bookingDurationMinutes: 90 },
      { name: "Mobile Bath & Brush", description: "Shampoo, condition, and brush-out in the van", priceType: "from", bookingDurationMinutes: 60 },
      { name: "Nail Trim & Tidy", description: "Quick nail clip and sanitary trim at your home", priceType: "fixed", bookingDurationMinutes: 30 },
      { name: "De-shedding Treatment", description: "Deep de-shed treatment without leaving home", priceType: "from", bookingDurationMinutes: 90 },
      { name: "Cat Mobile Groom", description: "Low-stress grooming for cats at home", priceType: "from", bookingDurationMinutes: 60 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Grooming Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "gallery", title: "Our Grooming Results", sortOrder: 3 },
      { type: "contact", title: "Book a Mobile Groom", sortOrder: 4 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      ...PET_FIELDS,
      { name: "serviceAddress", label: "Service address", type: "text" as const, required: true },
      { name: "coatType", label: "Coat type", type: "select" as const, required: false, options: ["Short", "Medium", "Long", "Wire", "Curly", "Double coat"] },
    ],
    schedulingDefaults: MOBILE_PET_SCHEDULING,
    activationProfile: MOBILE_PET_ACTIVATION,
  },
  {
    // Mobile / house-call vet — companion-animal home visits and farm calls.
    // Encounter-based billing (ad-hoc invoice per visit) rather than checkout.
    archetypeId: "mobile-vet",
    name: "Mobile Veterinary Service",
    category: "pet-services",
    ctaType: "booking",
    tags: ["mobile vet", "house call vet", "veterinary", "farm vet", "at-home euthanasia", "animals"],
    itemTemplates: [
      { name: "Home Wellness Visit", description: "In-home checkup and vaccinations for your pet", priceType: "from", bookingDurationMinutes: 45 },
      { name: "Sick Visit", description: "House-call assessment for an unwell pet", priceType: "from", bookingDurationMinutes: 45 },
      { name: "Vaccination Visit", description: "Core and lifestyle vaccinations at home", priceType: "fixed", bookingDurationMinutes: 30 },
      { name: "Farm / Large Animal Call", description: "On-farm visit for livestock and equine patients", priceType: "quote" },
      { name: "End-of-Life & Hospice Care", description: "Compassionate in-home palliative care and euthanasia", priceType: "quote", bookingDurationMinutes: 60 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Our Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "team", title: "Meet the Vet", sortOrder: 3 },
      { type: "testimonials", title: "What Pet Owners Say", sortOrder: 4 },
      { type: "contact", title: "Book a Visit", sortOrder: 5 },
    ],
    formSchema: [
      ...BOOKING_CONTACT_FIELDS,
      { name: "petName", label: "Pet / animal name", type: "text" as const, required: true },
      { name: "species", label: "Species", type: "select" as const, required: true, options: ["Dog", "Cat", "Horse", "Livestock", "Small animal", "Other"] },
      { name: "serviceAddress", label: "Visit address", type: "text" as const, required: true },
      { name: "reason", label: "Reason for visit", type: "textarea" as const, required: false },
    ],
    schedulingDefaults: MOBILE_PET_SCHEDULING,
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
        commercialModel: "encounter-based",
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
