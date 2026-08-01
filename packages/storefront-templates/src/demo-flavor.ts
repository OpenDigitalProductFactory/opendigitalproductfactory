import type { ArchetypeCategory } from "./types";
import type { DemoFlavor } from "./demo-business";

/**
 * Archetype Demo Factory — the flavor registry (EP-ARCHETYPE-DEMO A·P3).
 *
 * The thin, authored layer that raises a demo from "plausible" (the always-valid
 * derived default) to "a real owner would recognise this". `deriveDemoBusiness`
 * consults this registry by default, so fidelity is **incremental**: coverage
 * stays 94/94 from the derived defaults, and each entry here upgrades one
 * archetype (or one category) without touching the generator (spec §2.2, §7 P3).
 *
 * Shared with the Excellence Corpus (workstream B): the same curated material —
 * company character, signature offerings, and the one-line "what a great one
 * feels like" (`notes`) — is the seed both the demo factory (fidelity) and WWWD
 * priming (stance) consume. Authored once, read twice.
 *
 * PURE data. No `Math.random`/`Date`; deterministic and snapshot-stable.
 */

/** Per-archetype flavor for the flagship slugs — authored first, fan out over time. */
export const DEMO_FLAVORS: Record<string, DemoFlavor> = {
  "dental-practice": {
    companyName: "Bright Smile Dental",
    staff: [
      { name: "Dr. Ada Rowe", role: "Principal Dentist" },
      { name: "Dr. Priya Nair", role: "Associate Dentist" },
      { name: "Tom Fisher", role: "Dental Hygienist" },
      { name: "María Ortiz", role: "Front-Desk Coordinator" },
    ],
    customers: ["Jordan Reyes", "Ella Whitfield", "Marcus Bell", "Sofia Grant", "Dev Kapoor"],
    signatureOfferings: ["6-month check-up & clean", "Invisible aligners", "Emergency same-day slot"],
    notes: "Runs to time, remembers your name, and never upsells — every chair full, no one waiting past 10 minutes.",
  },
  restaurant: {
    companyName: "The Copper Fork",
    staff: [
      { name: "Nadia Alvarez", role: "Head Chef" },
      { name: "Ben Okafor", role: "Sous Chef" },
      { name: "Chloe Tan", role: "Floor Manager" },
      { name: "Leo Marchetti", role: "Server" },
    ],
    customers: ["The Harpers (party of 4)", "Aisha & Rowan", "Table for two — anniversary", "Walk-in, bar", "Priya's birthday, 8"],
    signatureOfferings: ["Chef's tasting menu", "Wood-fired flatbreads", "Sunday roast"],
    notes: "Tables turn smoothly, the pass never backs up, and the waitlist moves — a full room that still feels calm.",
  },
  "veterinary-clinic": {
    companyName: "Meadowbrook Veterinary Clinic",
    staff: [
      { name: "Dr. Iris Lund", role: "Lead Veterinarian" },
      { name: "Dr. Sam Adeyemi", role: "Veterinarian" },
      { name: "Kayla Brooks", role: "Veterinary Nurse" },
      { name: "Gareth Vaughan", role: "Practice Manager" },
    ],
    customers: ["Bella (Labrador)", "Miso (tabby cat)", "Pip (rabbit)", "Otis (spaniel)", "Nimbus (cockatiel)"],
    signatureOfferings: ["Wellness plan", "Same-day sick visit", "Dental & minor surgery"],
    notes: "Anxious pets leave calm, owners get a clear plan, and urgent cases are seen the same day.",
  },
  "hair-salon": {
    companyName: "Kingsley & Co. Hair",
    staff: [
      { name: "Farah Deen", role: "Master Stylist" },
      { name: "Jools Bennett", role: "Colour Specialist" },
      { name: "Remy Cole", role: "Stylist" },
      { name: "Tam Wu", role: "Front of House" },
    ],
    customers: ["Georgia M.", "Aaron P.", "Sunny K.", "Bea & the girls", "Marcus (fade)"],
    signatureOfferings: ["Cut & finish", "Balayage", "Wedding-morning styling"],
    notes: "Chairs stay booked back-to-back, colour clients rebook before they leave, and no one is kept waiting for their stylist.",
  },
  plumber: {
    companyName: "Ashford Plumbing & Heating",
    staff: [
      { name: "Dean Whitlock", role: "Lead Engineer" },
      { name: "Ravi Chandra", role: "Gas-Safe Engineer" },
      { name: "Katie Sorenson", role: "Apprentice" },
      { name: "Moira Flynn", role: "Dispatcher" },
    ],
    customers: ["No-hot-water callout — Elm St", "Boiler service — the Osei household", "Leak under sink — 14 Vale Rd", "Bathroom refit quote", "Radiator flush"],
    signatureOfferings: ["Same-day emergency callout", "Annual boiler service", "Bathroom installations"],
    notes: "Vans routed to the nearest job, parts on board, and emergencies reached before the water damage spreads.",
  },
  accounting: {
    companyName: "Northgate Accountancy",
    staff: [
      { name: "Helen Cross", role: "Partner" },
      { name: "Idris Bello", role: "Senior Accountant" },
      { name: "Wendy Zhou", role: "Bookkeeper" },
      { name: "Paul Ferris", role: "Tax Adviser" },
    ],
    customers: ["Copper Fork Ltd — year-end", "J. Rivera (self-assessment)", "Meadowbrook Vets — payroll", "Ashford Plumbing — VAT", "New client onboarding"],
    signatureOfferings: ["Year-end accounts", "VAT & bookkeeping", "Self-assessment"],
    notes: "Deadlines never slip, clients know their number before quarter-end, and nothing sits unbilled.",
  },
  "new-home-builder": {
    companyName: "Cedar Park Homes",
    staff: [
      { name: "Owen Radcliffe", role: "Site Manager" },
      { name: "Bianca Serra", role: "Project Lead" },
      { name: "Hassan Karim", role: "Foreman" },
      { name: "Denise Ward", role: "Sales & Handover" },
    ],
    customers: ["Plot 12 — the Nguyens", "Plot 7 reservation", "Show-home viewing", "Snagging — Plot 3", "Plot 19 — deposit taken"],
    signatureOfferings: ["3 & 4-bed family homes", "Reserve off-plan", "2-year warranty"],
    notes: "Plots handed over on the promised date, snags closed fast, and buyers kept in the loop at every stage.",
  },
  "custom-home-builder": {
    companyName: "Harborview Custom Builders",
    staff: [
      { name: "Grace Sullivan", role: "Principal / Builder" },
      { name: "Theo Almeida", role: "Site Foreman" },
      { name: "Lena Fischer", role: "Design Coordinator" },
      { name: "Rob Machin", role: "Estimator" },
    ],
    customers: ["Hillside residence — the Delacroix build", "Coastal extension", "Barn conversion — design phase", "Kitchen & garden room", "New client consult"],
    signatureOfferings: ["Bespoke new builds", "Architect-led extensions", "Full project management"],
    notes: "One client, one crew, a clear budget line — the build stays on programme and the finish is the one they pictured.",
  },
  florist: {
    companyName: "Petal & Stem",
    staff: [
      { name: "Rosa Delacroix", role: "Lead Florist" },
      { name: "Kai Nakamura", role: "Florist" },
      { name: "Bea Hollis", role: "Shop & Online" },
    ],
    customers: ["Wedding — the Okonkwos", "Weekly office order", "Sympathy arrangement", "Online bouquet — next-day", "Subscription — bi-weekly"],
    signatureOfferings: ["Wedding & event flowers", "Same-day local delivery", "Seasonal subscription"],
    notes: "Fresh stock turns before it wilts, online orders go out same-day, and every event arrangement lands exactly as pictured.",
  },
  gym: {
    companyName: "Ironworks Gym",
    staff: [
      { name: "Marcus Vane", role: "Head Coach" },
      { name: "Priya Anand", role: "Class Instructor" },
      { name: "Del Roberts", role: "Personal Trainer" },
      { name: "Sasha Kerr", role: "Front Desk" },
    ],
    customers: ["6am HIIT regulars", "New member — 3-month plan", "PT client — strength block", "Class no-show follow-up", "Renewal — annual"],
    signatureOfferings: ["Unlimited classes", "1:1 personal training", "Beginner strength programme"],
    notes: "Classes fill from the waitlist, members keep their streak, and slipping attendees get a nudge before they cancel.",
  },
  tutoring: {
    companyName: "Bright Minds Tutoring",
    staff: [
      { name: "Elena Fteros", role: "Lead Tutor" },
      { name: "Sam Whitfield", role: "Maths Tutor" },
      { name: "Aditi Rao", role: "Coordinator" },
    ],
    customers: ["GCSE maths — the Balogun family", "11+ prep", "A-level chemistry", "New enquiry — Year 9", "Weekly slot — Tuesdays"],
    signatureOfferings: ["Exam prep", "Weekly 1:1 sessions", "Small-group revision"],
    notes: "Every student has a plan and a slot, results move term on term, and parents see progress they can point to.",
  },
  "moving-company": {
    companyName: "Sure-Hands Movers",
    staff: [
      { name: "Gus Petrov", role: "Crew Lead" },
      { name: "Malik Osei", role: "Mover" },
      { name: "Trina Boyd", role: "Dispatcher" },
    ],
    customers: ["3-bed house move — the Ahmeds", "Office relocation", "Packing-only quote", "Long-distance — booked", "Same-week local move"],
    signatureOfferings: ["Local & long-distance moves", "Packing service", "Storage handoff"],
    notes: "Crews routed to the day's jobs, nothing turns up short-handed, and month-end peaks are quoted and booked in advance.",
  },
  "animal-shelter": {
    companyName: "Second Chance Animal Shelter",
    staff: [
      { name: "Nadia Sowande", role: "Shelter Manager" },
      { name: "Elliot Rush", role: "Animal Care Lead" },
      { name: "Fran Delgado", role: "Volunteer Coordinator" },
    ],
    customers: ["Adoption — Bella the collie", "Foster application", "Monthly donor — the Kims", "Volunteer shift signup", "Grant deadline — Q3"],
    signatureOfferings: ["Rehoming & adoption", "Foster programme", "Monthly giving"],
    notes: "Animals find homes quickly, donors see the impact of their gift, and volunteer shifts stay filled and thanked.",
  },
  "software-platform": {
    companyName: "Cadence",
    staff: [
      { name: "Yuki Tanaka", role: "Account Manager" },
      { name: "Omar Haddad", role: "Customer Success Lead" },
      { name: "Priti Shah", role: "Onboarding Specialist" },
    ],
    customers: ["Northwind Ltd — renewal ≤60d", "At-risk: Acme (usage down)", "New account onboarding", "Expansion — added seats", "Open CTA — QBR"],
    signatureOfferings: ["Team & enterprise plans", "Guided onboarding", "Usage-based add-ons"],
    notes: "Renewals land early, at-risk accounts are caught before they churn, and every new account reaches value fast.",
  },
  "small-town-municipality": {
    companyName: "Riverside Town Hall",
    staff: [
      { name: "Councillor Dana Lowe", role: "Services Lead" },
      { name: "Pat Nkemelu", role: "Senior Case Officer" },
      { name: "Wei Chen", role: "Intake Clerk" },
    ],
    customers: ["Building permit — 14 Vale Rd", "Business licence renewal", "Noise complaint — case open", "Planning inspection", "Rates enquiry"],
    signatureOfferings: ["Permits & licensing", "Planning & inspections", "Resident services"],
    notes: "Cases move within their SLA, nothing sits past its deadline, and residents get a clear answer the first time.",
  },
};

/** Category-level "what a great one feels like" — the incremental fidelity floor
 *  for archetypes without their own entry yet. Merged UNDER any per-archetype
 *  flavor. Kept to `notes` (the shared Excellence-Corpus seed) so the derived
 *  company name / roster still varies per archetype. */
export const CATEGORY_FLAVOR_DEFAULTS: Partial<Record<ArchetypeCategory, Pick<DemoFlavor, "notes">>> = {
  "healthcare-wellness": { notes: "Seen on time, treated with care, and given a clear next step — capacity full without the wait." },
  "beauty-personal-care": { notes: "Booked back-to-back, clients rebook before they leave, and every chair earns its keep." },
  "food-hospitality": { notes: "The room fills, the pass keeps pace, and the waitlist moves — busy but never chaotic." },
  "trades-maintenance": { notes: "Nearest van, right parts, urgent jobs reached first — the schedule runs itself." },
  "professional-services": { notes: "Deadlines held, utilisation high, nothing left unbilled — clients always know where they stand." },
  "retail-goods": { notes: "Shelves stocked to demand, online orders picked fast, and nothing sits as dead stock." },
  "pet-services": { notes: "Anxious animals leave calm, owners get a plan, and urgent cases are fit in the same day." },
  "real-estate-construction": { notes: "Delivered on the promised date, snags closed fast, and the client kept in the loop throughout." },
  "fitness-recreation": { notes: "Classes fill, members keep their streak, and the timetable flexes to demand." },
  "nonprofit-community": { notes: "Donors feel the impact, volunteers show up, and every programme hits its goal." },
  "software-platform": { notes: "Renewals land early, at-risk accounts are caught before they churn, and every account reaches value fast." },
  "education-training": { notes: "Every learner has a plan and a slot, cohorts fill, and progress is something you can point to." },
  "automotive-services": { notes: "Cars in and out on time, the right parts on hand, and no comeback jobs." },
  "moving-and-logistics": { notes: "Crews routed to the day's jobs, nothing turns up short-handed, and peaks are booked in advance." },
  "public-sector": { notes: "Cases move within their SLA, nothing sits past its deadline, and residents get a clear answer first time." },
  "banking-financial-services": { notes: "Applications move through cleanly, disclosures are never missed, and members' money is handled with care." },
  "live-events-venues": { notes: "Dates fill, holds convert to contracts, and every event runs to its run-of-show." },
  "media-production": { notes: "Projects ship on schedule, the pipeline stays full, and unbilled work never piles up." },
  "asset-rental": { notes: "Assets turn quickly, returns are inspected and back on the line, and nothing sits idle or overdue." },
  "security-services": { notes: "Every post and patrol is covered, incidents are logged and answered fast, and contracts renew on trust." },
  "hoa-property-management": { notes: "Requests are actioned, dues stay current, and the community sees the place well kept." },
  "warehousing-fulfilment": { notes: "Goods booked in the day they land, stock counts that match the shelf, and every order out before cut-off." },
  "fabric-care-services": { notes: "Every garment tagged, every ready promise visible, and customers notified before they have to ask." },
  "agriculture-ranching": { notes: "Every field, pasture, animal, machine, input, and outside-service window visible before the season makes the decision for us." },
};

/** Resolve the default flavor for an archetype: its own entry merged over its
 *  category floor. Returns `undefined` when neither exists (the generator then
 *  uses its always-valid derived defaults). */
export function resolveDemoFlavor(
  archetypeId: string,
  category?: ArchetypeCategory,
): DemoFlavor | undefined {
  const own = DEMO_FLAVORS[archetypeId];
  const base = category ? CATEGORY_FLAVOR_DEFAULTS[category] : undefined;
  if (!own && !base) return undefined;
  return { ...base, ...own };
}
