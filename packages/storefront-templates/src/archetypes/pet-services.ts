import type { ArchetypeDefinition } from "../types";

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
      { name: "Weekly Package", description: "5 walks per week at a discounted rate", priceType: "fixed", ctaType: "purchase" },
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
  },
];
