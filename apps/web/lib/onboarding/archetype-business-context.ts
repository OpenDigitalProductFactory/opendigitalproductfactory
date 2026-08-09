// Archetype-intelligent business context for onboarding.
//
// One source of business-model-aware starter doctrine, keyed by archetype
// category (and, for a few flagship archetypes, the specific slug). It feeds:
//   - suggestMission()         → the mission starter on the business-context form
//   - seedOrgWwwdCorpus()      → the org-overlay WWWD wiki page bodies
//
// The goal: a fresh install's WWWD corpus reads like it already understands the
// operator's line of work — appointment-based care reads differently from
// project-based professional services, which reads differently from
// transactional retail — so new users feel understood on day one. Everything
// here is an EDITABLE STARTER; the operator refines it.
//
// EXTENDING (the "periodical seed refresh" the founder asked for): as archetypes
// evolve, (a) add/adjust an INDUSTRY_PROFILES entry for a new category, and/or
// (b) add an ARCHETYPE_PROFILES override (merged over its industry profile) to
// deepen a specific business model. Keep entries to broad, true, editable
// starters — do not encode brittle specifics that read as fabricated.

export type ArchetypeBusinessProfile = {
  /** Completes the clause "we exist to …". */
  missionTheme: string;
  /** One-line characterisation of the revenue / operating model. */
  businessModel: string;
  /** Who-we-serve stance body (markdown paragraph). */
  whoWeServe: string;
  /** How-we-decide stance body — the trade-offs this business model leans on. */
  howWeDecide: string;
  /**
   * Supplier / supply-chain stance — the typical procurement and vendor
   * posture this kind of business runs on (1–3 sentences). Editable starter,
   * never fabricated specifics.
   */
  supplyChain: string;
};

export const GENERIC_BUSINESS_PROFILE: ArchetypeBusinessProfile = {
  missionTheme:
    "deliver real value to the people we serve and build a business we are proud of",
  businessModel:
    "We earn trust by doing good work for the people we serve and being worth coming back to.",
  whoWeServe:
    "We serve the people and stakeholders our business exists to help — the customers, clients, and community who rely on what we do.",
  howWeDecide:
    "We start from our mission and the people we serve, prefer durable quality over shortcuts, stay transparent about trade-offs, and keep humans in final authority over consequential calls.",
  supplyChain:
    "We rely on a small set of dependable suppliers and service vendors for what the business needs to operate. Refine this as the real purchasing pattern emerges.",
};

// ─── Industry-category profiles (the 9 archetype categories) ─────────────────

const INDUSTRY_PROFILES: Record<string, ArchetypeBusinessProfile> = {
  "healthcare-wellness": {
    missionTheme:
      "deliver attentive, high-quality care that improves the health and wellbeing of every patient",
    businessModel:
      "Care is delivered through booked appointments and ongoing treatment relationships; reputation and continuity drive repeat visits and referrals.",
    whoWeServe:
      "We serve patients and their families who trust us with their health. Many return over time, so each visit is part of a longer relationship, not a one-off transaction.",
    howWeDecide:
      "Patient safety and clinical quality come first — always. After that we weigh access, continuity of care, and a calm, respectful experience. We never trade a patient's wellbeing for speed or margin, and we are transparent when something is uncertain.",
    supplyChain:
      "We rely on medical and clinical supply distributors for consumables, PPE, and pharmaceuticals — much of it on a recurring schedule. Continuity matters: a stock-out can delay patient care, so we keep working relationships with both primary and backup suppliers.",
  },
  "beauty-personal-care": {
    missionTheme:
      "help every client look and feel their best through skilled, personal service",
    businessModel:
      "Revenue comes from booked appointments and walk-ins; loyalty and word-of-mouth are built one great experience at a time.",
    whoWeServe:
      "We serve clients who want to look and feel good and who come back when they trust our hands and enjoy the experience. Regulars are the heart of the business.",
    howWeDecide:
      "We decide for the client's confidence and the personal relationship: skilled work, a welcoming chair, honest advice about what will suit them, and a result they are proud to show off. Repeat trust beats a one-time upsell.",
    supplyChain:
      "Our supply chain centres on professional product distributors plus a curated set of retail brands we resell. Inventory turns matter alongside trust — clients notice when a favourite product is missing, and back-bar consumables drive a real share of unit cost.",
  },
  "fabric-care-services": {
    missionTheme:
      "care for customers' garments and textiles with reliable cleaning, careful handling, and convenient pickup",
    businessModel:
      "Point-of-sale service with some recurring and account work: customers drop off or schedule pickup, the business processes garments through a plant or workroom, and repeat trust depends on item tracking, quality, and ready promises.",
    whoWeServe:
      "We serve households and local businesses who trust us with garments, uniforms, linens, and textiles they need cleaned, pressed, repaired, and returned on time.",
    howWeDecide:
      "We decide for garment care, custody accuracy, and promise reliability: tag every item, respect care instructions, communicate delays early, and fix mistakes quickly. A ready promise we cannot meet becomes a customer update, not a surprise at the counter.",
    supplyChain:
      "We rely on cleaning consumables, tags, packaging, hangers, plant equipment maintenance, route/delivery partners, and specialty repair vendors. Supply continuity and equipment uptime protect ready promises and customer trust.",
  },
  "agriculture-ranching": {
    missionTheme:
      "steward our land, animals, equipment, and resources to produce dependable food, forage, livestock, and rural services across seasons",
    businessModel:
      "Seasonal, asset-intensive production with biological and weather uncertainty: income may combine crops, hay, livestock, grazing, breeding stock, and custom services, while major costs and commitments arrive well before sale.",
    whoWeServe:
      "We serve buyers, neighbors, landowners, processors, sale barns, and other agricultural businesses who depend on honest condition, timing, handling, and availability information.",
    howWeDecide:
      "We decide for long-term land and herd health, animal welfare, safe and label-compliant work, equipment readiness, and financial resilience. Forecasts inform a decision but never masquerade as certainty, and irreversible or regulated actions stay with the owner and qualified professional.",
    supplyChain:
      "We depend on feed, seed, fertilizer and crop-protection suppliers, veterinarians, farriers, equipment dealers, parts and fuel providers, laboratories, haulers, applicators, custom hay crews, and market channels. Seasonal capacity means we reserve critical services and parts before the work window opens.",
  },
  "manufacturing": {
    missionTheme:
      "turn sound engineering into dependable physical products, built safely, traceably, and right the first time",
    businessModel:
      "A capital- and inventory-intensive industrial OEM: demand becomes engineered or configured orders, released work moves through constrained production resources, and margin depends on material, labor, quality, throughput, and warranty performance.",
    whoWeServe:
      "We serve business customers, channel partners, integrators, and installed-base operators who rely on our products to perform to specification and arrive with trustworthy documentation and support.",
    howWeDecide:
      "Safety, released engineering, quality evidence, and customer commitments govern the work. We expose constraints early, stop nonconforming work, keep revision and genealogy records intact, and never trade a hidden defect for schedule appearance.",
    supplyChain:
      "We depend on qualified material and component suppliers, contract processes, calibration and test services, freight partners, and equipment support. Lead time, approved source, lot identity, change notice, and incoming quality matter alongside unit price.",
  },
  "fitness-recreation": {
    missionTheme:
      "help our members move, train, and live healthier, more active lives",
    businessModel:
      "A membership / recurring model — long-term member results and retention matter far more than one-off sign-ups.",
    whoWeServe:
      "We serve members on a journey — from first-timers to regulars — who want to get stronger, healthier, and more confident. Their progress and sense of belonging keep them with us.",
    howWeDecide:
      "We decide for member results and a welcoming, motivating community. We favour what keeps people coming back and progressing over what merely sells a membership, and we keep the space safe, clean, and encouraging.",
    supplyChain:
      "Most of what we buy is durable: equipment, weights, and machines from specialised suppliers, plus regular consumables for cleaning, maintenance, and member amenities. Service relationships matter as much as initial purchase price — equipment downtime is a member-experience issue.",
  },
  "food-hospitality": {
    missionTheme:
      "create welcoming experiences and food and hospitality our guests come back for",
    businessModel:
      "High-volume service where consistency, speed, and repeat custom drive the business; a great visit earns the next one.",
    whoWeServe:
      "We serve guests who choose to spend their time and money with us — locals, regulars, and first-timers we want to turn into regulars. Every guest's experience is the product.",
    howWeDecide:
      "We decide for the guest experience and consistency: quality and hospitality every time, cleanliness and safety without compromise, and speed that never costs care. A guest who leaves happy is the whole point.",
    supplyChain:
      "Perishable goods sit at the centre of our supply chain. We balance local producers (freshness, story) with broadline distributors (consistency, breadth), receive frequently, and treat the cold chain, food safety, and waste discipline as core operations — not back-of-house concerns.",
  },
  "media-production": {
    missionTheme:
      "produce work our clients are proud of and that gets results — on brief, on budget, and on time",
    businessModel:
      "Project-based production: each commission runs pre-production → shoot/build → post → delivery, billed against milestones. Reputation, the reel, and repeat clients drive the pipeline.",
    whoWeServe:
      "We serve brands, agencies, and organisations who trust us to turn a brief into finished work. The relationship is built shoot by shoot — a project delivered well earns the next one and the referral.",
    howWeDecide:
      "We decide for the finished work and the client relationship: creative quality, a realistic plan, and honesty about what a budget and timeline can deliver. We protect the crew's craft and the client's brand, and we never over-promise to win a pitch.",
    supplyChain:
      "We run on a flexible network of freelance crew and talent plus equipment-rental houses, studios, and post/software vendors we book per project. Reliability and availability matter more than lowest price — a no-show on a shoot day is unrecoverable.",
  },
  "live-events-venues": {
    missionTheme:
      "put on unforgettable events and fill the room — great shows, well run, that audiences and artists come back for",
    businessModel:
      "Event-driven and ticketed: we announce, go on sale, sell tickets, and run the event. Capacity is finite, so sell-through, on-sale conversion, and a returning audience drive the business.",
    whoWeServe:
      "We serve ticket buyers and fans who choose to spend a night with us, and the artists and partners who trust us with their show. A great experience turns a first-timer into a regular.",
    howWeDecide:
      "We decide for the audience experience and a safe, well-run event: strong programming, fair pricing, crowd safety without compromise, and clear communication when plans change. We balance the artist deal, the box-office risk, and the room we can fill.",
    supplyChain:
      "We buy in artist and talent guarantees, production and staging, staffing and security, and ticketing services — mostly per event. Contracts, insurance, licences, and reliable production partners are core operations; a failed supplier on show day is a public failure.",
  },
  "professional-services": {
    missionTheme:
      "deliver expert advice and dependable service that helps our clients succeed",
    businessModel:
      "Project- and retainer-based expertise; the business runs on trust, reputation, and long-term client relationships.",
    whoWeServe:
      "We serve clients who hire us for judgment and results they cannot easily get elsewhere. The relationship is built on trust and tends to compound over years and referrals.",
    howWeDecide:
      "We decide for client success and long-term trust over a quick win. We give honest advice even when it is not what the client hoped to hear, protect confidentiality, and stand behind the quality of our work.",
    supplyChain:
      "Our physical supply chain is intentionally light — most of what we consume is software, research databases, and professional subscriptions. The discipline is in vendor selection and renewal review: a stale tool can cost more than its licence.",
  },
  "real-estate-construction": {
    missionTheme:
      "build homes and communities our buyers are proud to live in",
    businessModel:
      "Home sales driven by display-home visits and purchase agreements; revenue arrives at settlement with milestone draws during construction. Subcontractors deliver the trade work; the builder's value is design, project management, and quality assurance.",
    whoWeServe:
      "We serve home buyers — first-timers, families upsizing, downsizers, and investors — who trust us with the largest purchase of their lives. Every home we hand over is a reflection of that trust and our reputation.",
    howWeDecide:
      "We decide for build quality, delivery on time, and the buyer's confidence at handover. A defect caught before settlement is never optional to fix, and a warranty call is an opportunity to demonstrate we stand behind our work. We hold completion integrity above schedule shortcuts.",
    supplyChain:
      "Our build supply chain is almost entirely subcontracted — framers, concreters, plumbers, electricians, plasterers, tilers, and painters all work under our project management umbrella. The discipline is in subcontractor qualification, schedule coordination, and quality inspection at every stage. Material supply (structural timber, windows, bricks, roof tiles) typically runs through builders' merchants and volume trade accounts; lead times and material price volatility are operational risks that need to be hedged in contract pricing.",
  },
  "asset-rental": {
    missionTheme:
      "keep a well-maintained pool of equipment available and turning so customers get what they need, when they need it",
    businessModel:
      "We earn by renting reusable assets for a period — reserved, handed out, used, returned, inspected, and re-pooled. Utilization, fast turnaround, and avoiding double-bookings are how the business makes money.",
    whoWeServe:
      "We serve renters who need an asset for a window of time, not to own it — contractors, event organizers, households, or (for a co-op) member-owners sharing a pool. The asset comes back and serves the next customer.",
    howWeDecide:
      "We decide for asset availability and condition: keep the pool maintained and ready, prevent reservation conflicts, recover overdue returns promptly, and protect against damage with deposits. A unit sitting idle or stuck out is lost revenue.",
    supplyChain:
      "Our 'inventory' is the rentable pool itself plus maintenance parts and consumables; the operational discipline is turnaround time, condition tracking, and keeping high-demand items available through peak season.",
  },
  "public-sector": {
    missionTheme:
      "serve every resident of our community fairly, openly, and well with the public services they rely on",
    businessModel:
      "We are funded by levies, fees, and grants set in public session — not by sales. The measure of the operation is budget-to-actual stewardship and resident trust, not profit.",
    whoWeServe:
      "We serve the residents of our jurisdiction — everyone within it, by right, not by contract. Residents are simultaneously the people we serve, the taxpayers who fund us, and the voters we answer to.",
    howWeDecide:
      "We decide in public: open meetings, published agendas and minutes, and records anyone can request. Equal treatment and due process are non-negotiable — we cannot pick our customers, so fairness and transparency lead every call.",
    supplyChain:
      "Purchasing follows public procurement rules — quotes and sealed bids above statutory thresholds, with an audit trail. We rely on local contractors for streets, parks, and facilities work, and intergovernmental agreements for what we cannot staff ourselves.",
  },
  "hoa-property-management": {
    missionTheme:
      "care for the properties and communities entrusted to us so owners and residents can thrive",
    businessModel:
      "Ongoing stewardship of properties on behalf of owners and residents; responsiveness and fairness sustain the relationship.",
    whoWeServe:
      "We serve property owners who trust us with a major asset and the residents who live there. We answer to both, and balancing their interests fairly is the job.",
    howWeDecide:
      "We decide to protect the asset, treat residents fairly, and respond quickly when something needs attention. We are transparent about costs and decisions, and we hold the long-term health of the property above any short-term convenience.",
    supplyChain:
      "Our 'supply chain' is mostly trusted contractors and service vendors — landscaping, plumbing, electrical, pool service — plus consumables for common areas. We keep a vetted bench so urgent jobs do not become emergency markups.",
  },
  "banking-financial-services": {
    missionTheme:
      "safeguard our customers' money and help them reach their financial goals",
    businessModel:
      "Deposit, lending, and card relationships sustained over years; interest margin and account fees fund the institution, and trust is the product.",
    whoWeServe:
      "We serve the people and businesses of our community who trust us with their deposits and their borrowing. Many relationships span decades and generations — every interaction either builds or spends that trust.",
    howWeDecide:
      "Safety and soundness come first: regulatory compliance and our customers' trust outrank growth and speed, and we never trade examination posture for short-term revenue. Rate and term claims must always match what we actually offer, and required disclosures stay attached to the products they describe. Within that frame we decide for long-term relationships over transactional wins.",
    supplyChain:
      "Our operating backbone is a small set of critical vendors: the core processing platform, card networks and processors, the deposit-insurance regime, credit bureaus, and loan-document and appraisal services. Vendor changes are regulated events, so we manage these as long-term, examined relationships.",
  },
  "education-training": {
    missionTheme:
      "help our learners grow, in a safe and supportive environment",
    businessModel:
      "Enrolment- and term-based; the business is sustained by learner progress and the trust of families and learners.",
    whoWeServe:
      "We serve learners and the families who entrust them to us. Their growth, safety, and confidence are why we exist, and their progress is our reputation.",
    howWeDecide:
      "We decide for the learner's growth and wellbeing first. Safety and care are non-negotiable; beyond that we favour what genuinely helps people learn over what is merely convenient to deliver.",
    supplyChain:
      "We provision curriculum materials, classroom consumables, and educational technology — much of it on an annual or term-based cycle tied to the academic calendar. Lead times for textbooks and licensed materials need planning, not last-minute scrambles.",
  },
  "retail-goods": {
    missionTheme:
      "offer products our customers love, backed by service they can trust",
    businessModel:
      "Transactional sales with repeat custom; product quality, fair value, and service turn a first purchase into a returning customer.",
    whoWeServe:
      "We serve customers looking for products they can rely on at a fair price, with help when they need it. Repeat buyers and recommendations are what make the business sustainable.",
    howWeDecide:
      "We decide for the customer's trust: products we would recommend to a friend, honest descriptions and fair pricing, and service that makes returns and questions painless. A customer who trusts us comes back.",
    supplyChain:
      "We carry inventory bought from wholesalers, brand distributors, or direct from makers. The rhythm is reorder, receive, sell — managed against shelf space, cash tied up in stock, and how fast items turn. Stock-outs lose sales; over-buying ties up cash.",
  },
  "nonprofit-community": {
    missionTheme:
      "advance our cause and serve our community with integrity",
    businessModel:
      "Mission- and donor-funded; impact for beneficiaries and careful stewardship of every donation sustain the organisation.",
    whoWeServe:
      "We serve the people and cause at the heart of our mission, alongside the donors, volunteers, and community who make the work possible. We are accountable to all of them.",
    howWeDecide:
      "We decide for mission impact and the people we serve, steward every donation carefully, and stay transparent about where resources go. We hold our purpose above growth for its own sake.",
    supplyChain:
      "Our supply chain blends purchased program supplies, in-kind donations from supporters, and contributions from partner organisations. Stewardship matters — we choose suppliers and partners who match our mission and respect that donors' trust comes attached.",
  },
  "automotive-services": {
    missionTheme:
      "get our customers safely back on the road with honest, convenient vehicle service",
    businessModel:
      "Mobile service that comes to the customer — most jobs are dispatched to a driveway, workplace, or roadside. Trust, honest diagnosis, and fast turnaround drive repeat work and referrals.",
    whoWeServe:
      "We serve drivers and fleet owners who need work done on their vehicle without the hassle of a shop visit. Many are stranded or inconvenienced, so speed and reliability earn the next call.",
    howWeDecide:
      "We decide for safety, honest diagnosis, and getting the customer moving again. We never upsell work a vehicle does not need, we stand behind our parts and our calibration, and we are transparent about price before we start.",
    supplyChain:
      "We stock parts on the van or truck and resolve the right part from the vehicle's VIN — glass SKUs, filters, tires, keys. Keeping the mobile inventory matched to the day's jobs is the discipline; a wrong or missing part means a second trip and a lost slot.",
  },
  "moving-and-logistics": {
    missionTheme:
      "move our customers' belongings and freight safely, on time, and with care",
    businessModel:
      "Crew-and-truck jobs quoted per move or run on recurring routes; careful handling and on-time delivery turn a stressful day into a referral.",
    whoWeServe:
      "We serve households relocating and businesses that need goods moved or delivered. We are handling people's possessions or a company's promises to its own customers, so trust is the product.",
    howWeDecide:
      "We decide for careful handling, honest estimates, and hitting the promised window. We protect what we carry, communicate delays early, and never cut corners on securing a load or on a driver's legal hours.",
    supplyChain:
      "Our 'inventory' is trucks, fuel, packing materials, and the crew's time; the discipline is routing, load planning, and keeping vehicles and equipment road-ready. Driver hours and vehicle availability are the real constraints on what we can promise.",
  },
  "warehousing-fulfilment": {
    missionTheme:
      "look after our clients' goods as if they were our own, and get every order out on time and correct",
    businessModel:
      "Contract accounts on a rate card: storage billed on the space held, handling billed on the work done. Accuracy and on-time despatch are what keep an account and win the next one.",
    whoWeServe:
      "We serve businesses that trust us to hold and handle stock they own. We are custodians, not owners — their inventory is their working capital and their promise to their own customers, and both sit on our racks.",
    howWeDecide:
      "We decide for accuracy first, then speed: a fast pick of the wrong item costs more than a slow one of the right one. We keep each client's stock and data strictly separate, count honestly, and flag a discrepancy rather than absorb it quietly.",
    supplyChain:
      "Our capacity is racking, dock doors, materials-handling equipment, and the hours of the people who work them; our consumables are packaging and pallets. Space and labour are the real constraints on what we can take on, and a booked-in receipt that is not put away is capacity we cannot sell.",
  },
  "security-services": {
    missionTheme:
      "keep the people, property, and events entrusted to us safe",
    businessModel:
      "Recurring guard and monitoring contracts plus field installation; dependability and a credible response are what clients renew for.",
    whoWeServe:
      "We serve businesses, property managers, and residents who need a visible, reliable security presence. The relationship rests on trust that we will be there and respond when it matters.",
    howWeDecide:
      "We decide for the safety of people first, then property — with trained, licensed officers, clear post orders, and documented incident response. We never compromise coverage or cut corners on vetting and licensing.",
    supplyChain:
      "We provision uniforms, vehicles, radios, and — for the install side — alarm, camera, and access-control hardware from security distributors. Licensing and training are as load-bearing as equipment; an unlicensed officer or an unmonitored panel is an operational and legal failure.",
  },
  "trades-maintenance": {
    missionTheme:
      "do reliable, quality work that keeps our customers' homes and properties running",
    businessModel:
      "Job- and call-out-based work — quotes, repairs, installs, and maintenance plans. Reputation, reliability, and showing up when we said we would drive repeat work and referrals.",
    whoWeServe:
      "We serve homeowners, landlords, and businesses who need work done right and on time, often urgently. Trust is earned one job at a time, and a good tradesperson becomes the one they call again.",
    howWeDecide:
      "We decide for quality workmanship, safety, and honest pricing. We never cut corners on a fix that affects safety, we are upfront about what is needed versus what can wait, and we stand behind our work.",
    supplyChain:
      "We rely on trade suppliers and merchants for parts and materials — much of it carried as van stock so common jobs are first-visit fixes. Matching the right parts to the day's jobs is the discipline; a missing part means a second trip and a lost slot.",
  },
  "pet-services": {
    missionTheme:
      "care for every pet as if it were our own",
    businessModel:
      "Appointment- and visit-based services — grooming, walking, boarding, and care. Trust with people's animals drives loyalty and word-of-mouth referrals.",
    whoWeServe:
      "We serve pet owners who trust us with a member of their family. Many become regulars, so each visit is part of an ongoing relationship built on the animal's wellbeing and the owner's peace of mind.",
    howWeDecide:
      "We decide for the animal's safety, comfort, and wellbeing first, then the owner's trust. We are honest about what a pet needs, careful with handling and health, and we never take on more than we can care for well.",
    supplyChain:
      "We provision grooming and care consumables, food, and supplies from pet-trade distributors, plus equipment that must be cleaned and maintained to a hygiene standard. Running out of a consumable or a broken piece of equipment is a welfare and reputation issue, not just a cost one.",
  },
  "software-platform": {
    missionTheme:
      "build software that genuinely helps the people and businesses who depend on it",
    businessModel:
      "Subscription and usage-based recurring revenue. The business compounds on retention, expansion, and word-of-mouth — keeping customers successful matters far more than any single sale.",
    whoWeServe:
      "We serve the users and organizations who run part of their work on our product. The relationship is ongoing and renewal-driven, so their success and trust are the whole business, not a one-time transaction.",
    howWeDecide:
      "We decide for long-term customer success, reliability, and data trust over short-term growth hacks. We protect uptime and security, are honest about limitations and roadmap, and keep humans in control of consequential automated decisions.",
    supplyChain:
      "Our supply chain is almost entirely digital — cloud infrastructure, third-party APIs, and software subscriptions. The discipline is vendor selection, dependency and security review, and avoiding lock-in; an unreviewed dependency or a single-vendor outage can take the whole product down.",
  },
};

// ─── Flagship specific-archetype overrides (merged over the industry profile) ─
// Add entries here to deepen a particular business model. Partial — only the
// fields you want to specialise; the rest inherit from the industry profile.

const ARCHETYPE_PROFILES: Record<string, Partial<ArchetypeBusinessProfile>> = {
  "medical-practice": {
    missionTheme:
      "provide safe, attentive medical care that helps every patient live healthier",
    businessModel:
      "Appointment- and encounter-based ambulatory care, with continuity across preventive, routine, and follow-up visits and a mix of patient, payer, or public funding.",
    whoWeServe:
      "We serve patients and families who rely on accessible, coordinated care over time. Each encounter belongs to a continuing care relationship, not an isolated transaction.",
    howWeDecide:
      "Clinical safety, patient consent, and professional standards come first. We coordinate across doctors, nurses, and front-desk staff, protect private health information, and escalate consequential or uncertain decisions to the responsible clinician.",
  },
  "dental-practice": {
    missionTheme:
      "keep our patients' smiles healthy with gentle, expert dental care they trust",
    businessModel:
      "Recurring check-ups plus planned treatment; long-term patient relationships and gentle, anxiety-aware care drive retention and referrals.",
    whoWeServe:
      "We serve patients and families across routine prevention, hygiene, treatment, and urgent dental needs, coordinating dentists, hygienists, assistants, and the front desk around a continuing oral-health relationship.",
    howWeDecide:
      "Patient safety, informed consent, clinical quality, and anxiety-aware care come first. We protect private health information and keep treatment decisions with the responsible licensed dental professional.",
  },
  restaurant: {
    missionTheme:
      "serve food and hospitality our guests look forward to coming back for",
    supplyChain:
      "Perishable ingredients drive the rhythm — we receive most days, balance local producers with broadline distributors, and treat cold-chain integrity, food safety, and waste discipline as everyday operations, not back-of-house concerns.",
  },
  "law-firm": {
    missionTheme:
      "protect our clients' interests with expert, dependable legal counsel",
    howWeDecide:
      "We decide for the client's interests and long-term trust, give candid advice even when unwelcome, protect confidentiality absolutely, and never let a short-term win compromise our professional integrity.",
  },
  "fitness-gym": {
    missionTheme:
      "help our members get stronger, healthier, and more confident — and keep coming back",
  },
  "dry-cleaning-plant-network": {
    businessModel:
      "A counter, plant, and sometimes delivery-route network: satellite stores capture orders, the plant processes work, and customer trust lives in the ticket/tag chain plus clear ready notifications.",
    supplyChain:
      "The operating backbone is cleaning chemistry, tags/tickets, bags, hangers, presses, washers, dryers, boilers, conveyors, and repair relationships. The plant is the bottleneck, so equipment uptime and consumable supply are service quality, not merely purchasing.",
  },
  "ecommerce-general": {
    businessModel:
      "Online transactional sales with repeat custom; product quality, fast fulfilment, and easy support turn first orders into loyal customers.",
    supplyChain:
      "Inventory comes from wholesalers, brand suppliers, or via dropship; some SKUs we hold, some ship direct. We manage against turn rate, lead times, and fulfilment-partner reliability — what is on the website needs to be in stock or shippable, not aspirational.",
  },
  "new-home-builder": {
    missionTheme:
      "build quality homes and thriving communities that buyers are proud to call home",
    businessModel:
      "Volume production of homes across planned communities; display homes serve as the showroom, and most buyer contact begins with a guided tour. Subcontractors complete most trade work under the builder's project management; revenue arrives at settlement.",
    supplyChain:
      "Volume builders run centralised supply chains with preferred suppliers and trade partnerships across structural, building envelope, joinery, services (MEP), and finishes categories. Trade-pack pricing and volume commitments buffer against spot-price volatility; site supervisors manage the subcontractor schedule and stage inspections.",
  },
  "custom-home-builder": {
    missionTheme:
      "design and build the home each client has been imagining, on the lot they have chosen",
    businessModel:
      "Project-based: one contract per home, structured around a build programme with milestone payments. Each project is unique; the builder manages the design-to-handover journey including permits, subcontractor coordination, and quality sign-off.",
    supplyChain:
      "Custom builders procure on a project-by-project basis, working with trusted local subcontractors and trade suppliers who match the quality standard the brief demands. Supplier relationships are long-term but quantities are project-specific, with provisional sums built into contracts for items such as stone, joinery, and fixtures where selection drives price. Site lead times for premium materials require early ordering.",
  },
  nonprofit: {
    missionTheme:
      "advance our cause and serve our community with integrity and impact",
  },
};

// ─── Stance vectors (EP-0AF96937 company-stance onboarding, BI-70ADC71F) ─────
// The 5 coverage vectors that prime the WWWD decision gate: each becomes an
// org-overlay stance page + PerspectiveMaterial bundle at seeding time
// (unconfirmed B/0.6 — clears nothing until the owner confirms). Same contract
// as the profiles above: broad, true, EDITABLE STARTERS in the industry's own
// vocabulary; never fabricated specifics. Ceilings are rendered into the stance
// body text (the deliberation layer reads them semantically) — no schema field.

export const STANCE_VECTOR_KEYS = [
  "customer-goodwill",
  "pricing-integrity",
  "growth-vs-stability",
  "quality-bar",
  "spend-authority",
] as const;
export type StanceVectorKey = (typeof STANCE_VECTOR_KEYS)[number];

export type StanceVectorDefault = {
  /** Card/page title in plain language (a question the owner recognizes). */
  title: string;
  /** The default stance — 1–3 plain sentences, owner-editable starter. */
  stance: string;
  /** Authority ceiling in whole USD (goodwill / pricing / spend vectors). */
  ceilingUsd?: number;
};

export type ArchetypeStanceVectors = Record<StanceVectorKey, StanceVectorDefault>;

export const GENERIC_STANCE_VECTORS: ArchetypeStanceVectors = {
  "customer-goodwill": {
    title: "When something goes wrong on our side",
    stance:
      "When a problem is our fault, we make it right quickly — a redo, replacement, refund, or credit — without making the customer fight for it. Within the goodwill ceiling, resolve it on the spot; beyond it, the owner decides.",
    ceilingUsd: 100,
  },
  "pricing-integrity": {
    title: "Prices, quotes, and discounts",
    stance:
      "We honor the prices we quote, including our own mistakes, and fix the source of the error. Discounts are deliberate, not improvised: offer one only when it serves a relationship we want to keep, and never price below what the work costs us.",
    ceilingUsd: 100,
  },
  "growth-vs-stability": {
    title: "New opportunities vs existing commitments",
    stance:
      "When new opportunities compete with commitments to existing customers, existing commitments get first call on our capacity. We take on new work at the pace quality allows, not faster.",
  },
  "quality-bar": {
    title: "Our quality standard",
    stance:
      "Work that leaves our hands meets our standard. If something slips below it, we fix it at our cost before it costs us trust — a redo is cheaper than a lost reputation.",
  },
  "spend-authority": {
    title: "Spending without asking",
    stance:
      "Routine, budgeted purchases that keep the business running can proceed without the owner, up to the spend ceiling per purchase. Anything novel, recurring, or above the ceiling goes to the owner first.",
    ceilingUsd: 250,
  },
};

/** Industry overrides — only the vectors where the posture genuinely differs. */
const INDUSTRY_STANCE_VECTORS: Record<string, Partial<ArchetypeStanceVectors>> = {
  "healthcare-wellness": {
    "customer-goodwill": {
      title: "When a patient's experience goes wrong",
      stance:
        "A failure in a patient's experience gets a same-day response and a genuine fix — rebook first, waive or comp where we fell short, and tell the owner the same day. Never argue with a patient over a fee we caused.",
      ceilingUsd: 150,
    },
    "quality-bar": {
      title: "Our care standard",
      stance:
        "Patient safety and clinical quality are never traded for speed or margin. If care or service slips below our standard, we correct it at our cost and say so plainly.",
    },
    "spend-authority": {
      title: "Spending without asking",
      stance:
        "Recurring clinical and office supplies reorder without the owner up to the ceiling per purchase — a stock-out can delay care. New equipment, new vendors, or anything above the ceiling goes to the owner.",
      ceilingUsd: 500,
    },
  },
  "food-hospitality": {
    "customer-goodwill": {
      title: "When a guest's visit goes wrong",
      stance:
        "Fix the visit while the guest is still at the table: remake or comp the dish, not the argument. Staff resolve it on the spot within the ceiling; a comped meal that wins the next three visits is cheap.",
      ceilingUsd: 60,
    },
    "quality-bar": {
      title: "What leaves the pass",
      stance:
        "Food safety and cleanliness are never negotiable. If a plate isn't right, it doesn't leave the pass — and if it did, we remake it without debate.",
    },
  },
  "retail-goods": {
    "customer-goodwill": {
      title: "Returns, damage, and our mistakes",
      stance:
        "If we shipped it wrong, late, or broken, we replace or refund without friction within the ceiling — the customer should not pay for our mistake. Habitual-abuse cases go to the owner rather than becoming policy.",
      ceilingUsd: 75,
    },
    "spend-authority": {
      title: "Restocking without asking",
      stance:
        "Reorders of proven sellers within budget proceed without the owner up to the ceiling per order. New lines, new suppliers, or bulk buys above it are the owner's call — stock ties up cash.",
      ceilingUsd: 200,
    },
  },
  "professional-services": {
    "customer-goodwill": {
      title: "When our work misses the mark",
      stance:
        "When our advice or work falls short, we remediate with more of our own work first, a credit second, and a refund only when trust demands it. The relationship compounds over years; the fix should protect it.",
      ceilingUsd: 250,
    },
    "pricing-integrity": {
      title: "Fees, scope, and discounts",
      stance:
        "We honor quoted fees and absorb our own estimating mistakes on the current engagement while correcting them for the next one. We do not discount below the cost of doing the work well — a cheap engagement done badly costs the reputation.",
    },
  },
  "banking-financial-services": {
    "customer-goodwill": {
      title: "When we make an account error",
      stance:
        "Fees or charges caused by our error are reversed promptly within the ceiling and documented. Anything touching disclosures, rates, or regulated terms goes to the owner — goodwill never bends compliance.",
      ceilingUsd: 100,
    },
    "pricing-integrity": {
      title: "Rates, terms, and exceptions",
      stance:
        "Rate and term claims always match what we actually offer, and required disclosures stay attached. There are no improvised pricing exceptions — every exception is an owner decision with a record.",
    },
  },
  "trades-maintenance": {
    "customer-goodwill": {
      title: "Callbacks and our mistakes",
      stance:
        "A callback on our own work is priority scheduling and free within the ceiling — we stand behind the work. If the fault is genuinely not ours, we say so honestly and quote the real job.",
      ceilingUsd: 150,
    },
    "spend-authority": {
      title: "Parts and van stock without asking",
      stance:
        "Parts and materials needed to finish a booked job proceed without the owner up to the ceiling — a second trip costs more than the part. Tools, equipment, and new suppliers are the owner's call.",
      ceilingUsd: 300,
    },
  },
  "fabric-care-services": {
    "customer-goodwill": {
      title: "When a garment order goes wrong",
      stance:
        "If we lose, damage, delay, or misroute a customer's garment through our mistake, we respond quickly, explain plainly, and make it right with redo, repair, credit, or refund within the ceiling. Anything involving a high-value or sentimental item goes to the owner.",
      ceilingUsd: 150,
    },
    "growth-vs-stability": {
      title: "New volume vs ready promises",
      stance:
        "Existing claim tickets and ready promises get first call on plant capacity. We take new volume at the pace the plant and workroom can process accurately, not faster.",
    },
    "quality-bar": {
      title: "Our garment-care standard",
      stance:
        "A garment does not leave below our standard. If cleaning, pressing, folding, repair, tagging, or packaging is wrong, we fix it before handoff or tell the customer early.",
    },
    "spend-authority": {
      title: "Spending without asking",
      stance:
        "Routine cleaning supplies, tags, hangers, bags, and urgent minor equipment fixes can proceed without the owner up to the ceiling. New equipment, new vendors, or anything above it goes to the owner.",
      ceilingUsd: 300,
    },
  },
  "agriculture-ranching": {
    "customer-goodwill": {
      title: "When our product or handling falls short",
      stance:
        "If our description, handling, timing, or quality is wrong, we say so promptly and offer a practical correction within the ceiling. Animal-welfare, food-safety, title, or high-value disputes go to the owner immediately.",
      ceilingUsd: 250,
    },
    "pricing-integrity": {
      title: "Quotes in a moving market",
      stance:
        "We state what a quote covers, how long it is valid, and which weight, grade, quality, delivery, or market facts can change it. We do not hide uncertainty or rewrite agreed terms after the fact.",
      ceilingUsd: 250,
    },
    "growth-vs-stability": {
      title: "More acres or animals vs resilient capacity",
      stance:
        "Land condition, feed and water, animal care, labor, equipment, cash, and outside-service capacity set the safe growth rate. We do not add production faster than those systems can carry it through a poor-weather year.",
    },
    "quality-bar": {
      title: "Our stewardship and welfare standard",
      stance:
        "Animal welfare, label compliance, traceable records, safe equipment, and honest product condition are never traded for speed or a sale. Stop and escalate when the record, label, withdrawal interval, forecast, or qualified advice is missing.",
    },
    "spend-authority": {
      title: "Routine seasonal spending without asking",
      stance:
        "Budgeted feed, seed, consumables, routine parts, and scheduled animal or equipment care may proceed within the ceiling. New chemicals, major repairs, new vendors, capital equipment, and unbudgeted commitments go to the owner.",
      ceilingUsd: 500,
    },
  },
  "manufacturing": {
    "customer-goodwill": {
      title: "When our product or delivery falls short",
      stance:
        "We contain the issue, protect the customer's operation, and preserve the evidence before debating fault. Routine freight, replacement, or rework remedies may proceed within the ceiling; safety, systemic, or material warranty exposure goes to the owner and quality authority.",
      ceilingUsd: 500,
    },
    "pricing-integrity": {
      title: "Quotes, configurations, and change control",
      stance:
        "A quote states configuration, quantity, lead time, validity, exclusions, and acceptance basis. Scope or revision changes become an explicit change, never a quiet reduction in what was promised.",
    },
    "growth-vs-stability": {
      title: "New orders vs released capacity",
      stance:
        "Released customer commitments get first call on qualified material, people, equipment, and test capacity. We accept new demand at the rate the constraint and quality system can carry, not the rate the order book can hide.",
    },
    "quality-bar": {
      title: "Our release standard",
      stance:
        "Nonconforming work is identified, contained, and dispositioned by authorized people. Missing, stale, or uncertain evidence is not a pass, and schedule pressure never authorizes an unrecorded deviation.",
    },
    "spend-authority": {
      title: "Routine production spending without asking",
      stance:
        "Approved replenishment, ordinary consumables, calibration, and routine maintenance may proceed within budget and the ceiling. New suppliers, tooling, capital equipment, design changes, and unplanned commitments go to the owner.",
      ceilingUsd: 1000,
    },
  },
  "automotive-services": {
    "customer-goodwill": {
      title: "When our repair doesn't hold",
      stance:
        "If our part or work fails, we return and make it right free within the ceiling, at the customer's location, at the next available slot. Safety-related comebacks jump the queue.",
      ceilingUsd: 150,
    },
  },
  "software-platform": {
    "customer-goodwill": {
      title: "When our product or billing fails a customer",
      stance:
        "Outages, bugs, and billing errors on our side are credited or refunded without friction within the ceiling, and we say plainly what went wrong. A long-time customer harmed by our mistake is restored first, reconciled second.",
      ceilingUsd: 200,
    },
    "growth-vs-stability": {
      title: "New features vs reliability",
      stance:
        "Reliability and existing-customer success outrank new-feature velocity — churn from broken trust costs more than a delayed launch. We ship new capability at the pace uptime and support quality allow.",
    },
  },
  "education-training": {
    "customer-goodwill": {
      title: "When we fail a learner or family",
      stance:
        "If we cancel, misschedule, or under-deliver, we make the learner whole first — a make-up session or credit within the ceiling — and tell the family before they ask.",
      ceilingUsd: 100,
    },
  },
  "public-sector": {
    "customer-goodwill": {
      title: "When we get it wrong with a resident",
      stance:
        "Errors are corrected through the published process, equally for every resident — fee waivers and remedies follow the schedule, not discretion. Transparency about the mistake is part of the remedy.",
    },
    "pricing-integrity": {
      title: "Fees and charges",
      stance:
        "Fees are set in public session and applied uniformly. There are no discounts or improvised exceptions — changing a fee is a public decision, not a service gesture.",
    },
  },
  "nonprofit-community": {
    "spend-authority": {
      title: "Spending donors' money without asking",
      stance:
        "Program supplies within the approved budget proceed up to the ceiling per purchase. Anything outside budget or above it goes to the director — every dollar carries a donor's trust.",
      ceilingUsd: 150,
    },
  },
};

/**
 * Resolve the stance-vector defaults for an org: industry overrides merged
 * over the generic set. Pure and deterministic; primary archetype only (no
 * secondary blending — mixed stances read as mush, and the owner confirms or
 * adjusts each card anyway).
 */
export function resolveStanceVectors(input: {
  archetypeId?: string | null;
  industry?: string | null;
}): ArchetypeStanceVectors {
  const overrides = (input.industry ? INDUSTRY_STANCE_VECTORS[input.industry] : undefined) ?? {};
  const merged = {} as Record<StanceVectorKey, StanceVectorDefault>;
  for (const key of STANCE_VECTOR_KEYS) {
    merged[key] = overrides[key] ?? GENERIC_STANCE_VECTORS[key];
  }
  return merged;
}

/**
 * Resolve the best business profile for an org: a flagship archetype override
 * (merged over its industry profile) when available, else the industry profile,
 * else the generic profile. Pure and deterministic.
 *
 * When secondaryArchetypeIds / secondaryIndustries are provided (multi-archetype
 * composition), each secondary's whoWeServe and supplyChain paragraphs are
 * appended to the primary's when they differ — blended, not replaced.
 * All prior call sites without secondaries are unchanged.
 */
export function resolveBusinessProfile(input: {
  archetypeId?: string | null;
  industry?: string | null;
  secondaryArchetypeIds?: string[] | null;
  secondaryIndustries?: string[] | null;
}): ArchetypeBusinessProfile {
  const base: ArchetypeBusinessProfile =
    (input.industry ? INDUSTRY_PROFILES[input.industry] : undefined) ?? GENERIC_BUSINESS_PROFILE;
  const override = input.archetypeId ? ARCHETYPE_PROFILES[input.archetypeId] : undefined;
  const primary = override ? { ...base, ...override } : base;

  const secondaryIds = input.secondaryArchetypeIds ?? [];
  const secondaryIndustries = input.secondaryIndustries ?? [];
  const count = Math.max(secondaryIds.length, secondaryIndustries.length);
  if (count === 0) return primary;

  const extraWhoWeServe: string[] = [];
  const extraSupplyChain: string[] = [];

  for (let i = 0; i < count; i++) {
    const secId = i < secondaryIds.length ? secondaryIds[i] : undefined;
    const secInd = i < secondaryIndustries.length ? secondaryIndustries[i] : undefined;
    const secBase =
      (secInd ? INDUSTRY_PROFILES[secInd] : undefined) ?? GENERIC_BUSINESS_PROFILE;
    const secOverride = secId ? ARCHETYPE_PROFILES[secId] : undefined;
    const sec = secOverride ? { ...secBase, ...secOverride } : secBase;

    if (sec.whoWeServe !== primary.whoWeServe) extraWhoWeServe.push(sec.whoWeServe);
    if (sec.supplyChain !== primary.supplyChain) extraSupplyChain.push(sec.supplyChain);
  }

  return {
    ...primary,
    whoWeServe:
      extraWhoWeServe.length > 0
        ? `${primary.whoWeServe}\n\n${extraWhoWeServe.join("\n\n")}`
        : primary.whoWeServe,
    supplyChain:
      extraSupplyChain.length > 0
        ? `${primary.supplyChain}\n\n${extraSupplyChain.join("\n\n")}`
        : primary.supplyChain,
  };
}
