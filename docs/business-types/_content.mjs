// ============================================================================
// Content model for the /business-types/ pages. Plain-language, audience-first.
// Grounded in packages/storefront-templates/src/archetypes/* and
// docs/architecture/archetype-business-value-streams.md. The word "archetype"
// is intentionally kept out of this user-facing copy (it lives only in the
// "for builders & resellers" technical material).
//
// Files in this directory that start with "_" are ignored by Jekyll, so this
// data + the generator never ship to the public site — only the emitted HTML.
//
// To regenerate the pages after editing this file: pnpm docs:business-types
// ============================================================================

// How a business works — the audience-first grouping that replaces the
// alphabetical "industry" dump. Order here is the order on the hub + index.
export const groups = [
  {
    id: "field",
    title: "You go to the customer",
    tag: "Field & dispatch",
    blurb:
      "A technician, crew, or officer travels to the customer’s property or vehicle. The work lives on a dispatch board and finishes on-site — so routing, job context, and field invoicing are what make or break the day.",
  },
  {
    id: "book",
    title: "Customers come to you",
    tag: "Appointments & booking",
    blurb:
      "People book time with a named person or place. The calendar is the product: real per-provider availability, the right records on hand, and a nudge to come back.",
  },
  {
    id: "sell",
    title: "You sell goods",
    tag: "Catalogue & orders",
    blurb:
      "Browse → cart → checkout → fulfil. The moment of commitment can’t drop a product image, a price, or a delivery detail, and repeat buyers should be recognised.",
  },
  {
    id: "members",
    title: "You serve members & community",
    tag: "Members, residents & regulated",
    blurb:
      "Donors, members, residents, ratepayers, borrowers. A trust gate — eligibility, disclosures, the duty to serve everyone — comes before the value stream, and money is recognised as a receipt or a statutory fee, not a hard sell.",
  },
  {
    id: "build",
    title: "You rent, build & advise",
    tag: "Projects, rentals & engagements",
    blurb:
      "Quotes, proposals, agreements, rental periods, milestones. Value is delivered over time under a scope or an agreement, with the customer’s estate kept clean and isolated.",
  },
];

// Each page. stages[] is the operational value stream (S1 Attract → S6 Retain
// in business language); the entry flagged `key:true` is the load-bearing stage
// for that commercial model (per archetype-business-value-streams.md §3).
export const pages = [
  // ----------------------------------------------------------------- FIELD ---
  {
    slug: "trades-and-home-services",
    group: "field",
    display: "Trades & home services",
    who:
      "Plumbers, electricians, HVAC and roofing contractors, landscapers, pest control, pool and cleaning firms — anyone who sends a technician to the customer’s property.",
    leaf: ["Plumber", "Electrician", "HVAC contractor", "Roofing & gutters", "Landscaping & grounds", "Pest control", "Appliance repair", "Pool & spa service", "Pressure washing", "Cleaning service", "Facilities maintenance"],
    model:
      "Money is made per job (emergency, routine, planned) or on recurring maintenance plans. The whole business hangs on getting the right person to the right address with the right context.",
    stages: [
      { label: "Inquiry comes in" },
      { label: "Triage urgency & property" },
      { label: "Route & dispatch the tech", key: true },
      { label: "Complete on-site" },
      { label: "Invoice" },
      { label: "Maintain the relationship" },
    ],
    problems: [
      { lead: "Emergencies get lost in the inbox.", rest: "Urgency is captured at the point of inquiry and queued for dispatch correctly, not buried under routine quotes." },
      { lead: "Techs arrive without context.", rest: "Property type, equipment, and prior service history travel with the booking so the first visit is the fix." },
      { lead: "Recurring plans are invisible.", rest: "Pool, HVAC, and pest contracts surface the next service automatically instead of relying on memory." },
      { lead: "The inbox-to-dispatch handoff is manual.", rest: "Your coworker routes and assigns the job in one view." },
    ],
    caps: [
      { lead: "A website that speaks trades", rest: "— jobs, call-outs, technicians, quotes — not “appointments”.", surface: "Website & enquiries" },
      { lead: "Urgency-aware enquiries", rest: "capture job type, property, and access details so you can quote and triage.", surface: "Website & enquiries" },
      { lead: "A dispatch board", rest: "so the crew knows who / what / where and customers get an ETA.", surface: "Work board" },
      { lead: "Job & property history", rest: "every technician sees the site, the kit, and past visits before they arrive.", surface: "Customer records" },
      { lead: "Maintenance-plan tracking", rest: "with renewal reminders so repeat work doesn’t slip.", surface: "Reminders & renewals" },
      { lead: "Field-ready invoicing", rest: "tied to the job, with job-linked costs.", surface: "Invoicing & finance" },
    ],
    compliance:
      "Licensed trades surface their gates — electrical (EICR/NICEIC), gas, HVAC refrigerant handling (EPA 608), roofing fall-protection. The coworker flags readiness; it never improvises safety or code advice.",
    mobile: true,
  },
  {
    slug: "automotive-services",
    group: "field",
    display: "Automotive services",
    who:
      "Mobile auto-glass, mobile mechanics, detailers, mobile tyre fitters, roadside assistance and towing, and locksmiths who travel to the customer’s vehicle.",
    leaf: ["Windshield & auto glass", "Mobile mechanic", "Mobile detailing", "Mobile tyre service", "Roadside assistance & towing", "Locksmith (auto & residential)"],
    model:
      "Scheduled mobile service (glass, mechanic, detailing, tyre) is booked and paid at completion; roadside and lockout work is real-time emergency dispatch with no pre-booking.",
    stages: [
      { label: "Inquiry / emergency call" },
      { label: "Quote (VIN → parts)" },
      { label: "Schedule or dispatch now", key: true },
      { label: "Service at the vehicle" },
      { label: "Settle payment" },
      { label: "Record & follow-up" },
    ],
    problems: [
      { lead: "Glass quotes need VIN-to-part matching.", rest: "The VIN is captured up front so parts resolution and pricing aren’t a guessing game on the phone." },
      { lead: "Mechanics dispatch blind.", rest: "Vehicle year/make/model and the symptom ride along with the job." },
      { lead: "Roadside isn’t an “appointment”.", rest: "A real-time, transactional dispatch mode handles lockouts and tows without forcing them into a booking calendar." },
      { lead: "Post-install compliance goes undocumented.", rest: "Auto-glass ADAS recalibration is tracked as a step, not an afterthought." },
    ],
    caps: [
      { lead: "VIN & vehicle-context intake", rest: "feeds parts resolution and an accurate quote." },
      { lead: "Two dispatch modes", rest: "— scheduled mobile service and real-time emergency response." },
      { lead: "On-site settlement", rest: "pay-at-completion for scheduled work, instant capture for emergencies." },
      { lead: "Compliance overlays", rest: "ADAS calibration for glass, DOT hours for towing, bonding for locksmiths." },
      { lead: "Vehicle records", rest: "so the next service or callback has the history." },
    ],
    compliance:
      "ADAS certification after glass installs, DOT hours-of-service for towing, and locksmith bonding/licensing surface as capability-layer checks.",
    mobile: true,
  },
  {
    slug: "moving-and-logistics",
    group: "field",
    display: "Moving & logistics",
    who:
      "Moving companies, junk removal and hauling, couriers, and last-mile freight operators who send a crew and a truck to load, haul, and deliver.",
    leaf: ["Moving company", "Junk removal & hauling", "Courier & delivery", "Last-mile freight"],
    model:
      "Household moves and hauls are quoted per job; B2B courier and freight run as recurring routes on an account with consolidated billing.",
    stages: [
      { label: "Inquiry" },
      { label: "Estimate" },
      { label: "Schedule pickup / route", key: true },
      { label: "Load & haul" },
      { label: "Deliver & inspect" },
      { label: "Invoice / account" },
    ],
    problems: [
      { lead: "Move details arrive on a phone call.", rest: "Origin, destination, home size, and date are captured up front so the estimate is real." },
      { lead: "Recurring routes get re-quoted every time.", rest: "B2B accounts tie repeat pickups to one customer with consolidated monthly billing." },
      { lead: "What got hauled isn’t documented.", rest: "Loading, condition, and disposal notes are captured against the job." },
      { lead: "Driver-hours rules are easy to break.", rest: "A DOT hours-of-service overlay tracks the limits." },
    ],
    caps: [
      { lead: "Job intake", rest: "for origin, destination, home size, and preferred date." },
      { lead: "Crew + truck dispatch", rest: "with route scheduling on the board." },
      { lead: "Account-based billing", rest: "for recurring B2B routes; per-job billing for households." },
      { lead: "Condition & disposal notes", rest: "captured on the move for disputes and manifests." },
      { lead: "Compliance overlays", rest: "DOT hours-of-service and chain-of-custody for medical/legal courier." },
    ],
    compliance:
      "DOT hours-of-service, chain-of-custody for medical and legal courier work, and hazardous-disposal handling for junk removal sit at the capability layer.",
    mobile: true,
  },
  {
    slug: "security-services",
    group: "field",
    display: "Security services",
    who:
      "Manned guarding and patrol companies, event security, and alarm/CCTV installers who run recurring monitoring contracts.",
    leaf: ["Security guard & patrol", "Alarm & CCTV installation & monitoring"],
    model:
      "Guarding runs as a recurring B2B agreement across client sites; alarm work is a one-time install plus a recurring monitoring plan.",
    stages: [
      { label: "Proposal" },
      { label: "Contract & onboarding" },
      { label: "Assign officers / install", key: true },
      { label: "Patrol / monitor" },
      { label: "Incident response" },
      { label: "Renew contract" },
    ],
    problems: [
      { lead: "Each client site has different terms.", rest: "Strict per-client isolation keeps assignments, sites, and contracts cleanly separated." },
      { lead: "Patrols and incidents are ad-hoc.", rest: "A real-time dispatch view covers post assignments, patrol routes, and incident response." },
      { lead: "Install and monitoring drift apart.", rest: "Service agreements tie the install to the monitoring plan, and renewals surface on time." },
      { lead: "Officer licensing isn’t verified.", rest: "PSO licensing and low-voltage certs are tracked up front and over time." },
    ],
    caps: [
      { lead: "Multi-client site tracking", rest: "with per-site assignments and patrol routes." },
      { lead: "Real-time dispatch", rest: "for posts, patrols, and incident response." },
      { lead: "Install-to-renewal agreements", rest: "linking equipment to the monitoring plan." },
      { lead: "Per-client recurring billing", rest: "on each contract." },
      { lead: "Licensing overlays", rest: "PSO and low-voltage installer checks." },
    ],
    compliance:
      "Private-security-officer (PSO) licensing, low-voltage installer licensing, and documented incident response are tracked; marketing stays credible, never fear-based.",
    mobile: true,
  },

  // ------------------------------------------------------------------ BOOK ---
  {
    slug: "clinics-and-wellness",
    group: "book",
    display: "Clinics & wellness",
    who:
      "Veterinary, dental, physiotherapy, counselling and optician practices, plus home-health, mobile phlebotomy, and medical-equipment delivery providing episodes of care.",
    leaf: ["Veterinary clinic", "Dental practice", "Physiotherapy", "Counselling / therapy", "Optician", "Home health & in-home care", "Mobile phlebotomy", "Medical equipment delivery"],
    model:
      "An episode of care is booked, delivered against the patient or pet record, and billed per encounter. The record on hand is what keeps care safe.",
    stages: [
      { label: "Inquiry" },
      { label: "Book the appointment" },
      { label: "Capture patient / pet context" },
      { label: "Deliver care, informed by the record", key: true },
      { label: "Invoice per encounter" },
      { label: "Recall / reorder" },
    ],
    problems: [
      { lead: "Appointments land without the record.", rest: "Species, age, history, and reason-for-visit are captured at intake so the clinician is never blind." },
      { lead: "Follow-ups get forgotten.", rest: "Recall signals surface “annual check-up due” in the coworker’s inbox." },
      { lead: "Mobile and home visits dispatch without context.", rest: "Address and patient details travel with the job." },
      { lead: "Billing to patient vs. payer is messy.", rest: "The invoice ties cleanly to the patient record." },
    ],
    caps: [
      { lead: "A patient / pet record", rest: "for breed, DOB, history, and the current reason for visit." },
      { lead: "Care-aware scheduling", rest: "with assessment-vs-follow-up slot lengths." },
      { lead: "Encounter-based invoicing", rest: "against the record." },
      { lead: "Clinical vocabulary", rest: "— patients, owners, appointments — built into the coworker." },
      { lead: "Recall lifecycle signals", rest: "for vaccinations, check-ups, and reorders." },
    ],
    compliance:
      "This is the most safety-critical consumer setting. The coworker stays in scheduling and operations — it never diagnoses, triages, or handles a clinical or mental-health crisis (counselling crises route to emergency services). HIPAA applies to home health and phlebotomy.",
    mobile: true,
  },
  {
    slug: "beauty-and-personal-care",
    group: "book",
    display: "Beauty & personal care",
    who:
      "Hair and barber shops, nail salons, spas, and personal trainers — plus mobile glam and bridal stylists who travel to the client.",
    leaf: ["Hair salon", "Barber shop", "Nail salon", "Beauty spa", "Personal trainer", "Mobile beauty & glam"],
    model:
      "Book a slot with a named practitioner, deliver the service, and take payment at the time. No running account — the calendar is the whole product.",
    stages: [
      { label: "Attract" },
      { label: "Capture the booking" },
      { label: "Assign practitioner & slot", key: true },
      { label: "Perform the service" },
      { label: "Settle at the time" },
      { label: "Rebook & retain" },
    ],
    problems: [
      { lead: "Clients can’t see who’s free, when.", rest: "Booking shows that practitioner’s real schedule, not a generic one." },
      { lead: "Double-bookings and no-shows kill throughput.", rest: "Per-person calendars and buffers protect the day’s income." },
      { lead: "“I always see Sarah” gets lost.", rest: "The booking captures the preference and routes accordingly." },
      { lead: "Mobile glam has no standard tool.", rest: "Multi-hour appointments and travel buffers are handled across the week." },
    ],
    caps: [
      { lead: "Provider-choice booking", rest: "— clients see a specific person’s open slots and self-reschedule." },
      { lead: "Per-practitioner calendars", rest: "with individual hours, buffers, and no-show tracking." },
      { lead: "Accurate durations", rest: "for 30/45/60/90-minute services." },
      { lead: "Salon vocabulary", rest: "— clients, appointments, stylists — never “patients”." },
      { lead: "Retention nudges", rest: "flag high-value repeat clients for rebooking." },
    ],
    compliance: null,
    mobile: true,
  },
  {
    slug: "pet-services",
    group: "book",
    display: "Pet services",
    who:
      "Groomers, dog walkers, and boarding facilities — plus mobile groomers and mobile vets who work with a named pet.",
    leaf: ["Pet grooming", "Dog walking", "Pet boarding", "Mobile grooming", "Mobile veterinary service"],
    model:
      "Slot-based grooming, multi-night boarding, and recurring walks — all anchored to the pet’s record so service arrives prepared.",
    stages: [
      { label: "Inquiry" },
      { label: "Capture pet context", key: true },
      { label: "Book slot / dates / recurring" },
      { label: "Deliver the service" },
      { label: "Settle" },
      { label: "Notes & recalls" },
    ],
    problems: [
      { lead: "Groomers don’t know the dog until it arrives.", rest: "Size, coat, and temperament are captured so they arrive prepped." },
      { lead: "Boarding can’t block date ranges cleanly.", rest: "A date-range picker reserves the kennel Fri–Mon without conflicts." },
      { lead: "Walk frequency is invisible.", rest: "Daily or 3×/week schedules surface the next walk automatically." },
      { lead: "Medical alerts go missing.", rest: "Allergies and medication ride along on the pet record." },
    ],
    caps: [
      { lead: "A pet record", rest: "for name, size, breed, temperament, alerts, and vaccination status." },
      { lead: "Three booking shapes", rest: "— slots (grooming), date ranges (boarding), recurring (walking)." },
      { lead: "Size-based pricing", rest: "rendered from the catalogue." },
      { lead: "Recall signals", rest: "— “Fluffy is due for a nail trim.”" },
      { lead: "Travel buffers", rest: "for mobile grooming and house-call vets." },
    ],
    compliance:
      "Vaccination-status checks at grooming intake and rabies/controlled-substance handling for mobile vets sit at the capability layer.",
    mobile: true,
  },
  {
    slug: "fitness-and-recreation",
    group: "book",
    display: "Fitness & recreation",
    who:
      "Gyms, yoga and dance studios, and sports clubs selling recurring memberships and class access.",
    leaf: ["Gym", "Yoga studio", "Dance studio", "Sports club"],
    model:
      "Members join and pay a recurring membership for access to facilities and classes. The renewal — not the first sale — is the business.",
    stages: [
      { label: "Marketing" },
      { label: "Join / sign up" },
      { label: "Set up payment" },
      { label: "Access classes & facilities" },
      { label: "Renew", key: true },
      { label: "Retain & upsell" },
    ],
    problems: [
      { lead: "The coworker treats it like a one-off sale.", rest: "Subscriptions and renewals are first-class — never a one-time “appointment”." },
      { lead: "Class schedules are hard to model.", rest: "Recurring class patterns (Mon 6pm Hatha, Wed 6pm Vinyasa) slot in cleanly." },
      { lead: "Tiers disappear in the chaos.", rest: "Gold/Silver/Basic render with recurring-price language up front." },
      { lead: "Liability data isn’t collected.", rest: "Age and emergency contact are captured at signup." },
    ],
    caps: [
      { lead: "Recurring billing", rest: "with auto-renewal lifecycle signals." },
      { lead: "Class-pattern scheduling", rest: "for repeating cohorts, not per-session bookings." },
      { lead: "Membership tiers", rest: "with recurring-price language, plus drop-in day passes." },
      { lead: "Member vocabulary", rest: "— members, students, subscriptions." },
      { lead: "Liability intake", rest: "for age and emergency contact." },
    ],
    compliance: null,
    mobile: false,
  },
  {
    slug: "education-and-training",
    group: "book",
    display: "Education & training",
    who:
      "Tutors, music and driving schools, dance studios, and corporate training providers delivering 1:1 or cohort instruction.",
    leaf: ["Tutoring", "Music school", "Driving school", "Dance studio", "Corporate training"],
    model:
      "One-to-one lessons are slot-based and instructor-assigned; corporate training runs inquiry → proposal → program enrolment.",
    stages: [
      { label: "Marketing" },
      { label: "Inquiry / enrol", key: true },
      { label: "Assign instructor & schedule" },
      { label: "Deliver lessons / cohorts" },
      { label: "Track progress" },
      { label: "Renew & upsell" },
    ],
    problems: [
      { lead: "Learner and payer are different people.", rest: "A parent books; the child attends. Both are captured so the instructor knows who’s who." },
      { lead: "Term packages are invisible.", rest: "Lifecycle signals flag “package depleted” and “term ends”." },
      { lead: "Driving lessons need instructor & vehicle.", rest: "The booking captures both." },
      { lead: "Corporate follow-up is forgotten.", rest: "The B2B inquiry-to-proposal flow stores context for the next program." },
    ],
    caps: [
      { lead: "Learner-vs-payer intake", rest: "for parents, students, employees, and participants." },
      { lead: "Instructor & location assignment", rest: "with term-based and drop-in patterns." },
      { lead: "Accurate durations", rest: "for 30-minute piano, 60-minute driving, 90-minute workshops." },
      { lead: "B2B training framing", rest: "— delegates, programs, L&D outcomes." },
      { lead: "Package & term lifecycle", rest: "signalling renewal." },
    ],
    compliance:
      "Safeguarding for minors (parent/guardian consent capture) and instructor qualifications are handled at the capability layer.",
    mobile: false,
  },

  // ------------------------------------------------------------------ SELL ---
  {
    slug: "retail-and-goods",
    group: "sell",
    display: "Retail & goods",
    who:
      "Retail shops, artisan makers, florists, and wholesale distributors selling physical goods.",
    leaf: ["Retail shop", "Artisan goods", "Florist", "Wholesale & distribution"],
    model:
      "Browse the catalogue, add to cart, check out, get an order reference. Wholesale runs as a B2B trade-pricing inquiry. Repeat buyers should be recognised, not treated as one-time.",
    stages: [
      { label: "Attract via gallery" },
      { label: "Product detail & add to cart" },
      { label: "Checkout & order ref", key: true },
      { label: "Delivery logistics" },
      { label: "Invoice" },
      { label: "Repeat customer" },
    ],
    problems: [
      { lead: "Broken or missing product images lose the sale.", rest: "Required gallery slots catch missing images before a customer bounces." },
      { lead: "Custom commissions get lost in checkout.", rest: "An inquiry sub-flow lets made-to-order and buy-now coexist in one storefront." },
      { lead: "Florists need a delivery date, not just billing.", rest: "The order captures the recipient address and delivery date for perishables." },
      { lead: "Wholesale buyers can’t see trade pricing.", rest: "A separate “request trade pricing” path serves B2B accounts." },
    ],
    caps: [
      { lead: "A product catalogue", rest: "with required hero gallery and per-product images." },
      { lead: "Cart → order reference", rest: "with customer-account linkage for repeat buyers." },
      { lead: "Mixed calls-to-action", rest: "— Shop Now, Request a quote, Request trade pricing." },
      { lead: "Delivery logistics", rest: "for date, address, and perishable notes." },
      { lead: "Shop vocabulary", rest: "— shop, order, products — not “book”." },
    ],
    compliance: null,
    mobile: false,
  },
  {
    slug: "food-and-hospitality",
    group: "sell",
    display: "Food & hospitality",
    who:
      "Restaurants taking reservations, caterers quoting events, and bakeries selling fresh goods with custom-order sub-flows.",
    leaf: ["Restaurant", "Catering", "Bakery"],
    model:
      "Restaurants book tables; caterers quote events and invoice after delivery; bakeries take orders and custom-cake commissions. Three shapes, one storefront engine.",
    stages: [
      { label: "Discover / browse" },
      { label: "Reserve / quote / order", key: true },
      { label: "Confirm & prep" },
      { label: "Serve / deliver" },
      { label: "Settle" },
      { label: "Return guest" },
    ],
    problems: [
      { lead: "Tables get double-booked.", rest: "Table × duration is blocked so reservations don’t collide." },
      { lead: "Dietary needs land as free text and vanish.", rest: "Allergens and dietary requirements are captured up front for the kitchen." },
      { lead: "Catering quote → invoice is disconnected.", rest: "An inquiry-to-quote flow keeps the event together from proposal to invoice." },
      { lead: "Bakeries can’t mix shop + custom cake.", rest: "A custom-order sub-flow routes commissions to the baker inside the order." },
    ],
    caps: [
      { lead: "Table reservations", rest: "with party size, time, and duration — no overlaps." },
      { lead: "Event catering flow", rest: "from inquiry to quote to post-event invoice." },
      { lead: "Bakery storefront", rest: "with cart checkout plus a custom-cake inquiry sub-flow." },
      { lead: "Allergen capture", rest: "as a duty-of-care field." },
      { lead: "Per-shape billing", rest: "— per visit, post-event, per order." },
    ],
    compliance:
      "Allergen and dietary disclosure is treated as a duty of care; food-handling compliance sits at the capability layer.",
    mobile: false,
  },

  // --------------------------------------------------------------- MEMBERS ---
  {
    slug: "nonprofits-and-community",
    group: "members",
    display: "Nonprofits & community",
    who:
      "Charities, pet rescues and shelters, food banks, sports clubs, member-owned co-ops, and meal programs that serve a cause.",
    leaf: ["Charity", "Pet rescue", "Animal shelter", "Community shelter", "Sports club", "Member-owned cooperative", "Agricultural co-op (shared machinery)", "Meal-delivery program"],
    model:
      "Money comes from gifts, dues, or member-owned shares. A gift gets a receipt, not a bill — and there is no account behind it.",
    stages: [
      { label: "Bring in supporters" },
      { label: "Give or join", key: true },
      { label: "Send a receipt (not a bill)" },
      { label: "Show the impact" },
      { label: "Renew / share back" },
    ],
    problems: [
      { lead: "Gift forms wrongly make a bill.", rest: "DPF sends a receipt and skips the account — your coworker knows there is no customer here." },
      { lead: "Co-ops can’t track member shares.", rest: "Member-owned tools split the profit back to members fairly." },
      { lead: "Shared gear is first-come, first-served.", rest: "Members book it, use it, and bring it back — with fair turns for all." },
      { lead: "Rescues have no list of pets to adopt.", rest: "A photo page shows which pets are ready for a home." },
    ],
    caps: [
      { lead: "Take gifts", rest: "— one-off, monthly, or private — with a receipt every time, never a bill." },
      { lead: "Member-owned tools", rest: "to track who can join, what they own, and how profit is shared." },
      { lead: "Shared-gear booking", rest: "for co-op machines, with fair turns for members." },
      { lead: "Volunteer route planning", rest: "for meal-delivery rounds." },
      { lead: "The right words", rest: "— supporters, donors, members — never “customers” or “bills”." },
    ],
    compliance:
      "501(c)(3) framing, gift-aid / tax-relief language, and cooperative member-democratic governance (patronage allocation) are built in.",
    mobile: false,
  },
  {
    slug: "hoa-and-property-management",
    group: "members",
    display: "HOA & property management",
    who:
      "Homeowner and condo associations, and the firms that manage homes and rentals for a community.",
    leaf: ["Homeowners association", "Condominium association", "Property management company"],
    model:
      "Dues and fees pay for the HOA; a manager earns a fee to run things. Residents come to pay dues, report a repair, ask to change their home’s look, or book a shared space.",
    stages: [
      { label: "Tell residents" },
      { label: "Pay dues / send a request", key: true },
      { label: "Send to the right person" },
      { label: "Do it or approve it" },
      { label: "Book a shared space" },
      { label: "Send the bill or notice" },
    ],
    problems: [
      { lead: "Residents don’t know what they can do.", rest: "One page shows dues, repairs, change requests, and booking the clubhouse." },
      { lead: "Requests come in with no address.", rest: "The unit or lot is captured before the request moves." },
      { lead: "Without a coworker it’s chaos.", rest: "Each request goes to the right place — repairs, change requests, or bookings." },
      { lead: "Bookings clash.", rest: "Date ranges keep the clubhouse and pool from being double-booked." },
    ],
    caps: [
      { lead: "One resident page", rest: "— dues, repairs, change requests, bookings, rule breaks." },
      { lead: "Know the home", rest: "by capturing the unit or lot up front." },
      { lead: "Book shared spaces", rest: "with date ranges so nothing double-books." },
      { lead: "Owners and renters", rest: "each get the right path when a firm manages the homes." },
      { lead: "The right words", rest: "— residents, homeowners, owners — never “customers”." },
    ],
    compliance:
      "Covenants, reserve disclosures, and state HOA law are supported; property management adds landlord-tenant law and security-deposit accounting.",
    mobile: false,
  },
  {
    slug: "public-sector-and-civic",
    group: "members",
    display: "Public sector & civic",
    who:
      "Small towns and municipalities, municipal utilities (water, sewer, electric, gas), and law-enforcement agencies serving residents.",
    leaf: ["Small town / municipality", "Municipal utility", "Law-enforcement agency"],
    model:
      "Funded by statutory fees and levies set by ordinance, not by market price — with a universal-service obligation to serve every resident.",
    stages: [
      { label: "Publish services" },
      { label: "Resident request" },
      { label: "Process & route", key: true },
      { label: "Deliver service / permit" },
      { label: "Issue fee notice" },
      { label: "Archive" },
    ],
    problems: [
      { lead: "Residents don’t know what’s available.", rest: "Report an issue, apply for a permit, request records, reserve a pavilion, pay a bill — all surfaced clearly." },
      { lead: "311 requests reach the wrong desk.", rest: "Potholes and streetlights route to Public Works, Parks, and the rest automatically." },
      { lead: "Utility start/stop lacks meter context.", rest: "Address and meter are captured; billing is statutory, not market-based." },
      { lead: "Law-enforcement data is sensitive.", rest: "In Phase 1 the coworker firmly declines criminal-justice-information lookups and routes to intake only." },
    ],
    caps: [
      { lead: "A mixed-CTA civic portal", rest: "— 311 reports, permits, records (FOIA), facility booking, bill pay." },
      { lead: "Department routing", rest: "to Public Works, Clerk, Code Enforcement, utility, and more." },
      { lead: "Statutory-fee framing", rest: "set by ordinance, not negotiated." },
      { lead: "Resident vocabulary", rest: "— residents, ratepayers, constituents — never “customer”." },
      { lead: "Guardrailed law-enforcement intake", rest: "with a no-CJI refusal posture in Phase 1." },
    ],
    compliance:
      "Highest regulatory load: SDWA/NPDES for utilities, POST/CJIS for law enforcement (no-CJI in Phase 1), FOIA/public-records law, building codes, zoning, and ordinances.",
    mobile: false,
  },
  {
    slug: "banking-and-credit-unions",
    group: "members",
    display: "Banking & credit unions",
    who:
      "Community banks, credit unions, and mortgage lenders offering deposits, lending, and account services.",
    leaf: ["Community bank", "Credit union", "Mortgage lending"],
    model:
      "Account-based fees behind a KYC gate. DPF is the engagement layer — it records applications and obligations and never moves money; core banking stays with the institution.",
    stages: [
      { label: "Marketing" },
      { label: "Apply / KYC", key: true },
      { label: "Underwrite & qualify" },
      { label: "Open the account" },
      { label: "Service & statements" },
      { label: "Retain & cross-sell" },
    ],
    problems: [
      { lead: "Disclosures must come before the CTA.", rest: "FDIC, NCUA, and NMLS/RESPA/TILA disclosures gate the inquiry." },
      { lead: "Credit unions are member-owned.", rest: "A membership-eligibility check and member-owner vocabulary replace “customer”." },
      { lead: "Loan inquiries lack scenario context.", rest: "Purchase, refinance, or HELOC is captured up front." },
      { lead: "Rate quotes are buried.", rest: "An interactive calculator fed by the form estimates the monthly payment." },
    ],
    caps: [
      { lead: "Mandatory disclosures", rest: "before any inquiry can proceed." },
      { lead: "A loan / rate calculator", rest: "with APR and rate disclaimers." },
      { lead: "KYC-gated provisioning", rest: "— DPF records applications at the engagement layer only." },
      { lead: "Prepared-not-prescribed billing", rest: "— fee obligations recorded, money never moved." },
      { lead: "BIAN-grounded vocabulary", rest: "— borrowers, members, accounts, loans." },
    ],
    compliance:
      "The strictest profile: FDIC (banks), NCUA (credit unions), and NMLS/RESPA/TILA (mortgage). KYC/AML gates intake and rate/fee disclaimers are mandatory.",
    mobile: false,
  },

  // ----------------------------------------------------------------- BUILD ---
  {
    slug: "equipment-and-storage-rental",
    group: "build",
    display: "Equipment & storage rental",
    who:
      "Equipment and tool-hire shops and self-storage facilities renting out a pooled inventory.",
    leaf: ["Equipment & tool rental", "Self-storage facility"],
    model:
      "Reserve a unit, hand it out, the customer uses it, then return → inspect → re-pool. Billing is usage-based — by the day for equipment, by the month for storage.",
    stages: [
      { label: "Browse catalogue" },
      { label: "Reserve dates / unit" },
      { label: "Handoff & deposit" },
      { label: "Use", key: true },
      { label: "Return & inspect" },
      { label: "Re-pool & invoice" },
    ],
    problems: [
      { lead: "The same unit gets double-booked.", rest: "Per-unit date-range reservations block the excavator Sat–Mon." },
      { lead: "Tenants can’t see what’s free.", rest: "Available unit sizes show with a move-in date and a full-capacity flag." },
      { lead: "Return disputes have no record.", rest: "Condition notes on return document the handover." },
      { lead: "Monthly renewals churn silently.", rest: "Lifecycle signals surface “lease renewal due.”" },
    ],
    caps: [
      { lead: "A rental-fleet pool", rest: "with per-unit, date-range reservations." },
      { lead: "Rental agreements", rest: "for deposits, damage liability, and recurring billing." },
      { lead: "Usage-based billing", rest: "— per day for equipment, per month for storage." },
      { lead: "Return inspection", rest: "captured as service-operations notes." },
      { lead: "Right vocabulary", rest: "— renters for equipment, tenants for storage." },
    ],
    compliance:
      "Damage waivers and deposit law (which varies by state) are supported at the capability layer.",
    mobile: false,
  },
  {
    slug: "home-building-and-construction",
    group: "build",
    display: "Home building & construction",
    who:
      "New-home builders with display communities and custom (build-on-your-lot) builders running design-to-handover projects.",
    leaf: ["New home builder", "Custom home builder"],
    model:
      "A model-home tour or design consultation opens an inquiry → quote → contract → milestone-billed project → handover and warranty.",
    stages: [
      { label: "Market the community" },
      { label: "Tour / design consult" },
      { label: "Inquiry & quote", key: true },
      { label: "Permit" },
      { label: "Build & inspect" },
      { label: "Handover & warranty" },
    ],
    problems: [
      { lead: "Inquiries don’t qualify the buyer.", rest: "Bedroom count, budget, buying status, and timeline are captured so the quote is educated." },
      { lead: "There’s no clean way to book a design consult.", rest: "A consultation booking item slots a 60-minute, business-hours meeting." },
      { lead: "Design selections are lost.", rest: "The projects module ties selections to the customer record." },
      { lead: "Model-home photos are the storefront.", rest: "Required facility galleries keep the hero and model sections alive." },
    ],
    caps: [
      { lead: "Model-home tour booking", rest: "on a 7-day, weekend-inclusive schedule." },
      { lead: "Design-consultation booking", rest: "with longer buffers for site briefing." },
      { lead: "Buyer-qualifying intake", rest: "for bedrooms, budget, status, and timeline." },
      { lead: "A projects module", rest: "for design → permit → build → inspect → handover." },
      { lead: "Buyer vocabulary", rest: "— buyers, communities, builds." },
    ],
    compliance:
      "Building codes, permits, and inspections (jurisdiction-specific), HOA design controls, and warranty obligations are part of the flow.",
    mobile: false,
  },
  {
    slug: "professional-services",
    group: "build",
    display: "Professional services",
    who:
      "Consultants, law and accounting firms, marketing agencies, IT support firms, inspectors and surveyors, and mobile notaries who sell their know-how.",
    leaf: ["Consulting", "Legal services", "Accounting & bookkeeping", "Marketing agency", "IT managed services", "Field inspection", "Land surveying", "Process serving & mobile notary"],
    model:
      "A job starts with a question, then a call, a quote, and the work — billed by the hour or by stage. IT firms run monthly contracts and keep each client apart.",
    stages: [
      { label: "Question comes in" },
      { label: "First call" },
      { label: "Quote & scope", key: true },
      { label: "Do the work" },
      { label: "Deliver & report" },
      { label: "Keep them for next time" },
    ],
    problems: [
      { lead: "The question and the quote drift apart.", rest: "DPF links the first question to the quote, so nothing is lost." },
      { lead: "The words are wrong.", rest: "Clients, jobs, and work handed over — not “customers”." },
      { lead: "IT firms can’t keep clients apart.", rest: "Each client’s files and tickets stay walled off from the rest." },
      { lead: "Field staff show up cold.", rest: "Inspectors and surveyors bring the address and past notes with them." },
    ],
    caps: [
      { lead: "Question to quote", rest: "with line items and a rough timeline." },
      { lead: "Bill by stage or month", rest: "plus contracts for ongoing work." },
      { lead: "Keep each client apart", rest: "with their own file list and billing." },
      { lead: "Send staff to site", rest: "for inspections, surveys, and notary visits." },
      { lead: "The right words", rest: "— clients, jobs, contracts." },
    ],
    compliance:
      "Regulated professions are guarded: the coworker won’t give legal or financial advice and points to a qualified solicitor or accountant. Licensing for inspectors/surveyors and HIPAA/GDPR isolation for MSP client data apply.",
    mobile: true,
  },
  {
    slug: "software-and-platforms",
    group: "build",
    display: "Software & platforms",
    who:
      "Software products and platforms — including the Open Digital Product Factory itself, running its own operations as a worked example.",
    leaf: ["Open Digital Product Factory (and software products like it)"],
    model:
      "Inquiry → demo / pilot / partnership → proposal → engagement → live install and ongoing support. The platform powering its own go-to-market is the proof.",
    stages: [
      { label: "Marketing" },
      { label: "Inquiry / contact" },
      { label: "Send to product backlog", key: true },
      { label: "Engagement" },
      { label: "Live install" },
      { label: "Support & co-sell" },
    ],
    problems: [
      { lead: "Prospects look like customers.", rest: "Vocabulary distinguishes users, developers, and enterprise prospects from end-customers." },
      { lead: "Inquiry → backlog is manual.", rest: "A “send to product backlog” action turns a lead into a tracked item on the product." },
      { lead: "Pilots and partnerships are invisible.", rest: "Service agreements track pilot terms, feature requests, and co-sell outcomes." },
      { lead: "Platform-speak leaks to customers.", rest: "Internal product language stays separate from customer-facing copy." },
    ],
    caps: [
      { lead: "Prospect intake", rest: "for company size, team, and current operating-model pain." },
      { lead: "Inquiry-to-backlog", rest: "creating a tracked item on the product itself." },
      { lead: "Pilot & partnership tracking", rest: "via service agreements." },
      { lead: "Portfolio decomposition", rest: "across platform, build, and coworker offerings." },
      { lead: "Two vocabularies", rest: "— product language internally, plain business language for customers." },
    ],
    compliance:
      "Data-privacy obligations (GDPR, CCPA) apply where the platform integrates with customer data; the engagement layer itself carries no special regime.",
    mobile: false,
  },
];

// ---- how the coworker decides, per business type ---------------------------
// Plain-language summary of the decision axes that carry the most weight in
// this line of work, and the ones that are never traded away. Every business
// type is judged on the SAME named set of axes — what changes is the emphasis.
// Full detail (and the axis definitions themselves) lives in
// docs/architecture/decision-vectors-by-archetype.md, which each page links to
// by slug. Keep both sides in step when editing.
export const judgement = {
  "trades-and-home-services": {
    weighs:
      "Getting there fast, with the property history in hand. A quick dispatch is worth nothing if the tech arrives without context.",
    never:
      "Safety and licensing. Your coworker flags what a job needs and never improvises code or safety advice to save time.",
  },
  "automotive-services": {
    weighs:
      "Speed for roadside work, and the vehicle details for everything else. A quote without the VIN is a guess.",
    never:
      "Post-install safety steps. Glass recalibration and driver-hours limits are tracked as steps, not afterthoughts.",
  },
  "moving-and-logistics": {
    weighs:
      "A route that pays, and a record of what was moved. The notes are what settle a dispute later.",
    never:
      "Driver-hours limits and chain of custody. Those are limits, not preferences.",
  },
  "security-services": {
    weighs:
      "Keeping each client's sites and records apart, and making incident records solid.",
    never:
      "Officer licensing and documented response. Both are checked up front and over time.",
  },
  "clinics-and-wellness": {
    weighs:
      "The record being there when care happens, and privacy around it.",
    never:
      "Clinical judgement. Your coworker books, prepares and follows up — it never diagnoses, triages, or handles a crisis. Crises go to emergency services.",
  },
  "beauty-and-personal-care": {
    weighs:
      "Protecting the day's income — real per-person availability, buffers, and fewer no-shows.",
    never:
      "Moving a booking in a way you could not have seen coming. You approve first.",
  },
  "pet-services": {
    weighs:
      "Knowing the animal before it arrives — size, coat, temperament, alerts.",
    never:
      "Welfare checks. Vaccination status at intake and medication handling stay gates.",
  },
  "fitness-and-recreation": {
    weighs:
      "The renewal, not the first sale. A signup won at the cost of the renewal scores badly.",
    never:
      "Contacting members without their say-so, and liability details going unrecorded.",
  },
  "education-and-training": {
    weighs:
      "Knowing who learns and who pays, and keeping terms and packages straight.",
    never:
      "Safeguarding. Guardian consent and instructor qualifications are gates when minors are involved.",
  },
  "retail-and-goods": {
    weighs:
      "A checkout that never drops a price, an image, or a delivery detail.",
    never:
      "Payment and delivery privacy, and marketing to a buyer who has not agreed to it.",
  },
  "food-and-hospitality": {
    weighs:
      "Bookings you can see the effect of before you approve them, and a table that is never double-booked.",
    never:
      "Allergens. Dietary needs are a duty of care and reach the kitchen every time.",
  },
  "nonprofits-and-community": {
    weighs:
      "A gift being treated as a gift — a receipt, never a bill, and no account behind it.",
    never:
      "Charity and co-op rules, including how profit is shared back to members.",
  },
  "hoa-and-property-management": {
    weighs:
      "Residents being able to see what a request or approval will do, and every request knowing its address.",
    never:
      "Covenants, reserve disclosures, and deposit law.",
  },
  "public-sector-and-civic": {
    weighs:
      "Getting the request to the right desk, with a record that lasts. Faster is not better in a statutory process.",
    never:
      "Records law and its clocks. For law enforcement, your coworker refuses criminal-justice lookups outright and takes intake only.",
  },
  "banking-and-credit-unions": {
    weighs:
      "Disclosure before the ask, and identity checks before anything proceeds.",
    never:
      "Moving money. DPF records applications and obligations at the engagement layer; your core banking stays where it is.",
  },
  "equipment-and-storage-rental": {
    weighs:
      "Keeping the fleet earning — nothing double-booked, nothing sitting idle — and a condition record at handover and return.",
    never:
      "Deposit law, which changes from place to place.",
  },
  "home-building-and-construction": {
    weighs:
      "A quote educated enough to still be profitable a year later, and selections that outlive the sale.",
    never:
      "Codes, permits and inspections. Once ground is broken, very little can be undone.",
  },
  "professional-services": {
    weighs:
      "Keeping the first question tied to the quote, and every client's files walled off from the rest.",
    never:
      "Advice it is not qualified to give. Legal and financial questions go to a qualified professional.",
  },
  "software-and-platforms": {
    weighs:
      "Building on what already exists, and building things more than one install can use.",
    never:
      "Privacy where the platform touches customer data.",
  },
};

// The architectural one-liner the whole page must land (operator + architect).
export const coreMessage =
  "One DPF install becomes a governed vertical operating system: the archetype shapes the business, TAK governs every agent action, and GAID makes agent identity and evidence inspectable.";

// Per-group content for the product-evidence mockups (setup wizard, generated
// storefront, work board, coworker, Agent Card, mobile shell). Illustrative,
// but grounded in real DPF surfaces (operations board, customer estate,
// ToolExecution audit log, the Authority & Audit / Agent Card workspace).
export const groupMock = {
  field: {
    storeHero: { title: "Fast, reliable home services", sub: "Emergency &amp; planned · licensed &amp; insured" },
    services: [["Emergency call-out", "from £90"], ["Boiler service", "fixed £75"], ["EV charger install", "quote"]],
    storeCta: "Request a quote",
    boardCols: ["New", "Scheduled", "On site", "Invoiced"],
    boardJobs: [["Emergency — 14 Oak St", "URGENT"], ["Boiler service — Patel", ""], ["Leak repair — Unit 4", ""], ["#1042 — paid", ""]],
    chat: { agent: "dispatch coordinator", q: "What’s urgent today?", a: "3 emergency call-outs are unassigned. Want me to route them to the nearest available technician and text ETAs?", actions: ["Approve &amp; dispatch", "Edit routing"] },
    card: { agent: "dispatch-coordinator", route: "/operations · dispatch", grants: "schedule.write · customer.read", hitl: "Proposal-gated", mode: "Propose → approve → dispatch", last: "Routed job #1042 → ToolExecution log", state: "pending" },
    phone: { title: "Today", cardTitle: "Boiler service — 11:00", meta: "14 Oak Street · 3.2 mi · Mrs Patel", btns: ["Navigate", "Start job"] },
  },
  book: {
    storeHero: { title: "Book with the right person", sub: "See real availability · instant confirmation" },
    services: [["New patient exam", "from £60"], ["Follow-up", "45 min"], ["Hygiene visit", "fixed £45"]],
    storeCta: "Book now",
    boardCols: ["Requested", "Confirmed", "In chair", "Checked out"],
    boardJobs: [["New patient — 2:30", ""], ["Follow-up — Sam", ""], ["Cleaning — bay 2", ""], ["Paid — Lee", ""]],
    chat: { agent: "front-desk", q: "Any gaps tomorrow?", a: "A cancellation freed 11:00 and 2:30. Shall I offer them to your waitlist and rebook?", actions: ["Offer to waitlist", "Hold slots"] },
    card: { agent: "front-desk", route: "/operations · schedule", grants: "appointment.write · patient.read", hitl: "Proposal-gated", mode: "Propose → approve → book", last: "Drafted rebook for waitlist", state: "pending" },
    phone: { title: "Today", cardTitle: "Follow-up — 2:30 PM", meta: "Sam Rivera · Room 2", btns: ["Open record", "Check in"] },
  },
  sell: {
    storeHero: { title: "Shop our collection", sub: "Secure checkout · delivery &amp; pickup" },
    services: [["Seasonal bouquet", "from £35"], ["Gift hamper", "£60"], ["Custom arrangement", "quote"]],
    storeCta: "Shop now",
    boardCols: ["New orders", "Picking", "Out for delivery", "Fulfilled"],
    boardJobs: [["Order #1042", ""], ["Custom cake — Fri", ""], ["Trade order — Acme", ""], ["#1038 — paid", ""]],
    chat: { agent: "shop", q: "How’s stock?", a: "Two products are below reorder point and one custom order needs the maker. Want me to draft a restock PO?", actions: ["Draft PO", "Notify maker"] },
    card: { agent: "shop", route: "/operations · orders", grants: "order.read · inventory.write", hitl: "Proposal-gated", mode: "Propose → approve → order", last: "Drafted restock PO #77", state: "pending" },
    phone: { title: "Orders", cardTitle: "Order #1042 — pick &amp; pack", meta: "3 items · deliver Fri · 2 mi", btns: ["View order", "Mark packed"] },
  },
  members: {
    storeHero: { title: "Services for our community", sub: "Apply, request, give — in one place" },
    services: [["Annual membership", "£40/yr"], ["Records request", "statutory fee"], ["Donate", "receipt issued"]],
    storeCta: "Apply / Give",
    boardCols: ["Requests", "Eligibility", "In service", "Receipted"],
    boardJobs: [["Records request", ""], ["KYC check — Lee", ""], ["Amenity booking", ""], ["Dues — receipt", ""]],
    chat: { agent: "member services", q: "Anything need me?", a: "A records request is past its statutory clock and two dues payments cleared. I won’t touch resident PII without your approval.", actions: ["Review request", "Approve receipts"] },
    card: { agent: "member-services", route: "/operations · requests", grants: "request.read · receipt.write", hitl: "Proposal-gated · PII-refused", mode: "Trust gate → propose → approve", last: "Flagged overdue records request", state: "ok" },
    phone: { title: "Requests", cardTitle: "Records request — due", meta: "Statutory clock: 2 days left", btns: ["Open", "Assign"] },
  },
  build: {
    storeHero: { title: "Let’s scope your project", sub: "Consult · proposal · milestones" },
    services: [["Design consult", "60 min"], ["Project quote", "quote"], ["Retainer", "monthly"]],
    storeCta: "Request a consult",
    boardCols: ["Inquiry", "Proposed", "Engaged", "Billed"],
    boardJobs: [["Site survey — Acme", ""], ["Proposal v2", ""], ["Milestone 2", ""], ["Retainer — paid", ""]],
    chat: { agent: "engagement", q: "Where are we?", a: "Milestone 2 is ready to invoice and the Acme retainer renews in 11 days. Want a draft proposal for phase 3?", actions: ["Draft invoice", "Draft proposal"] },
    card: { agent: "engagement", route: "/operations · engagements", grants: "engagement.read · billing.write", hitl: "Proposal-gated", mode: "Propose → approve → bill", last: "Drafted milestone-2 invoice", state: "pending" },
    phone: { title: "Engagements", cardTitle: "Acme — site visit 9:00", meta: "Survey + selections · 5 mi", btns: ["Directions", "Open project"] },
  },
};

// Convenience: pages indexed by group, preserving the groups[] order.
export function pagesByGroup() {
  return groups.map((g) => ({
    ...g,
    items: pages.filter((p) => p.group === g.id),
  }));
}
