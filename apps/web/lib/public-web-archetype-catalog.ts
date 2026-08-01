export type PublicWebArchetype = {
  id: string;
  name: string;
  keywords: string[];
  category?: string;
};

/** Ordered so specific business signals win before generic storefront language. */
export const PUBLIC_WEB_ARCHETYPE_CATALOG: PublicWebArchetype[] = [
  { id: "dental-practice", name: "Dental Practice", keywords: ["dentist", "dental", "orthodont", "teeth whitening", "oral health", "cosmetic dentistry"] },
  { id: "optician", name: "Optician", keywords: ["optician", "optometry", "optometrist", "eyewear", "glasses", "contact lens", "vision care", "spectacles"] },
  { id: "physiotherapy-clinic", name: "Physiotherapy Clinic", keywords: ["physiotherapy", "physiotherapist", "physical therapy", "rehab clinic", "rehabilitation"] },
  { id: "gp-surgery", name: "GP Surgery", keywords: ["gp surgery", "general practice", "family doctor", "primary care", "medical centre"] },
  { id: "pharmacy", name: "Pharmacy", keywords: ["pharmacy", "chemist", "dispensary", "prescriptions", "over the counter"] },
  { id: "hair-salon", name: "Hair Salon", keywords: ["hair salon", "hairdresser", "haircut", "hairstylist", "blow dry", "colouring", "barbershop", "barber shop"] },
  { id: "beauty-salon", name: "Beauty Salon", keywords: ["beauty salon", "nail salon", "spa treatments", "facials", "waxing", "eyelash", "eyebrow threading", "beauty clinic"] },
  { id: "tattoo-studio", name: "Tattoo Studio", keywords: ["tattoo", "piercing studio", "body art", "ink studio"] },
  { id: "dry-cleaning-plant-network", name: "Dry Cleaning Plant & Store Network", keywords: ["dry cleaner", "dry cleaning", "laundry service", "laundromat", "wash and fold", "shirt laundry", "garment care", "alterations", "claim ticket", "pickup and delivery"], category: "fabric-care-services" },
  { id: "wash-and-fold-laundry", name: "Wash & Fold Laundry", keywords: ["wash and fold", "laundry pickup", "laundry delivery", "bag wash", "commercial laundry", "linen laundry"], category: "fabric-care-services" },
  { id: "alterations-tailoring", name: "Alterations & Tailoring", keywords: ["alterations", "tailoring", "hemming", "zip repair", "clothing repair", "garment repair"], category: "fabric-care-services" },
  { id: "mixed-farm-ranch", name: "Mixed Farm & Ranch", keywords: ["farm and ranch", "mixed farm", "cattle and hay", "pasture", "livestock", "working horses"], category: "agriculture-ranching" },
  { id: "crop-hay-farm", name: "Crop & Hay Farm", keywords: ["hay farm", "crop farm", "forage", "baling", "custom cutting", "field crops"], category: "agriculture-ranching" },
  { id: "cattle-ranch", name: "Cattle Ranch", keywords: ["cattle ranch", "cow calf", "beef cattle", "breeding stock", "grazing", "calving"], category: "agriculture-ranching" },
  { id: "fitness-gym", name: "Fitness Gym", keywords: ["gym", "fitness centre", "fitness center", "crossfit", "weightlifting", "personal training", "workout", "health club"] },
  { id: "yoga-pilates-studio", name: "Yoga / Pilates Studio", keywords: ["yoga", "pilates", "mindfulness", "meditation studio", "barre"] },
  { id: "restaurant", name: "Restaurant", keywords: ["restaurant", "bistro", "brasserie", "dining", "cuisine", "fine dining", "casual dining", "eatery"] },
  { id: "cafe-coffeeshop", name: "Café / Coffee Shop", keywords: ["cafe", "café", "coffee shop", "coffee house", "espresso bar", "bakery cafe", "brunch"] },
  { id: "bakery", name: "Bakery", keywords: ["bakery", "patisserie", "artisan bread", "pastries", "cake shop", "sourdough"] },
  { id: "bar-pub", name: "Bar / Pub", keywords: ["bar ", "pub ", "tavern", "cocktail bar", "wine bar", "brewery", "craft beer"] },
  { id: "fast-food", name: "Fast Food", keywords: ["fast food", "takeaway", "takeout", "burger joint", "fried chicken", "pizza delivery", "fish and chips"] },
  { id: "hotel", name: "Hotel", keywords: ["hotel", "boutique hotel", "inn", "lodge", "resort", "bed and breakfast", "accommodation", "rooms from"] },
  { id: "holiday-lettings", name: "Holiday Lettings", keywords: ["holiday let", "holiday rental", "vacation rental", "self catering", "airbnb", "serviced apartment"] },
  { id: "estate-agent", name: "Estate Agent", keywords: ["estate agent", "real estate", "property for sale", "property to let", "letting agent", "homes for sale"] },
  { id: "law-firm", name: "Law Firm", keywords: ["solicitor", "law firm", "legal services", "barrister", "attorney", "conveyancing", "legal advice"] },
  { id: "accountancy-firm", name: "Accountancy Firm", keywords: ["accountant", "accountancy", "chartered accountant", "bookkeeping", "tax advice", "tax return", "payroll services"] },
  { id: "financial-adviser", name: "Financial Adviser", keywords: ["financial adviser", "financial advisor", "independent financial", "ifa", "wealth management", "pensions", "investment advice"] },
  { id: "mortgage-broker", name: "Mortgage Broker", keywords: ["mortgage broker", "mortgage adviser", "home loans", "remortgage", "first time buyer"] },
  { id: "insurance-broker", name: "Insurance Broker", keywords: ["insurance broker", "insurance adviser", "life insurance", "business insurance", "car insurance", "home insurance quote"] },
  { id: "recruitment-agency", name: "Recruitment Agency", keywords: ["recruitment agency", "staffing agency", "executive search", "talent acquisition", "job placement", "headhunter"] },
  { id: "marketing-agency", name: "Marketing Agency", keywords: ["marketing agency", "digital marketing", "seo agency", "social media agency", "advertising agency", "brand agency"] },
  { id: "web-design-agency", name: "Web Design Agency", keywords: ["web design", "web development", "ux design", "app development", "software agency", "digital agency"] },
  { id: "it-managed-services", name: "IT Managed Services", keywords: ["it support", "managed it", "it services", "helpdesk", "network support", "cyber security", "it managed"] },
  { id: "consulting-firm", name: "Consulting Firm", keywords: ["consulting", "management consulting", "strategy consulting", "business consulting", "advisory services"] },
  { id: "architecture-firm", name: "Architecture Firm", keywords: ["architect", "architectural", "urban design", "interior architecture", "building design"] },
  { id: "interior-design", name: "Interior Design", keywords: ["interior design", "interior designer", "home staging", "space planning", "decor studio"] },
  { id: "photography-studio", name: "Photography Studio", keywords: ["photography", "photographer", "portrait studio", "wedding photographer", "commercial photography"] },
  { id: "events-venue", name: "Events Venue", keywords: ["events venue", "event space", "conference centre", "wedding venue", "function room", "banqueting"] },
  { id: "childcare-nursery", name: "Childcare / Nursery", keywords: ["nursery", "childcare", "day care", "pre-school", "preschool", "early years", "childminder"] },
  { id: "tutoring-centre", name: "Tutoring Centre", keywords: ["tutor", "tutoring", "private lessons", "learning centre", "exam prep", "gcse tutor", "a-level tutor"] },
  { id: "retail-fashion", name: "Retail — Fashion", keywords: ["clothing store", "fashion boutique", "menswear", "womenswear", "apparel", "streetwear", "online fashion"] },
  { id: "retail-homeware", name: "Retail — Homeware", keywords: ["homeware", "home furnishings", "furniture store", "kitchenware", "home decor shop"] },
  { id: "ecommerce-general", name: "E-commerce", keywords: ["shop now", "add to cart", "add to basket", "free delivery", "free shipping", "buy online", "online store", "online shop"] },
  { id: "nonprofit", name: "Non-Profit / Charity", keywords: ["charity", "nonprofit", "non-profit", "donation", "fundraising", "volunteer", "community interest"] },
  { id: "plumber", name: "Plumber", keywords: ["plumber", "plumbing", "pipe", "drain", "leak repair", "water heater", "boiler", "toilet", "bathroom fitting"], category: "trades-maintenance" },
  { id: "electrician", name: "Electrician", keywords: ["electrician", "electrical", "wiring", "fuse box", "circuit", "ev charging", "rewire", "lighting installation"], category: "trades-maintenance" },
  // BI-85A1E175: avoid plumber-owned boiler/water-heater terms so HVAC stays distinct.
  { id: "hvac-contractor", name: "HVAC Contractor", keywords: ["hvac", "heating and cooling", "air conditioning", "aircon", "furnace", "heat pump", "ac repair", "ac installation", "ventilation", "climate control"], category: "trades-maintenance" },
];
