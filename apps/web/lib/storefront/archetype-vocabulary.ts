// apps/web/lib/storefront/archetype-vocabulary.ts
// Archetype-aware vocabulary and category suggestions for item management.
// Maps archetype category to business-type-specific labels.

export type ArchetypeVocabulary = {
  // Item-level labels
  itemsLabel: string;
  singleItemLabel: string;
  addButtonLabel: string;
  categoryLabel: string;
  priceLabel: string;
  // Portal-level labels
  portalLabel: string;
  stakeholderLabel: string;
  teamLabel: string;
  inboxLabel: string;
  agentName: string;
};

const VOCABULARY: Record<string, ArchetypeVocabulary> = {
  "food-hospitality": {
    itemsLabel: "Menu", singleItemLabel: "Item", addButtonLabel: "Add to menu",
    categoryLabel: "Course", priceLabel: "Price",
    portalLabel: "Venue Portal", stakeholderLabel: "Guests",
    teamLabel: "Staff", inboxLabel: "Reservations", agentName: "Venue Manager",
  },
  "education-training": {
    itemsLabel: "Courses", singleItemLabel: "Course", addButtonLabel: "Add course",
    categoryLabel: "Level", priceLabel: "Fee",
    portalLabel: "Academy Portal", stakeholderLabel: "Students",
    teamLabel: "Instructors", inboxLabel: "Enrolments", agentName: "Enrolment Manager",
  },
  "retail-goods": {
    itemsLabel: "Products", singleItemLabel: "Product", addButtonLabel: "Add product",
    categoryLabel: "Category", priceLabel: "Price",
    portalLabel: "Storefront", stakeholderLabel: "Customers",
    teamLabel: "Team", inboxLabel: "Inbox", agentName: "Marketing Specialist",
  },
  "healthcare-wellness": {
    itemsLabel: "Services", singleItemLabel: "Service", addButtonLabel: "Add service",
    categoryLabel: "Department", priceLabel: "Fee",
    portalLabel: "Patient Portal", stakeholderLabel: "Patients",
    teamLabel: "Practitioners", inboxLabel: "Appointments", agentName: "Patient Engagement",
  },
  "beauty-personal-care": {
    itemsLabel: "Services", singleItemLabel: "Service", addButtonLabel: "Add service",
    categoryLabel: "Category", priceLabel: "Price",
    portalLabel: "Booking Portal", stakeholderLabel: "Clients",
    teamLabel: "Team", inboxLabel: "Bookings", agentName: "Client Engagement",
  },
  "trades-maintenance": {
    itemsLabel: "Services", singleItemLabel: "Service", addButtonLabel: "Add service",
    categoryLabel: "Trade", priceLabel: "Rate",
    portalLabel: "Service Portal", stakeholderLabel: "Property Owners",
    teamLabel: "Crew", inboxLabel: "Job Requests", agentName: "Lead Manager",
  },
  "professional-services": {
    itemsLabel: "Services", singleItemLabel: "Service", addButtonLabel: "Add service",
    categoryLabel: "Practice Area", priceLabel: "Fee",
    portalLabel: "Client Portal", stakeholderLabel: "Clients",
    teamLabel: "Team", inboxLabel: "Enquiries", agentName: "Client Engagement",
  },
  "pet-services": {
    itemsLabel: "Services", singleItemLabel: "Service", addButtonLabel: "Add service",
    categoryLabel: "Category", priceLabel: "Price",
    portalLabel: "Booking Portal", stakeholderLabel: "Pet Owners",
    teamLabel: "Team", inboxLabel: "Bookings", agentName: "Client Engagement",
  },
  "fitness-recreation": {
    itemsLabel: "Classes & Memberships", singleItemLabel: "Class", addButtonLabel: "Add class",
    categoryLabel: "Type", priceLabel: "Fee",
    portalLabel: "Member Portal", stakeholderLabel: "Members",
    teamLabel: "Instructors", inboxLabel: "Bookings", agentName: "Member Engagement",
  },
  "nonprofit-community": {
    itemsLabel: "Campaigns & Appeals", singleItemLabel: "Campaign", addButtonLabel: "Add campaign",
    categoryLabel: "Cause", priceLabel: "Goal",
    portalLabel: "Supporter Hub", stakeholderLabel: "Supporters",
    teamLabel: "Team", inboxLabel: "Messages", agentName: "Community Manager",
  },
  "hoa-property-management": {
    itemsLabel: "Assessments & Services", singleItemLabel: "Service", addButtonLabel: "Add service",
    categoryLabel: "Category", priceLabel: "Fee",
    portalLabel: "Community Portal", stakeholderLabel: "Homeowners",
    teamLabel: "Board & Contractors", inboxLabel: "Requests", agentName: "Community Manager",
  },
};

const DEFAULT_VOCABULARY: ArchetypeVocabulary = {
  itemsLabel: "Items", singleItemLabel: "Item", addButtonLabel: "Add item",
  categoryLabel: "Category", priceLabel: "Price",
  portalLabel: "Portal", stakeholderLabel: "Contacts",
  teamLabel: "Team", inboxLabel: "Inbox", agentName: "Marketing Specialist",
};

/**
 * Get vocabulary for an archetype category.
 * If customVocabulary is provided (from StorefrontArchetype.customVocabulary),
 * it overrides the category-based defaults for any fields present.
 */
export function getVocabulary(
  category: string | null | undefined,
  customVocabulary?: Record<string, string> | null,
): ArchetypeVocabulary {
  const base = VOCABULARY[category ?? ""] ?? DEFAULT_VOCABULARY;
  if (!customVocabulary) return base;
  return {
    ...base,
    ...(customVocabulary.itemsLabel && { itemsLabel: customVocabulary.itemsLabel }),
    ...(customVocabulary.singleItemLabel && { singleItemLabel: customVocabulary.singleItemLabel }),
    ...(customVocabulary.addButtonLabel && { addButtonLabel: customVocabulary.addButtonLabel }),
    ...(customVocabulary.categoryLabel && { categoryLabel: customVocabulary.categoryLabel }),
    ...(customVocabulary.priceLabel && { priceLabel: customVocabulary.priceLabel }),
    ...(customVocabulary.portalLabel && { portalLabel: customVocabulary.portalLabel }),
    ...(customVocabulary.stakeholderLabel && { stakeholderLabel: customVocabulary.stakeholderLabel }),
    ...(customVocabulary.teamLabel && { teamLabel: customVocabulary.teamLabel }),
    ...(customVocabulary.inboxLabel && { inboxLabel: customVocabulary.inboxLabel }),
    ...(customVocabulary.agentName && { agentName: customVocabulary.agentName }),
  };
}

// ─── Category Suggestions per Archetype ID ──────────────────────────────────

const CATEGORY_SUGGESTIONS: Record<string, string[]> = {
  // Food & Hospitality
  "restaurant": ["Starters", "Mains", "Desserts", "Drinks", "Set Menus", "Specials"],
  "bakery": ["Bread", "Cakes", "Pastries", "Savoury", "Custom Orders"],
  "catering": ["Corporate", "Wedding", "Private", "Buffet"],

  // Education & Training
  "tutoring": ["Maths", "English", "Science", "Languages", "Exam Prep"],
  "corporate-training": ["Leadership", "Technical", "Compliance", "Soft Skills"],
  "music-school": ["Guitar", "Piano", "Drums", "Vocals", "Theory"],
  "driving-school": ["Lessons", "Packages", "Tests"],

  // Retail
  "retail-shop": ["Featured", "New Arrivals", "Bundles", "Gift Cards"],
  "artisan-goods": ["Handmade", "Custom", "Workshops"],
  "florist": ["Bouquets", "Arrangements", "Wedding", "Corporate"],

  // Fitness
  "fitness-gym": ["Memberships", "Classes", "Personal Training"],
  "yoga-studio": ["Classes", "Passes", "Private Sessions", "Retreats"],
  "dance-studio": ["Classes", "Private Lessons", "Workshops"],

  // Healthcare
  "veterinary-clinic": ["Consultations", "Vaccinations", "Surgery", "Dental"],
  "dental-practice": ["Check-ups", "Treatments", "Cosmetic"],
  "physiotherapy": ["Assessment", "Treatment", "Rehabilitation"],
  "counselling-therapy": ["Individual", "Couples", "Group"],
  "optician": ["Eye Tests", "Glasses", "Contact Lenses"],

  // Beauty
  "hair-salon": ["Cut", "Colour", "Styling", "Treatments"],
  "barber-shop": ["Haircuts", "Shaves", "Grooming"],
  "beauty-spa": ["Facials", "Massage", "Body Treatments"],

  // Trades
  "plumber": ["Emergency", "Installation", "Repair", "Maintenance"],
  "electrician": ["Testing", "Installation", "Repair", "EV Charging"],
  "cleaning-service": ["Regular", "Deep Clean", "End of Tenancy", "Commercial"],
  "landscaping": ["Design", "Maintenance", "Installation", "Tree Surgery"],
  "facilities-maintenance": ["Planned", "Reactive", "Inspection", "HVAC"],

  // Professional Services
  "it-managed-services": ["Support", "Security", "Cloud", "Infrastructure"],
  "law-firm": ["Consultation", "Conveyancing", "Employment", "Commercial"],
  "accounting": ["Bookkeeping", "Accounts", "Tax", "Advisory"],
  "marketing-agency": ["Strategy", "Web", "SEO", "Social Media"],
  "consulting": ["Strategy", "Change Management", "Process", "Leadership"],

  // Nonprofit
  "pet-rescue": ["Sponsorship", "Donations", "Volunteering", "Adoption"],
  "animal-shelter": ["Sponsorship", "Donations", "Volunteering"],
  "community-shelter": ["Emergency Fund", "Volunteering", "Supplies"],
  "charity": ["Donations", "Events", "Corporate Giving"],
  "sports-club": ["Memberships", "Match Day", "Social"],

  // Pet Services
  "pet-grooming": ["Bath", "Full Groom", "Nail Trim", "Specialty"],
  "pet-boarding": ["Day Care", "Overnight", "Long Stay"],

  // HOA
  "hoa-management": ["Assessments", "Maintenance", "Amenities"],
};

export function getCategorySuggestions(archetypeId: string | null | undefined): string[] {
  return CATEGORY_SUGGESTIONS[archetypeId ?? ""] ?? [];
}
