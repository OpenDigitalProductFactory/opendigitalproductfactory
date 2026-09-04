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

export type StorefrontPresentation = {
  entityNoun: "business" | "organization";
  productMix: {
    legend: string;
    help: string;
    primaryLabel: string;
    adjacentLabel: string;
    addedLabel: string;
    anotherLabel: string;
    addLabel: string;
    removeFallback: string;
    placeholder: string;
    lineLabel: string;
    chooseLineLabel: string;
    multiLineHelp: string;
    publicDescriptionPlaceholder: string;
  };
  publish: {
    readyTitle: string;
    description: string;
  };
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
  // BI-35753C53: DPF's own archetype is software-platform. Without an entry it fell to
  // DEFAULT_VOCABULARY and the storefront rendered "Items & items". A software platform
  // sells products on a storefront; the labels reuse existing vocabulary terms so no new
  // hardcoded-term collisions (e.g. "Platform") are introduced into the platform UI.
  "software-platform": {
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
  // BIAN-grounded banking category (BI-5D9DCDE6). Credit-union "Members" and
  // mortgage "Borrowers" arrive as leaf-level customVocabulary overrides seeded
  // from the archetype definition and merged by getVocabulary below.
  "banking-financial-services": {
    itemsLabel: "Products & Rates", singleItemLabel: "Product", addButtonLabel: "Add product",
    categoryLabel: "Product Family", priceLabel: "Rate / Fee",
    portalLabel: "Banking Portal", stakeholderLabel: "Customers",
    teamLabel: "Bankers", inboxLabel: "Applications", agentName: "Relationship Manager",
  },
  // Towns, municipal utilities, law enforcement. Leaf overrides (Ratepayers /
  // Community) ship with each archetype via customVocabulary; civic spec §8.
  "public-sector": {
    itemsLabel: "Services & Programs", singleItemLabel: "Service", addButtonLabel: "Add service",
    categoryLabel: "Department", priceLabel: "Fee",
    portalLabel: "Resident Portal", stakeholderLabel: "Residents",
    teamLabel: "Staff", inboxLabel: "Service Requests", agentName: "Resident Services",
  },
  // Rental / shared assets. Per-leaf overrides (Tenants / Storage for self-storage)
  // ship with the archetype via customVocabulary; this is the category default.
  "asset-rental": {
    itemsLabel: "Equipment & Rates", singleItemLabel: "Item", addButtonLabel: "Add item",
    categoryLabel: "Category", priceLabel: "Rate",
    portalLabel: "Rental Portal", stakeholderLabel: "Renters",
    teamLabel: "Team", inboxLabel: "Reservations", agentName: "Rental Desk",
  },
  // Residential construction — production builders (communities + display homes) and
  // custom builders (BYOL/BOYL). Per-leaf override for custom-home-builder ("Clients",
  // "Build Team") ships with that archetype via customVocabulary.
  "real-estate-construction": {
    itemsLabel: "Homes & Communities", singleItemLabel: "Home", addButtonLabel: "Add home",
    categoryLabel: "Community", priceLabel: "From",
    portalLabel: "Buyer Portal", stakeholderLabel: "Home Buyers",
    teamLabel: "Sales Team", inboxLabel: "Appointments", agentName: "New Homes Advisor",
  },
  // Media & production — project-based content/production work. Per-leaf overrides
  // (e.g. post-production "Artists") ship with each archetype via customVocabulary.
  "media-production": {
    itemsLabel: "Services", singleItemLabel: "Service", addButtonLabel: "Add service",
    categoryLabel: "Service", priceLabel: "From",
    portalLabel: "Client Portal", stakeholderLabel: "Clients",
    teamLabel: "Crew", inboxLabel: "Project Enquiries", agentName: "Production Coordinator",
  },
  // Live events & venues — ticketed shows and bookings. Per-leaf overrides
  // (e.g. venue "Guests", agency "Roster") ship via customVocabulary.
  "live-events-venues": {
    itemsLabel: "Events & Tickets", singleItemLabel: "Event", addButtonLabel: "Add event",
    categoryLabel: "Category", priceLabel: "Price",
    portalLabel: "Box Office", stakeholderLabel: "Guests",
    teamLabel: "Team", inboxLabel: "Bookings", agentName: "Box Office Manager",
  },
  // Warehousing & fulfilment — custody of a client's goods. The stakeholder is
  // the *client* whose stock is held (a 3PL's customer is a business shipping
  // through it), and the inbox carries enquiries for storage and handling.
  "warehousing-fulfilment": {
    itemsLabel: "Services & Rates", singleItemLabel: "Service", addButtonLabel: "Add service",
    categoryLabel: "Service", priceLabel: "Rate",
    portalLabel: "Client Portal", stakeholderLabel: "Clients",
    teamLabel: "Warehouse Team", inboxLabel: "Enquiries", agentName: "Warehouse Manager",
  },
  "fabric-care-services": {
    itemsLabel: "Services", singleItemLabel: "Service", addButtonLabel: "Add service",
    categoryLabel: "Service", priceLabel: "Price",
    portalLabel: "Customer Portal", stakeholderLabel: "Customers",
    teamLabel: "Fabric Care Team", inboxLabel: "Orders", agentName: "Fabric Care Coordinator",
  },
  "agriculture-ranching": {
    itemsLabel: "Products & Services", singleItemLabel: "Product or Service", addButtonLabel: "Add product or service",
    categoryLabel: "Type", priceLabel: "Price or Rate",
    portalLabel: "Farm & Ranch Portal", stakeholderLabel: "Customers",
    teamLabel: "Farm & Ranch Team", inboxLabel: "Farm & Ranch Requests", agentName: "Farm & Ranch Steward",
  },
  "manufacturing": {
    itemsLabel: "Product Families & Capabilities", singleItemLabel: "Product or Capability", addButtonLabel: "Add product or capability",
    categoryLabel: "Product Family", priceLabel: "Quoted Price",
    portalLabel: "Customer & Supplier Portal", stakeholderLabel: "Customers",
    teamLabel: "Engineering & Operations", inboxLabel: "Commercial & Engineering Requests", agentName: "Operations Coordinator",
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

/**
 * Resolve the surrounding operator copy from the same archetype vocabulary
 * authority as the portal and stakeholder labels. The product-line data model
 * stays canonical; this projection only changes the words people see.
 */
export function getStorefrontPresentation(
  category: string | null | undefined,
  customVocabulary?: Record<string, string> | null,
): StorefrontPresentation {
  const vocabulary = getVocabulary(category, customVocabulary);
  const stakeholders = vocabulary.stakeholderLabel.toLowerCase();

  if (category === "nonprofit-community") {
    return {
      entityNoun: "organization",
      productMix: {
        legend: "What does your organization offer?",
        help:
          `Start with the main programme below. Add another only if ${stakeholders} ` +
          "or the people you serve engage with something meaningfully different.",
        primaryLabel: "Main programme",
        adjacentLabel: "Also offer",
        addedLabel: "Added programme",
        anotherLabel: "Another programme",
        addLabel: "Add programme",
        removeFallback: "programme",
        placeholder: "e.g. Community education",
        lineLabel: "Programme",
        chooseLineLabel: "Choose a programme",
        multiLineHelp:
          "Shown because this organization offers more than one programme.",
        publicDescriptionPlaceholder: "Supporter-facing description",
      },
      publish: {
        readyTitle: `Your ${vocabulary.portalLabel} is ready — publish it now`,
        description: `It is not live yet, so the public link returns a 404. Publish it so ${stakeholders} can find you.`,
      },
    };
  }

  const publicPortal =
    vocabulary.portalLabel === "Storefront"
      ? "storefront"
      : vocabulary.portalLabel;
  return {
    entityNoun: "business",
    productMix: {
      legend: "What does your business sell?",
      help:
        "Start with the main line below. Add another only if customers buy something meaningfully different from you.",
      primaryLabel: "Main product line",
      adjacentLabel: "Also sell",
      addedLabel: "Added product line",
      anotherLabel: "Another product line",
      addLabel: "Add product line",
      removeFallback: "product line",
      placeholder: "e.g. Conferences and events",
      lineLabel: "Product line",
      chooseLineLabel: "Choose a product line",
      multiLineHelp:
        "Shown because this business sells through more than one product line.",
      publicDescriptionPlaceholder: "Customer-facing description",
    },
    publish: {
      readyTitle: `Your ${publicPortal} is ready — publish it now`,
      description: `It is not live yet, so the public link returns a 404. Publish it so ${stakeholders} can find you.`,
    },
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
  "medical-practice": ["New Patients", "Routine Care", "Preventive Care", "Follow-up", "Telehealth"],
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

  // Banking & Financial Services — product families per BIAN Loans and
  // Deposits / Cards Business Domains
  "community-bank": ["Checking", "Savings", "Certificates", "Loans", "Cards", "Business Banking"],
  "credit-union": ["Share Accounts", "Certificates", "Auto Loans", "Home Loans", "Cards", "Membership"],
  "mortgage-lending": ["Purchase", "Refinance", "HELOC", "Pre-Approval"],

  // Public sector
  "small-town-municipality": ["Permits & Licenses", "Public Works", "Parks & Recreation", "Clerk's Office", "Code Enforcement"],

  // Cooperative (nonprofit-community)
  "cooperative": ["Membership", "Member Services", "Patronage & Equity", "Governance"],
  "municipal-utility": ["Residential", "Commercial", "Irrigation", "Connection Fees", "Service Orders"],
  "law-enforcement-agency": ["Records", "Permits", "Community Programs", "Professional Standards"],
  "agricultural-cooperative": ["Harvest Equipment", "Planting Equipment", "Application Equipment", "Membership & Patronage"],

  // Rental & shared assets
  "equipment-rental": ["Earthmoving", "Access & Lifting", "Power & Site", "Cleaning", "Events"],
  "self-storage": ["Small Units", "Medium Units", "Large Units", "Climate-Controlled"],

  // Real estate & construction
  "new-home-builder": ["Single Storey", "Double Storey", "Townhouses & Duplexes", "Acreage Designs", "Granny Flats"],
  "custom-home-builder": ["New Home Build", "Knockdown & Rebuild", "Renovation & Extension", "Dual Occupancy", "Acreage Builds"],

  // Fabric care
  "dry-cleaning-plant-network": ["Dry Cleaning", "Laundry", "Pressing", "Alterations", "Pickup & Delivery"],
  "wash-and-fold-laundry": ["Wash & Fold", "Commercial Laundry", "Pickup & Delivery", "Subscriptions"],
  "alterations-tailoring": ["Alterations", "Repairs", "Fittings", "Hemming"],

  // Manufacturing
  "industrial-equipment-oem": ["Configured Equipment", "Standard Products", "Prototype & NPI", "Spares & Lifecycle Support"],
};

export function getCategorySuggestions(archetypeId: string | null | undefined): string[] {
  return CATEGORY_SUGGESTIONS[archetypeId ?? ""] ?? [];
}

/**
 * Vocabulary for a storefront is always driven by the primary archetype.
 * Thin wrapper over getVocabulary so call sites can use this named function
 * without knowing that secondaries don't contribute vocabulary.
 */
export function getVocabularyForStorefront(
  primaryCategory: string | null | undefined,
  primaryCustomVocabulary?: Record<string, string> | null,
): ArchetypeVocabulary {
  return getVocabulary(primaryCategory, primaryCustomVocabulary);
}
