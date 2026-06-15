import type { ArchetypeDefinition, SchedulingDefaults } from "../types";

// Artisan workshops are booked into daytime slots, typically Tue–Sat. The
// archetype's top-level ctaType is "purchase" (selling goods), but the
// "Workshop Booking" item is ctaType:"booking" and needs schedulingDefaults or
// its calendar ships empty (same root cause as AUDIT-R3/R4).
const WORKSHOP_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "customer-choice",
  defaultOperatingHours: [2, 3, 4, 5, 6].map((day) => ({ day, start: "10:00", end: "17:00" })),
  defaultBeforeBuffer: 0,
  defaultAfterBuffer: 15,
  minimumNoticeHours: 48,
  maxAdvanceDays: 90,
};

const CONTACT_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
  { name: "notes", label: "Notes", type: "textarea" as const, required: false },
];

export const retailGoodsArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "retail-goods",
    name: "Retail Shop",
    category: "retail-goods",
    ctaType: "purchase",
    tags: ["retail", "shop", "products", "ecommerce"],
    itemTemplates: [
      { name: "Featured Product 1", description: "Showcase your best-selling product", priceType: "fixed", priceAmount: 25, ctaType: "purchase" },
      { name: "Featured Product 2", description: "Highlight another popular product", priceType: "fixed", priceAmount: 18, ctaType: "purchase" },
      { name: "Gift Voucher", description: "Gift voucher in a variety of denominations", priceType: "from", priceAmount: 10, ctaType: "purchase" },
      { name: "Bundle Deal", description: "Curated bundle of popular items at a great price", priceType: "from", priceAmount: 35, ctaType: "purchase" },
      { name: "New Arrival", description: "Latest product added to our collection", priceType: "fixed", priceAmount: 22, ctaType: "purchase" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Shop", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "gallery", title: "Products", sortOrder: 3 },
      { type: "contact", title: "Contact Us", sortOrder: 4 },
    ],
    formSchema: CONTACT_FIELDS,
  },
  {
    archetypeId: "artisan-goods",
    name: "Artisan Goods",
    category: "retail-goods",
    ctaType: "purchase",
    tags: ["artisan", "handmade", "craft", "bespoke"],
    itemTemplates: [
      { name: "Handmade Item", description: "Individually crafted piece — each one unique", priceType: "fixed", priceAmount: 45, ctaType: "purchase" },
      { name: "Custom Commission", description: "Bespoke item made to your specification", priceType: "quote", ctaType: "inquiry" },
      { name: "Workshop Booking", description: "Learn the craft in a hands-on workshop", priceType: "fixed", ctaType: "booking" },
      { name: "Gift Set", description: "Curated gift set of artisan products", priceType: "fixed", priceAmount: 35, ctaType: "purchase" },
      { name: "Seasonal Collection", description: "Limited edition seasonal pieces", priceType: "from", priceAmount: 25, ctaType: "purchase" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Shop", sortOrder: 1 },
      { type: "about", title: "The Maker's Story", sortOrder: 2 },
      { type: "gallery", title: "Gallery", sortOrder: 3 },
      { type: "contact", title: "Get in Touch", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "commissionDetails", label: "Commission details", type: "textarea" as const, required: false, placeholder: "Describe what you have in mind" },
    ],
    schedulingDefaults: WORKSHOP_SCHEDULING,
  },
  {
    archetypeId: "florist",
    name: "Florist",
    category: "retail-goods",
    ctaType: "purchase",
    tags: ["florist", "flowers", "bouquet", "wedding"],
    itemTemplates: [
      { name: "Seasonal Bouquet", description: "Hand-tied bouquet using the freshest seasonal flowers", priceType: "from", priceAmount: 25, ctaType: "purchase" },
      { name: "Bespoke Arrangement", description: "Custom floral arrangement for any occasion", priceType: "from", priceAmount: 55, ctaType: "purchase" },
      { name: "Wedding Flowers", description: "Consultation and full wedding floral service", priceType: "quote", ctaType: "inquiry" },
      { name: "Dried Flower Arrangement", description: "Long-lasting dried flower display", priceType: "from", priceAmount: 30, ctaType: "purchase" },
      { name: "Funeral Tribute", description: "Sympathy flowers and funeral tributes", priceType: "from", ctaType: "inquiry" },
      { name: "Corporate Flowers", description: "Regular fresh flower arrangements for your office", priceType: "from", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Arrangements", sortOrder: 1 },
      { type: "gallery", title: "Our Work", sortOrder: 2 },
      { type: "about", title: "About Us", sortOrder: 3 },
      { type: "contact", title: "Order Flowers", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "occasion", label: "Occasion", type: "select" as const, required: false, options: ["Birthday", "Anniversary", "Wedding", "Sympathy", "Just because", "Corporate", "Other"] },
      { name: "deliveryDate", label: "Delivery date required", type: "text" as const, required: false, placeholder: "DD/MM/YYYY" },
      { name: "budget", label: "Budget", type: "select" as const, required: false, options: ["Under £30", "£30–£60", "£60–£100", "£100–£200", "£200+", "Let the florist decide"] },
    ],
  },
  {
    // Wholesale / distribution: a goods brand selling B2B to trade buyers who
    // resell — the retail-goods archetype that typically runs a partner channel.
    // form=goods + primaryConsumer=business derives partner-program = "available"
    // (see derivePartnerProgramProfile branch 4); customer-accounts become required
    // for the business buyers. Spec 2026-06-04-partner-reseller-archetype-identity §6.1.
    archetypeId: "wholesale-distribution",
    name: "Wholesale & Distribution",
    category: "retail-goods",
    ctaType: "inquiry",
    tags: ["wholesale", "distribution", "trade", "reseller", "b2b", "stockist"],
    itemTemplates: [
      { name: "Trade Catalogue", description: "Full wholesale range with case and pallet pricing for trade accounts", priceType: "quote", ctaType: "inquiry", ctaLabel: "Request trade pricing" },
      { name: "Open a Trade Account", description: "Apply for a credit account with wholesale terms", priceType: "free", ctaType: "inquiry", ctaLabel: "Apply for an account" },
      { name: "Become a Stockist", description: "Join our reseller network and stock our range", priceType: "quote", ctaType: "inquiry", ctaLabel: "Become a stockist" },
      { name: "Distributor Program", description: "Territory distribution for high-volume partners", priceType: "quote", ctaType: "inquiry", ctaLabel: "Discuss distribution" },
      { name: "Bulk / Pallet Order", description: "Volume order with tiered trade discounts", priceType: "from", ctaType: "inquiry", ctaLabel: "Request a quote" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Trade & Wholesale", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "gallery", title: "Our Range", sortOrder: 3 },
      { type: "contact", title: "Open a Trade Account", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "companyName", label: "Trading / company name", type: "text" as const, required: true },
      { name: "partnerType", label: "How will you sell our products?", type: "select" as const, required: false, options: ["Reseller / retailer", "Distributor", "Online marketplace", "Other"] },
      { name: "estimatedVolume", label: "Estimated monthly volume", type: "select" as const, required: false, options: ["Under £1k", "£1k–£5k", "£5k–£20k", "£20k+"] },
    ],
    activationProfile: {
      profileType: "standard",
      modules: [],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "shared",
      axes: {
        form: "goods",
        delivery: "physical",
        primaryConsumer: "business",
        consumptionChannel: "sales-assisted",
        commercialModel: "account-based-fees",
        provisioning: "account-with-billing",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "minimal" },
        forEmployees: { scope: "minimal" },
        productsAndServicesSold: { scope: "primary" },
      },
    },
  },
  {
    // White-glove last-mile: the operating model is a delivery + installation
    // *service* (crew + truck to a property), not a goods sale — which is why it
    // sets form=services and derives field dispatch. Composes as a secondary
    // service line on a retail primary (Field Dispatch composition design §6).
    archetypeId: "furniture-delivery-install",
    name: "Furniture & Appliance Delivery & Install",
    category: "retail-goods",
    ctaType: "inquiry",
    tags: ["delivery", "white glove", "furniture assembly", "appliance installation", "last mile", "haul away"],
    itemTemplates: [
      { name: "White-Glove Delivery", description: "Two-person delivery to the room of choice with packaging removed", priceType: "from", ctaType: "inquiry" },
      { name: "Furniture Assembly", description: "On-site assembly of flat-pack and built furniture", priceType: "from", ctaType: "inquiry" },
      { name: "Appliance Delivery & Install", description: "Deliver, connect, and test large appliances", priceType: "from", ctaType: "inquiry" },
      { name: "TV & Wall Mounting", description: "Mount and set up televisions and shelving", priceType: "fixed", ctaType: "inquiry" },
      { name: "Haul-Away of Old Item", description: "Remove and responsibly dispose of the item being replaced", priceType: "fixed", ctaType: "inquiry" },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Delivery & Install Services", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "testimonials", title: "Customer Reviews", sortOrder: 3 },
      { type: "contact", title: "Request a Quote", sortOrder: 4 },
    ],
    formSchema: [
      ...CONTACT_FIELDS,
      { name: "itemType", label: "What needs delivering or installing?", type: "select" as const, required: true, options: ["Furniture", "Large appliance", "TV / electronics", "Multiple items", "Other"] },
      { name: "deliveryAddress", label: "Delivery address", type: "text" as const, required: true },
      { name: "accessNotes", label: "Access notes (stairs, lift, parking)", type: "textarea" as const, required: false },
    ],
    activationProfile: {
      profileType: "standard",
      modules: ["service-operations"],
      billingReadinessMode: "none",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "household",
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
