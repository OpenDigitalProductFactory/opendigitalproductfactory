import type { ArchetypeDefinition } from "../types";

const CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
  { name: "notes", label: "Additional notes", type: "textarea" as const, required: false },
];

export const fitnessRecreationArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "gym",
    name: "Gym",
    category: "fitness-recreation",
    ctaType: "purchase",
    tags: ["gym", "fitness", "membership", "weights"],
    itemTemplates: [
      { name: "Monthly Membership", description: "Unlimited access to all gym facilities", priceType: "fixed", ctaType: "purchase" },
      { name: "Day Pass", description: "Single day access to the gym", priceType: "fixed", ctaType: "purchase" },
      { name: "Personal Training", description: "One-to-one session with a qualified PT", priceType: "per-session", ctaType: "booking", bookingDurationMinutes: 60 },
      { name: "Annual Membership", description: "12-month membership at a discounted rate", priceType: "fixed", ctaType: "purchase" },
      { name: "Student Membership", description: "Discounted membership for full-time students", priceType: "fixed", ctaType: "purchase" },
      { name: "Family Membership", description: "Access for up to 2 adults and 2 children", priceType: "from", ctaType: "purchase" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Memberships", sortOrder: 1 },
      { type: "about", title: "About the Gym", sortOrder: 2 },
      { type: "gallery", title: "Facilities", sortOrder: 3 },
      { type: "contact", title: "Join Today", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "membershipType", label: "Membership interest", type: "select" as const, required: false, options: ["Monthly", "Annual", "Day pass", "Student", "Family", "Personal Training"] },
      { name: "fitnessGoal", label: "Primary goal", type: "select" as const, required: false, options: ["Weight loss", "Muscle gain", "General fitness", "Sports performance", "Wellbeing"] },
    ],
  },
  {
    archetypeId: "yoga-studio",
    name: "Yoga Studio",
    category: "fitness-recreation",
    ctaType: "purchase",
    tags: ["yoga", "wellness", "classes", "mindfulness"],
    itemTemplates: [
      { name: "Class Pack (10 classes)", description: "10-class pack valid for 3 months", priceType: "fixed", ctaType: "purchase" },
      { name: "Monthly Unlimited", description: "Unlimited classes for one month", priceType: "fixed", ctaType: "purchase" },
      { name: "Drop-in Class", description: "Single class — book in advance", priceType: "fixed", ctaType: "booking", bookingDurationMinutes: 60 },
      { name: "Private Session", description: "One-to-one yoga session with an instructor", priceType: "per-session", ctaType: "booking", bookingDurationMinutes: 60 },
      { name: "Beginners Course", description: "6-week introductory course for new students", priceType: "fixed", ctaType: "purchase" },
      { name: "Retreat Day", description: "Full-day yoga and wellbeing retreat", priceType: "fixed", ctaType: "purchase" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Classes & Passes", sortOrder: 1 },
      { type: "about", title: "About the Studio", sortOrder: 2 },
      { type: "team", title: "Our Instructors", sortOrder: 3 },
      { type: "contact", title: "Join a Class", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "yogaStyle", label: "Style of yoga", type: "select" as const, required: false, options: ["Hatha", "Vinyasa", "Yin", "Restorative", "Ashtanga", "Not sure"] },
      { name: "experienceLevel", label: "Experience level", type: "select" as const, required: false, options: ["Complete beginner", "Some experience", "Regular practitioner", "Advanced"] },
    ],
  },
  {
    archetypeId: "dance-studio",
    name: "Dance Studio",
    category: "fitness-recreation",
    ctaType: "purchase",
    tags: ["dance", "classes", "studio", "performance"],
    itemTemplates: [
      { name: "Term Booking", description: "Full term of weekly dance classes", priceType: "fixed", ctaType: "purchase" },
      { name: "Trial Class", description: "Try a class before committing", priceType: "free", ctaType: "booking", bookingDurationMinutes: 60 },
      { name: "Private Lesson", description: "One-to-one tuition with an instructor", priceType: "per-session", ctaType: "booking", bookingDurationMinutes: 60 },
      { name: "Drop-in Class", description: "Single class — various styles available", priceType: "fixed", ctaType: "booking", bookingDurationMinutes: 60 },
      { name: "Exam Preparation", description: "ISTD or RAD grade exam coaching", priceType: "per-session", ctaType: "booking", bookingDurationMinutes: 60 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Classes", sortOrder: 1 },
      { type: "about", title: "About the Studio", sortOrder: 2 },
      { type: "gallery", title: "Performances", sortOrder: 3 },
      { type: "contact", title: "Join Us", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "danceStyle", label: "Dance style", type: "select" as const, required: false, options: ["Ballet", "Contemporary", "Jazz", "Tap", "Ballroom & Latin", "Hip Hop", "Salsa", "Other"] },
      { name: "studentAge", label: "Student age / year group", type: "text" as const, required: false },
      { name: "experienceLevel", label: "Experience level", type: "select" as const, required: false, options: ["Beginner", "Intermediate", "Advanced"] },
    ],
  },
];
