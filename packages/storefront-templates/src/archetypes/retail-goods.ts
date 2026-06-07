import type { ArchetypeDefinition } from "../types";

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
      { name: "Featured Product 1", description: "Showcase your best-selling product", priceType: "fixed", ctaType: "purchase" },
      { name: "Featured Product 2", description: "Highlight another popular product", priceType: "fixed", ctaType: "purchase" },
      { name: "Gift Voucher", description: "Gift voucher in a variety of denominations", priceType: "from", ctaType: "purchase" },
      { name: "Bundle Deal", description: "Curated bundle of popular items at a great price", priceType: "from", ctaType: "purchase" },
      { name: "New Arrival", description: "Latest product added to our collection", priceType: "fixed", ctaType: "purchase" },
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
      { name: "Handmade Item", description: "Individually crafted piece — each one unique", priceType: "fixed", ctaType: "purchase" },
      { name: "Custom Commission", description: "Bespoke item made to your specification", priceType: "quote", ctaType: "inquiry" },
      { name: "Workshop Booking", description: "Learn the craft in a hands-on workshop", priceType: "fixed", ctaType: "booking" },
      { name: "Gift Set", description: "Curated gift set of artisan products", priceType: "fixed", ctaType: "purchase" },
      { name: "Seasonal Collection", description: "Limited edition seasonal pieces", priceType: "from", ctaType: "purchase" },
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
  },
  {
    archetypeId: "florist",
    name: "Florist",
    category: "retail-goods",
    ctaType: "purchase",
    tags: ["florist", "flowers", "bouquet", "wedding"],
    itemTemplates: [
      { name: "Seasonal Bouquet", description: "Hand-tied bouquet using the freshest seasonal flowers", priceType: "from", ctaType: "purchase" },
      { name: "Bespoke Arrangement", description: "Custom floral arrangement for any occasion", priceType: "from", ctaType: "purchase" },
      { name: "Wedding Flowers", description: "Consultation and full wedding floral service", priceType: "quote", ctaType: "inquiry" },
      { name: "Dried Flower Arrangement", description: "Long-lasting dried flower display", priceType: "from", ctaType: "purchase" },
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
];
