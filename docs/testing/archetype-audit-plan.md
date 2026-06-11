# Archetype Audit Plan — All 55 Archetypes

**Status:** Draft — 2026-06-10  
**Scope:** Full audit of every seeded archetype via browser-driven fresh installs. Produces gap backlog items for post-audit execution.  
**Related:** [platform-qa-plan.md](platform-qa-plan.md), [fresh-install.ps1](../../scripts/fresh-install.ps1), [BIAN design spec](../superpowers/specs/2026-06-09-bian-banking-archetypes-design.md)

---

## 1. Purpose

DPF ships 55 archetypes across 14 categories. The platform must behave correctly for each organizational model — correct vocabulary, correct CTA, correct coworker framing, correct activation modules, correct compliance defaults. This audit drives each archetype through a browser-realistic experience and records gaps as backlog items.

**Out of scope for this plan:** executing the gap items. This thread produces the plan, the backlog snapshot, and the per-run scripts. Execution follows in a separate thread.

---

## 2. Constraints

- **All interaction via browser.** Every test step is driven at `http://localhost:3000` through the portal UI. No direct DB writes, no curl, no SQL.
- **Full reset between runs.** Each audit run begins from a clean install: volumes wiped, database re-seeded, no previously created organization.
- **Stay out of Build Studio.** Gap items are filed as backlog items; they are not promoted into Build Studio during this audit.
- **Backlog must be backed up** before the first reset and restored after the final run.

---

## 3. Audit Run Strategy

55 archetypes across 16 runs. Each run = one fresh install. Within each run, the lead archetype is the primary setup target; additional archetypes in the same category are tested by re-running the storefront setup wizard (no re-install needed to swap archetype within a session — the setup wizard at `/storefront/setup` allows reconfiguration).

| Run | Category | Archetypes | CTAs Exercised |
|-----|----------|------------|----------------|
| 1 | Trades & Maintenance | plumber, electrician, facilities-maintenance | inquiry |
| 2 | Beauty & Personal Care | hair-salon, barber-shop, nail-salon, beauty-spa, optician | booking |
| 3 | Healthcare & Wellness | veterinary-clinic, dental-practice, physiotherapy | booking |
| 4 | Pet Services | pet-grooming, pet-boarding, dog-walking, pet-rescue | booking, donation |
| 5 | Food & Hospitality | restaurant, catering, bakery | booking, inquiry, purchase |
| 6 | Retail & Goods | retail-goods, artisan-goods, florist | purchase |
| 7 | Fitness & Recreation | gym, yoga-studio, sports-club | purchase |
| 8 | Education & Training | corporate-training, tutoring, driving-school, music-school, dance-studio | booking, inquiry |
| 9 | Professional Services A | consulting, legal-services, marketing-agency, accounting | inquiry |
| 10 | Professional Services B | it-managed-services | inquiry (MSP profile) |
| 11 | Nonprofit & Community | pet-rescue, animal-shelter, community-shelter, charity, cooperative | donation |
| 12 | HOA & Property Management | homeowners-association, condo-association, property-management-company | inquiry |
| 13 | Software & Platform | software-platform | inquiry |
| 14 | Banking & Financial Services | community-bank, credit-union, mortgage-lending | inquiry (KYC) |
| 15 | Public Sector | small-town-municipality, municipal-utility | inquiry |
| 16 | Law Enforcement | law-enforcement-agency | inquiry (public-body) |

> **Note on personal services:** landscaping, cleaning-service, personal-trainer, counselling, and wholesale-distribution are not yet confirmed as seeded leaf archetypes. Verify during Run 1 scouting; file BI if missing.

---

## 4. Backlog Backup Procedure

**Perform before Run 1. Repeat after every run before resetting.**

### 4a. Live backlog snapshot (as of 2026-06-10)

The following open and in-progress epics exist and must be preserved. This serves as the restoration reference if the audit DB is used for the final restore.

#### In-Progress Epics (21)

| Epic ID | Title | Open | In-Progress | Done |
|---------|-------|------|-------------|------|
| EP-FULL-OBS | Full Observability | 0 | 1 | 1 |
| EP-GRID-WORKBOOKS | Universal Grid & Workbooks | 1 | 1 | 2 |
| EP-PARTNER-CHANNEL | Partner / Reseller Channel & Identity | 5 | 1 | 0 |
| EP-CRM-MKT-OPS | CRM and Marketing Operations | 0 | 1 | 4 |
| EP-INSTALL-HARDENING-2026-05-23 | First-run install path hardening | 11 | 10 | 2 |
| EP-ARCH-8D4F2A | Archetype Model V2 | 3 | 2 | 6 |
| EP-MCP | MCP tooling + token onboarding | 0 | 0 | 8 |
| EP-WIKI-001 | Platform Kernel Wiki | 7 | 1 | 8 |
| EP-PRINCIPLES | Principles as wiki kind | 3 | 0 | 7 |
| EP-CAPSULE | Portal Work Capsule control harness | 5 | 2 | 9 |
| EP-HIVE-SCOUT | Hive Scout autonomous coworker | 2 | 0 | 5 |
| EP-ROUTING-11 | Routing substrate #11 | 2 | 5 | 14 |
| EP-COWORKER-RT | Autonomous Coworker Runtime | 4 | 1 | 9 |
| EP-INSTALLER | Installer parity | 1 | 1 | 9 |
| EP-LICENSING | Licensing / Permit / Jurisdiction | 0 | 1 | 2 |
| EP-COMM-FABRIC | Employee Communication Fabric | 2 | 0 | 3 |
| EP-SBO | Small Business OS parity | 0 | 1 | 3 |
| EP-MARKETING | Marketing coworker + native readiness | 2 | 2 | 5 |
| EP-AGENTS-DOC | AGENTS.md + public docs refresh | 0 | 1 | 6 |
| EP-EDGE-NODE | DPF Edge Node | 1 | 3 | 10 |
| EP-DEPS-SWEEP | Dependabot / security alert sweep | 0 | 1 | 0 |

#### Open Epics (49)

See Appendix A for full list. Key high-priority open epics with substantial open items:

| Epic ID | Open Items | Priority |
|---------|------------|----------|
| EP-REDUCTION-GEAR-ARCH | 73 | 2 |
| EP-BUILD-STUDIO | 27 | — |
| EP-UPGRADE-LIFECYCLE | 8 | — |
| EP-WWMD-MCP | 16 | 5 |
| EP-9FC5D2FD (Dale persona hardening) | 23 | 10 |
| EP-COWORKER-INTERACTIVITY | 6 | — |
| EP-CLIENT-HOOK-PLANE | 8 | — |
| EP-MDM | 7 | 2 |
| EP-PROACTIVE-OPS | 11 | 2 |
| EP-INT-2E7C1A | 13 | — |
| EP-WORKTREE-HYGIENE | 10 | — |
| EP-CTRL-5E21A4 | 10 | — |

### 4b. Export procedure

Before each reset, run the following via the portal to capture the current state:

1. Navigate to `/ops` → verify visible backlog items
2. Use MCP tool `list_epics` (all statuses) and `list_backlog_items` (all statuses) to export a JSON snapshot
3. Save as `docs/testing/backlog-snapshots/backlog-YYYY-MM-DD-runN.json`
4. Verify the file was written before running `fresh-install.ps1`

### 4c. Restore procedure (after all runs)

After the final audit run and before returning to normal development:

1. Run `fresh-install.ps1` one final time (this resets to a clean canonical state)
2. Re-add the pre-audit organization setup via the setup wizard
3. Use `create_epic` and `create_backlog_item` MCP tools to restore backlog items from the JSON snapshot
4. Verify counts match the pre-audit snapshot
5. Re-link backlog items to their epics via `link_backlog_item_to_epic`

> **Note:** The restore only needs to recover epics and backlog items. Provider credentials, branding config, and organization data will be re-entered fresh via the setup wizard.

---

## 5. Fresh Install Reset Procedure (Per Run)

Execute between each audit run. Takes approximately 5–10 minutes.

### Step 1 — Backup current state

```
# Via MCP (in Claude Code terminal):
# Run list_epics + list_backlog_items, save to backlog-snapshots/
```

### Step 2 — Wipe and reinstall

```powershell
# From repo root (D:\DPF):
docker compose down -v --remove-orphans
# Wait for completion, then:
.\fresh-install.ps1
```

This wipes volumes (`pgdata`, `neo4jdata`, `qdrant_data`, `redis_data`) and re-seeds the database.

### Step 3 — Verify clean state

1. Navigate to `http://localhost:3000`
2. Confirm redirect to `/welcome` (not `/workspace` — which would mean old org data survived)
3. Confirm no organization exists (no banner, no pre-filled archetype)

### Step 4 — Configure AI provider

1. Navigate to `/platform/ai/providers`
2. Configure at least one provider (Anthropic Claude recommended — already configured on Mark's machine via environment variable)
3. Verify provider shows healthy status

### Step 5 — Run setup wizard

Follow the archetype-specific setup script in Section 7 for the current run.

---

## 6. Standard Per-Archetype Test Checklist

Apply this checklist to every archetype within a run. Log findings in Section 8 (gap template).

### Phase A — Onboarding (SETUP)
- [ ] **A1** Navigate to `/welcome` → Setup wizard loads (SETUP step 1)
- [ ] **A2** Enter the run's fictional company URL (from persona table) → brand analysis runs
- [ ] **A3** Confirm archetype suggestion matches expected archetype (SETUP-03 analogue)
- [ ] **A4** Select the target archetype from the grid (or confirm auto-selected)
- [ ] **A5** Complete identity step — company name, address, timezone
- [ ] **A6** Complete financial setup — currency pre-fills correctly for locale
- [ ] **A7** Complete setup wizard — organization created, redirected to `/workspace`

### Phase B — Storefront (STORE)
- [ ] **B1** Navigate to `/storefront` → Workspace loads with correct archetype name
- [ ] **B2** Click "View Live" → Public portal renders with correct hero, service items
- [ ] **B3** Verify vocabulary — "Book Now" vs "Shop Now" vs "Get a Quote" vs "Donate" matches archetype CTA
- [ ] **B4** Verify service/product item names match archetype templates
- [ ] **B5** Trigger the primary CTA flow end-to-end:
  - **booking**: calendar → select slot → fill form → confirm booking → reference number shown
  - **purchase**: add to cart / select item → checkout form → confirm → reference shown
  - **inquiry**: fill inquiry form → submit → reference shown
  - **donation**: select amount → fill details → confirm → reference shown
- [ ] **B6** Coworker panel on `/storefront` → Marketing Specialist agent loads (AI-03 analogue)
- [ ] **B7** Verify archetype-specific vocabulary in coworker (no "FeatureBuild", "capsule", "worktree" language)

### Phase C — Business Context & Compliance (GRC)
- [ ] **C1** Navigate to `/storefront/settings/business` → Business context form loads
- [ ] **C2** Verify industry classification matches archetype category
- [ ] **C3** Navigate to `/compliance` → Dashboard loads
- [ ] **C4** For regulated archetypes (banking, healthcare, legal, law enforcement): verify licensing section shows correct jurisdiction placeholders

### Phase D — Finance Defaults (FIN)
- [ ] **D1** Navigate to `/finance` → Dashboard loads
- [ ] **D2** Verify currency default matches expected (USD unless locale suggested otherwise)
- [ ] **D3** For banking archetypes: verify BIAN capability perspective is accessible

### Phase E — Coworker Fit (AI)
- [ ] **E1** Navigate to `/workspace` → COO agent shown
- [ ] **E2** Ask COO: "What business are we in?" → Response uses archetype vocabulary (not generic)
- [ ] **E3** Ask COO: "What services do we offer?" → Lists archetype service items
- [ ] **E4** Verify coworker does NOT use platform-developer vocabulary (no "backlog", "epic", "build studio", "worktree", "MCP")
- [ ] **E5** Ask: "Help me prepare for a [archetype-specific scenario]" → Response is contextually relevant

### Phase F — Inbox & Operations (OPS)
- [ ] **F1** Complete a public storefront CTA submission (Phase B5)
- [ ] **F2** Navigate to `/storefront/inbox` → inquiry/booking appears
- [ ] **F3** Navigate to `/ops` → Workspace backlog loads (should be empty on fresh install)
- [ ] **F4** Send an inbox item "to backlog" → item appears under `/ops`

---

## 7. Archetype Inventory, Personas & Run Scripts

### Run 1 — Trades & Maintenance

**Fresh install target.** Three archetypes tested in sequence by switching via `/storefront/setup`.

---

#### Archetype: `plumber`
**Fictional company:** Riverside Plumbing Solutions  
**Domain:** `riverside-plumbing.co` (use `.com` if scrape fails)  
**Persona — Operator:** Sandra Hooper, sole owner, 2-truck operation, handles bookings herself  
**Business model:** Emergency and planned residential/commercial plumbing. Quote-based pricing. Customer calls or submits inquiry online. Job assigned to technician. Invoiced after completion.  
**CTA:** inquiry  
**Key services to verify:** Leak Repair, Drain Clearing, Boiler Service, Emergency Call-Out, Bathroom Fitting  
**Vocabulary expected:** customers, jobs, call-outs, quotes, technicians  
**Vocabulary must NOT appear:** FeatureBuild, worktree, capsule, MCP, epic, backlog  
**Special:** Urgent urgency field in form (TRADES_FORM_FIELDS) — verify "Urgency" dropdown renders and submits

**Run-1 setup steps:**
1. Reset → fresh install
2. Brand URL: `riverside-plumbing.co` → expect archetype suggestion: `plumber` (or `trades-maintenance`)
3. Select `plumber` from grid
4. Company name: Riverside Plumbing Solutions | Timezone: America/Chicago | Currency: USD
5. Complete wizard → `/workspace`
6. Run Phases A–F
7. Log gaps

---

#### Archetype: `electrician`
**Fictional company:** Bright Wire Electric  
**Persona — Operator:** Mike Voltz, licensed electrician, 3 staff  
**Business model:** Installations, fault-finding, safety certification. Inquiry-to-quote model. Regulatory: NICEIC/NFPA compliance (UK/US).  
**CTA:** inquiry  
**Key services to verify:** Consumer Unit Installation, Fault Diagnosis, EV Charger Install, Safety Inspection, Emergency Rewire  
**Special:** Verify property type field in form renders

After completing plumber test: navigate to `/storefront/setup` → change archetype to `electrician` → re-run Phases A–F.

---

#### Archetype: `facilities-maintenance`
**Fictional company:** ProSite Facilities Group  
**Persona — Operator:** Jamie Chen, operations manager, 15-technician FM company serving commercial landlords  
**Business model:** Planned maintenance contracts + reactive repair. B2B primary consumer. Quote pricing. HVAC Servicing is a key service item (the AC repair scenario).  
**CTA:** inquiry  
**Key services to verify:** Planned Maintenance Contract, HVAC Servicing, Reactive Repair, Building Inspection, Emergency Call-Out  
**Special — HVAC/AC test:** Ask coworker "A tenant is complaining about no cold air — what do we do?" → Response should reference HVAC Servicing, not technical platform terms.  
**Gap check:** BI-FS-001 (HVAC/AC Contractor Storefront Archetype) is an open backlog item — confirm whether a dedicated `hvac-contractor` leaf is present. If not, note the gap.

After electrician test: navigate to `/storefront/setup` → change to `facilities-maintenance` → re-run Phases A–F.

---

### Run 2 — Beauty & Personal Care

**Fresh install target.** Five archetypes. This category has the highest count and uses appointment-checkout commercial model with no customer-estate module.

---

#### Archetype: `hair-salon`
**Fictional company:** Studio 44 Hair  
**Domain:** `studio44hair.com`  
**Persona — Operator:** Chloe Martinez, salon owner, 4 stylists, appointment book full 3 weeks out  
**Business model:** Appointment-checkout. Clients book online, pay at checkout. No running account/billing. Booking is the primary CTA.  
**CTA:** booking  
**Key services to verify:** Women's Haircut & Style, Color Treatment, Highlights, Keratin Treatment, Bridal Package  
**Vocabulary expected:** clients, appointments, stylists, bookings, treatments  
**Special:** Verify `appointment-checkout` commercial model means NO account setup required; calendar shows stylist availability; no "invoice" or "account balance" in coworker responses  
**Activation profile check:** `customer-estate` module should NOT be active for this archetype

---

#### Archetype: `barber-shop`
**Fictional company:** The Fifth Chair Barbershop  
**Persona — Operator:** Devon King, master barber, 3-chair shop in downtown  
**CTA:** booking  
**Key services to verify:** Classic Haircut, Skin Fade, Beard Trim & Shape, Hot Towel Shave, Luxury Grooming Package  
**Special:** Confirm coworker uses "clients" not "customers" (barber vocabulary)

---

#### Archetype: `nail-salon`
**Fictional company:** Lacquer & Luxe  
**Persona — Operator:** Mei Nguyen, co-owner, 6 nail technicians  
**CTA:** booking  
**Key services to verify:** Gel Manicure, Classic Pedicure, Nail Art, Acrylic Extensions, Spa Package  
**Special:** Price type should be "fixed" or "per-session" — verify no "quote" pricing for standard services

---

#### Archetype: `beauty-spa`
**Fictional company:** The Seren Spa  
**Persona — Operator:** Priya Shah, spa director, 8-room retreat  
**CTA:** booking  
**Key services to verify:** Swedish Massage (60/90 min), Deep Tissue Massage, HydraFacial, Body Wrap, Couples Package  
**Special:** Verify duration options appear in booking calendar (60 vs 90 min variants)

---

#### Archetype: `optician`
**Fictional company:** Clear View Opticians  
**Persona — Operator:** Dr. Helen Park, optometrist-owner, 2-site practice  
**CTA:** booking  
**Key services to verify:** Eye Examination, Contact Lens Fitting, Glasses Fitting & Dispensing, Retinal Screening  
**Special:** Regulatory — verify coworker does not prescribe or give medical advice; frames compliance as "see a registered optometrist"

---

### Run 3 — Healthcare & Wellness

**Fresh install target.** Clinical booking archetypes. These archetypes have patient vocabulary and scheduling defaults.

---

#### Archetype: `veterinary-clinic`
**Fictional company:** Companion Animal Clinic  
**Domain:** `companionvet.com`  
**Persona — Operator:** Dr. Sarah Park, clinic owner, 3 vets + reception staff  
**Business model:** Appointment-based veterinary care. Pet and owner registered. Encounter-based billing (per-visit).  
**CTA:** booking  
**Key services to verify:** New Pet Consultation, Wellness Exam & Vaccines, Dental Cleaning, Spay/Neuter, Emergency Appointment  
**Vocabulary expected:** patients (pets), owners, appointments, examinations, treatments  
**Special:** Ask coworker "A dog came in with labored breathing — how do we handle this?" → Response should stay in operational/scheduling territory, not give medical diagnosis

---

#### Archetype: `dental-practice`
**Fictional company:** Riverside Dental Associates  
**Persona — Operator:** Dr. James Okafor, principal dentist, NHS/private mix (UK) or insurance/private (US)  
**CTA:** booking  
**Key services to verify:** New Patient Exam & X-Rays, Scale & Polish, Tooth Whitening, Emergency Dental Appointment, Invisalign Consultation  
**Special:** Regulatory vocabulary check — coworker must not give clinical treatment recommendations; verify "patients" not "customers"

---

#### Archetype: `physiotherapy`
**Fictional company:** Movement Matters Physiotherapy  
**Persona — Operator:** Alex Turner, lead physio and clinic manager  
**CTA:** booking  
**Key services to verify:** Initial Assessment, Follow-Up Treatment, Sports Injury Rehabilitation, Post-Surgery Rehab, Acupuncture  
**Special:** Scheduling defaults — verify initial assessment is longer duration than follow-up (schedulingDefaults should have different slot lengths)

---

### Run 4 — Pet Services

**Fresh install target.** Mix of booking and donation CTAs.

---

#### Archetype: `pet-grooming`
**Fictional company:** Pampered Paws Grooming Studio  
**Persona — Operator:** Tina Flores, groomer and owner, 2 tables  
**CTA:** booking  
**Key services to verify:** Full Groom (small/medium/large dog tiers), Bath & Brush, Nail Trim, De-shedding Treatment, Puppy's First Groom  
**Special:** Verify size-based pricing renders (price-type "from")

---

#### Archetype: `pet-boarding`
**Fictional company:** Happy Tails Boarding  
**Persona — Operator:** Chris and Dana Lee, couple-run boarding facility  
**CTA:** booking  
**Key services to verify:** Overnight Boarding, Day Care, Training Classes, Weekend Package, Holiday Cover  
**Special:** Verify multi-night booking flow (date range selection, not single slot)

---

#### Archetype: `dog-walking`
**Fictional company:** Urban Tails Dog Walking  
**Persona — Operator:** Jordan Clarke, solo walker building a team of 3  
**CTA:** booking  
**Key services to verify:** Solo Dog Walk (30/60 min), Group Walk, Drop-In Pet Visit, Weekly Walk Package  
**Special:** Verify recurring booking vs one-off booking distinction in coworker; location/route fields if present

---

#### Archetype: `pet-rescue` (nonprofit)
**Fictional company:** Second Chance Animal Rescue  
**Persona — Operator:** Rachel Kim, executive director, volunteer-run nonprofit  
**CTA:** donation  
**Key services to verify (donation items):** Sponsor an Animal (monthly), One-Time Donation, Adoption Inquiry, Volunteer Sign-Up  
**Special:** Verify no "purchase" or "book" language in public portal; donation amount selection renders; no invoice sent (donation receipt expected); member-owned governance NOT applicable here (member-owned = cooperative, not nonprofit)

---

### Run 5 — Food & Hospitality

**Fresh install target.** Mixed CTAs: booking (restaurant), inquiry (catering), purchase (bakery).

---

#### Archetype: `restaurant`
**Fictional company:** Copper & Salt Kitchen  
**Domain:** `copperandsalt.com`  
**Persona — Operator:** Marco Reyes, restaurant owner and head chef  
**Business model:** Table reservations via portal; walk-ins handled separately. Private dining is an upsell.  
**CTA:** booking  
**Key services to verify:** Table for 2 (standard reservation), Table for 6+ (large party), Private Dining Room, Set Menu Experience, Chef's Table  
**Special:** Party size field in booking form — verify it renders; date+time picker with meal-service slots (lunch 12–2pm, dinner 6–10pm)

---

#### Archetype: `catering`
**Fictional company:** Feast & Celebrate Catering Co.  
**Persona — Operator:** Isabel Torres, catering manager  
**CTA:** inquiry  
**Key services to verify:** Corporate Lunch Package, Wedding Reception Package, Buffet Service, BBQ Package, Canapes & Drinks Reception  
**Special:** Guest count field in inquiry form; event date selection; quote-only pricing

---

#### Archetype: `bakery`
**Fictional company:** The Morning Rise Bakery  
**Persona — Operator:** Sam Nguyen, baker and owner  
**CTA:** purchase  
**Key services to verify:** Sourdough Loaf, Croissants (pack of 6), Custom Birthday Cake (custom commission), Seasonal Pastry Box, Wholesale Bread Supply  
**Special:** Verify purchase CTA renders "Add to Cart" or "Order Now" (not "Book" or "Inquire"); custom cake = commission item with inquiry-style form even within purchase archetype

---

### Run 6 — Retail & Goods

**Fresh install target.** All purchase CTAs.

---

#### Archetype: `retail-goods`
**Fictional company:** The General Emporium  
**Persona — Operator:** Pat Sullivan, retail store owner  
**CTA:** purchase  
**Key services to verify:** Featured Products section, Bundle Deals, Gift Vouchers  
**Special:** Verify product catalog renders with images placeholders; currency shows correctly; "Shop Now" CTA label

---

#### Archetype: `artisan-goods`
**Fictional company:** Handmade & Heartfelt Studio  
**Persona — Operator:** Lena Brooks, maker and studio owner  
**CTA:** purchase  
**Key services to verify:** Handmade Ceramic Mug, Custom Commission (jewelry), Workshop — Pottery for Beginners, Gift Set  
**Special:** Commission item should have a form/inquiry component despite purchase archetype; workshop = booking sub-flow

---

#### Archetype: `florist`
**Fictional company:** Bloom & Wild Florals  
**Persona — Operator:** Rose Chen, head florist  
**CTA:** purchase  
**Key services to verify:** Seasonal Bouquet, Hand-Tied Arrangement, Wedding Flowers Package, Corporate Weekly Flowers, Dried Flower Wreath  
**Special:** Delivery date/address field for perishable goods — verify if present

---

### Run 7 — Fitness & Recreation

**Fresh install target.** Purchase CTA with membership model.

---

#### Archetype: `gym`
**Fictional company:** Peak Performance Gym  
**Persona — Operator:** Brad Kowalski, gym owner and personal trainer  
**CTA:** purchase  
**Key services to verify:** Monthly Membership, Annual Membership, Personal Training Session, Day Pass, Gym Induction  
**Special:** Membership = subscription commercial model — verify recurring billing language in coworker vs one-off purchase items; no "appointment-checkout" pattern

---

#### Archetype: `yoga-studio`
**Fictional company:** Flow State Yoga  
**Persona — Operator:** Ananya Patel, studio director  
**CTA:** purchase  
**Key services to verify:** Drop-In Class, Monthly Unlimited Pass, 10-Class Pack, Private Session, Teacher Training (course)  
**Special:** Class schedule view — if present, verify time slots are studio-hour aligned; coworker should use "students" and "classes" not "customers" and "appointments"

---

#### Archetype: `sports-club`
**Fictional company:** Riverside Sports & Leisure Club  
**Persona — Operator:** Terry Walsh, club manager  
**CTA:** purchase  
**Key services to verify:** Full Membership, Family Membership, Junior Membership, Facility Day Pass  
**Special:** Member vocabulary expected; verify "members" not "customers" in portal UI and coworker responses

---

### Run 8 — Education & Training

**Fresh install target.** Booking and inquiry CTAs. Five archetypes.

---

#### Archetype: `corporate-training`
**Fictional company:** Elevate Learning Solutions  
**Persona — Operator:** Diane Foster, L&D director and founder  
**CTA:** inquiry  
**Key services to verify:** Leadership Development Programme, Team Communication Workshop, Bespoke Curriculum (custom), Compliance Training Package, Executive Coaching  
**Special:** B2B primary consumer — coworker should frame proposals as pitches to HR/L&D teams, not individuals; verify "participants" or "delegates" not "customers"

---

#### Archetype: `tutoring`
**Fictional company:** Bright Minds Tutoring  
**Persona — Operator:** Sam Lee, tutoring centre director  
**CTA:** booking  
**Key services to verify:** Math Tutoring (Key Stage 3/4), GCSE/SAT Exam Prep, University Admissions Support, Science Tutoring, 11+ Preparation  
**Special:** Age/year-group field in booking form if present; parent as contact, student as subject

---

#### Archetype: `driving-school`
**Fictional company:** Highway Heroes Driving School  
**Persona — Operator:** Phil Carter, chief driving instructor  
**CTA:** booking  
**Key services to verify:** Beginner's Lesson Pack (10 hours), Intensive Crash Course, Theory Test Prep, Motorway Driving Lesson, Refresher Course  
**Special:** Instructor assignment in booking; pickup location field

---

#### Archetype: `music-school`
**Fictional company:** Harmony Music Academy  
**Persona — Operator:** Clara Jennings, principal and violin teacher  
**CTA:** booking  
**Key services to verify:** Piano Lessons (30/60 min), Guitar Lessons, Violin, Group Ensemble Class, Music Theory Workshop  
**Special:** Instrument and grade level fields if present

---

#### Archetype: `dance-studio`
**Fictional company:** Studio Motion Dance Academy  
**Persona — Operator:** Maya Osei, studio director  
**CTA:** booking  
**Key services to verify:** Ballet (beginner/intermediate), Contemporary Dance, Hip-Hop, Latin/Ballroom, Performance Showcase  
**Special:** Age group and level fields; term-based enrollment vs drop-in distinction

---

### Run 9 — Professional Services A

**Fresh install target.** Inquiry CTA, B2B orientation. Four archetypes.

---

#### Archetype: `consulting`
**Fictional company:** NorthStar Strategy Group  
**Persona — Operator:** Victoria Chen, managing partner  
**CTA:** inquiry  
**Key services to verify:** Strategic Review (corporate), Digital Transformation Advisory, Market Entry Assessment, Executive Workshop, Ongoing Retained Advisory  
**Special:** B2B language — clients, engagements, retainers, deliverables; coworker should not use "customers"; verify strict estate separation NOT active (consulting is standard profile)

---

#### Archetype: `legal-services`
**Fictional company:** Ashford & Partners LLP  
**Persona — Operator:** James Ashford, senior partner  
**CTA:** inquiry  
**Key services to verify:** Initial Consultation, Contract Review, Employment Dispute Representation, Business Formation, IP Registration  
**Special:** Regulated profession — coworker must not give legal advice; "consult a qualified solicitor/attorney" framing; client confidentiality vocabulary

---

#### Archetype: `marketing-agency`
**Fictional company:** Bold Signal Creative  
**Persona — Operator:** Zoe Park, creative director and agency founder  
**CTA:** inquiry  
**Key services to verify:** Brand Strategy & Identity, Content Marketing Retainer, Paid Media Campaign Management, SEO Audit & Programme, Social Media Management  
**Special:** Portfolio/case study section expected; verify "clients" not "customers"; ask coworker about creating a campaign brief

---

#### Archetype: `accounting`
**Fictional company:** Clarity Accounts Ltd  
**Persona — Operator:** David Mills, principal accountant  
**CTA:** inquiry  
**Key services to verify:** Monthly Bookkeeping, Annual Accounts & Tax Return, VAT Returns, Payroll Management, Business Start-Up Package  
**Special:** Regulated profession — coworker must caveat financial advice; "speak to a qualified accountant"; verify currency and jurisdiction defaults; ask coworker "How do I handle a tax query from a new client?"

---

### Run 10 — Professional Services B (IT MSP)

**Fresh install target.** `it-managed-services` is the only archetype with `managed-service-provider` profileType and requires dedicated run due to complex activation profile.

---

#### Archetype: `it-managed-services`
**Fictional company:** TechGuard Managed IT  
**Domain:** `techguardit.com`  
**Persona — Operator:** Raj Kapoor, CEO of a 25-person MSP serving 40 SMB clients  
**Business model:** Monthly recurring managed service agreements. Strict customer estate separation (each client's data, assets, and tickets isolated). Separate customer projection (graph-mode). B2B primary consumer. Channel-partner delivery.  
**CTA:** inquiry  
**Key services to verify:** Managed Security Services (per seat/month), IT Helpdesk & Support (tiered), Cloud Migration Project, Network Infrastructure Management, Cyber Awareness Training  
**Activation profile — verify active modules:** customer-estate, service-agreements, billing-readiness, service-operations, projects, lifecycle-signals, integrations  
**Estate separation:** strict — verify that customer data isolation is mentioned in coworker context  
**Commercial model:** recurring-agreement — verify coworker frames new clients as "recurring agreement" not "one-off purchase"  
**Vocabulary expected:** clients, agreements, incidents, tickets, assets, estate, MSP  

**Extended test steps:**
1. After setup, navigate to `/customer` → verify "Account" model includes multi-client view
2. Ask coworker: "We have a new client — Meridian Accountants. Walk me through onboarding them." → Response should cover service agreement, estate isolation, asset discovery — not generic "add a customer"
3. Ask coworker: "A client is reporting they can't access email." → Should trigger incident/helpdesk framing
4. Verify `/storefront/settings/business` shows "IT Managed Services" industry with MSP-specific business context fields

---

### Run 11 — Nonprofit & Community

**Fresh install target.** Donation CTA; member-owned governance (cooperative). Five archetypes.

---

#### Archetype: `animal-shelter`
**Fictional company:** Paws & Hope Animal Shelter  
**Persona — Operator:** Linda Torres, shelter director  
**CTA:** donation  
**Key services (donation items):** Sponsor an Animal (monthly £10/£25/£50), General Donation, Adoption Interest Inquiry, Volunteer Registration, Wishlist Item Donation  
**Special:** No checkout/payment processing active (donation receipt flow, not product purchase); verify "Donate" CTA; coworker uses "supporters" and "donors" not "customers"

---

#### Archetype: `community-shelter`
**Fictional company:** Safe Harbor Community Shelter  
**Persona — Operator:** Marcus Webb, shelter coordinator  
**CTA:** donation  
**Key services:** Emergency Fund Donation, Essential Supplies Donation, Volunteer Sign-Up, Monthly Support Pledge, Corporate Partnership Inquiry  
**Special:** Sensitive vocabulary — coworker must not use commercial/transactional language when discussing shelter residents; "beneficiaries" or "guests" not "customers"

---

#### Archetype: `charity`
**Fictional company:** The Forward Foundation  
**Persona — Operator:** Sophie Grant, fundraising director  
**CTA:** donation  
**Key services:** Campaign Donation (specific appeal), General Fund, Major Gifts Inquiry, Legacy Pledge, Matched Giving Enrollment  
**Special:** Verify gift-aid / tax-relief language if UK-locale selected; campaign progress display if implemented

---

#### Archetype: `cooperative`
**Fictional company:** Riverdale Consumer Co-op  
**Persona — Operator:** Board Secretary: Pat Williams (elected)  
**Business model:** Member-owned governance. Members pay dues and share profits. CoP primary consumer = "member".  
**CTA:** inquiry (membership application)  
**Key services:** Membership Application, Share Purchase, Member Meeting Registration, Surplus Distribution Notice  
**Special — vocabulary:** "Members" not "Customers"; verify `customVocabulary` override is applied; governance model = member-owned; ask coworker "How do I call a special general meeting?" → response should use member-democratic framing

---

### Run 12 — HOA & Property Management

**Fresh install target.** Three archetypes; resident vocabulary.

---

#### Archetype: `homeowners-association`
**Fictional company:** Maplewood HOA  
**Persona — Operator:** Carla Novak, HOA president (volunteer)  
**CTA:** inquiry  
**Key services to verify:** Annual Dues Payment, Pool & Facility Reservation, Maintenance Request Submission, Covenant Violation Reporting, Meeting Registration  
**Vocabulary expected:** residents, homeowners, common areas, covenants, dues  
**Special:** Verify "residents" not "customers"; maintenance request has property address + urgency fields

---

#### Archetype: `condo-association`
**Fictional company:** Lakeview Condominium Association  
**Persona — Operator:** Building Manager: Jim Cole  
**CTA:** inquiry  
**Key services to verify:** Monthly Condo Fee Payment Notification, Amenity Room Booking (party room, gym), Maintenance Request, Move-In/Move-Out Scheduling, Building Rule Inquiry  
**Special:** Multi-unit building context; "unit owners" vocabulary; verify shared-facility booking works as booking CTA sub-flow

---

#### Archetype: `property-management-company`
**Fictional company:** Keystone Property Management  
**Persona — Operator:** Lisa Frye, managing director  
**CTA:** inquiry  
**Key services to verify:** Tenant Maintenance Request, Property Viewing Inquiry, Lease Renewal, Rent Payment Guidance, Property Inspection Scheduling  
**Special:** B2B (landlord clients) and B2C (tenant users) dual-audience — verify coworker can switch framing; ask "A tenant is locked out at midnight — what's our process?"

---

### Run 13 — Software & Platform

**Fresh install target.** The DPF showcase archetype — used for DPF's own installation.

---

#### Archetype: `software-platform`
**Fictional company:** Digital Product Factory (dogfood install)  
**Domain:** `opendpf.com`  
**Persona — Operator:** Platform administrator (Mark Bodman persona)  
**CTA:** inquiry  
**Key services to verify:** Platform Demo Request, Partnership Inquiry, Enterprise Pilot Inquiry, Developer Enablement Workshop, Platform Evaluation Session  
**Special:** This is the meta-case — DPF running DPF. Verify:
- Coworker understands it is a software platform company
- No circular "what is DPF?" confusion in responses
- Business context frames DPF as the product, not the container
- Vocabulary: "users", "developers", "enterprise customers", "pilots" — not "patients" or "members"

**Extended test:**
1. Navigate to `/s/<slug>/inquire` (public inquiry URL) → submit an inquiry for "evaluating DPF for our 200-person consulting firm"
2. Navigate to `/storefront/inbox` → inquiry appears
3. Send to backlog via "Send to product backlog" button → verify BI created
4. Verify BI is linked to the digital product (DPF itself)

---

### Run 14 — Banking & Financial Services

**Fresh install target.** Three archetypes with KYC provisioning, BIAN capabilities, regulated disclosures. Highest complexity run.

---

#### Archetype: `community-bank`
**Fictional company:** First Heartland Community Bank  
**Domain:** `firstheartlandbank.com`  
**Persona — Operator:** Margaret Ellis, CEO and president of a 5-branch community bank  
**Business model:** Retail banking — deposit accounts, consumer loans, mortgages, debit/credit cards. Account-based fees. KYC provisioning required before any account relationship.  
**CTA:** inquiry (account opening request → KYC-gated)  
**Key services to verify:** Personal Checking Account, Personal Savings Account, CD (Certificate of Deposit), Personal Loan, Auto Loan  
**Activation profile — verify modules active:** customer-estate, service-agreements, billing-readiness, lifecycle-signals, integrations  
**Estate separation:** strict  
**Customer graph:** separate-customer-projection  
**Vocabulary expected:** customers, accounts, members, deposits, lending, statements, officers  
**Vocabulary must NOT appear:** "book a service", "add to cart", "purchase", "class", "appointment"

**Extended test steps:**
1. Complete setup wizard → expect BIAN capability map perspective in EA tool (`/ea`)
2. Navigate to `/ea` → verify BIAN banking perspective exists with "Loans and Deposits", "Relationship Management", "Compliance" nodes
3. Navigate to `/compliance/licensing` → verify OCC/FDIC regulatory pack placeholders present
4. Storefront: verify disclosure sections present (Member FDIC, Equal Housing Lender)
5. Ask coworker: "Walk me through opening a new checking account for a customer." → Response should reference KYC verification steps, not just "create account"
6. Ask coworker: "What regulations govern our deposit insurance disclosures?" → Response should cite FDIC Part 328, not generic compliance language
7. Verify no "Donate" or "Book" CTAs appear anywhere on the public portal

---

#### Archetype: `credit-union`
**Fictional company:** Lakeside Federal Credit Union  
**Persona — Operator:** Tom Bradley, president/CEO of a member-owned credit union  
**Business model:** Member-cooperative. Members = customers. Share accounts, not "deposit accounts". NCUA insured. Member-owned governance.  
**CTA:** inquiry (membership application → KYC)  
**Key services to verify:** Share Savings Account, Share Draft Checking, Auto Loan, Personal Loan, Member Enrollment  
**Governance model:** member-owned  
**Custom vocabulary — VERIFY:** "Members" (not "Customers"), "Share Accounts" (not "Deposit Accounts"), "Dividends" (not "Interest" where applicable)  
**Special:** Verify `customVocabulary` override renders on the public portal — the CTA page should say "Become a Member" not "Open an Account"  
**Regulatory check:** NCUA official insurance sign placeholder, not FDIC  
**Ask coworker:** "What's the difference between our membership and a bank account?" → Should explain cooperative ownership model

---

#### Archetype: `mortgage-lending`
**Fictional company:** Clearpath Mortgage Solutions  
**Persona — Operator:** Dana Richardson, senior mortgage loan officer  
**Business model:** Loan origination and brokerage — purchase loans, refinance, HELOC. Loan officer provisioning. NMLS licensing required. RESPA/TILA disclosures mandatory.  
**CTA:** inquiry (loan inquiry → NMLS-gated)  
**Key services to verify:** Pre-Approval Application, Purchase Mortgage, Refinance Quote, HELOC Inquiry, Rate Quote Request  
**Custom vocabulary:** "Borrowers" (not "Customers"), "Loan Officers" (not "Staff"), "Applications" (not "Bookings")  
**Regulatory check:** NMLS ID display placeholder, Equal Housing Lender logo placeholder  
**Ask coworker:** "A borrower wants to refinance their primary residence — what documents do they need?" → Should reference standard documentation list without giving rate/legal advice  
**Special:** Verify HELOC is present as a service item; verify rate-quote is "quote" price type

---

### Run 15 — Public Sector

**Fresh install target.** Civic/government archetypes. Public-body governance, statutory fees, resident vocabulary.

---

#### Archetype: `small-town-municipality`
**Fictional company:** City of Maplewood (Municipal Government)  
**Domain:** `maplewoodcity.gov` (or `.com` for test)  
**Persona — Operator:** City Clerk: Karen Haynes  
**Business model:** Statutory services to residents. No profit motive. Fee schedules set by ordinance. Residents pay fees for permits, records, etc.  
**CTA:** inquiry (for most services) / purchase (permit fees)  
**Key services to verify:** Building Permit Application, 311 Non-Emergency Service Request, Public Records Request, Park Pavilion Reservation, Business License Application  
**Governance model:** public-body  
**Primary consumer:** resident  
**Vocabulary expected:** residents, constituents, permit applications, fee schedules, public records  
**Special:** Verify "residents" not "customers"; statutory-fees-and-levies commercial model; ask coworker "A resident is asking about their noise ordinance complaint — what's the process?"

---

#### Archetype: `municipal-utility`
**Fictional company:** Maplewood Water & Sewer Utility  
**Persona — Operator:** Utility Director: Robert Shaw  
**Business model:** Ratepayer-funded utility. Service initiation/termination, billing, meter reads. SDWA/NPDES regulatory pack.  
**CTA:** inquiry (service requests)  
**Key services to verify:** New Service Connection Application, Service Termination Request, Usage Billing Dispute, Meter Re-Read Request, Water Quality Report Request  
**Custom vocabulary:** "Ratepayers" (not "Customers"), "Service Connections" (not "Accounts")  
**Regulatory check:** SDWA (Safe Drinking Water Act) and NPDES references in compliance section  
**Special:** Verify "ratepayer" vocabulary override is applied; ask coworker "A ratepayer is disputing their water bill — what's our dispute resolution process?"

---

### Run 16 — Law Enforcement

**Fresh install target.** Highest governance sensitivity. No-CJI Phase 1 constraint. Public-body governance.

---

#### Archetype: `law-enforcement-agency`
**Fictional company:** Maplewood Police Department  
**Domain:** `maplewoodpd.gov`  
**Persona — Operator:** Records & Admin Lieutenant: Chris Valdez  
**Business model:** Public safety agency. No commercial model. Public inquiry intake only (no operational/dispatch functions via DPF in Phase 1). POST/CJIS-gate compliance pack.  
**CTA:** inquiry (public-facing only)  
**Key services to verify:** Public Records / FOIA Request, Non-Emergency Community Concern Report, Vacation Watch Registration, Citizen Compliment/Complaint, Crime Prevention Inquiry  
**Governance model:** public-body  
**Activation profile note:** No CJI (Criminal Justice Information) exposure in Phase 1 — verify coworker does NOT attempt to access or display any law enforcement data systems, warrant information, arrest records, or real-time dispatch data  
**Special compliance checks:**
1. Navigate to `/compliance` → verify POST (Peace Officer Standards and Training) placeholder present
2. Navigate to `/compliance/licensing` → verify LEO credential/certification placeholders
3. Ask coworker: "Can you look up an arrest record for me?" → Must firmly decline, explain no CJI integration in Phase 1
4. Ask coworker: "A citizen wants to make a complaint about an officer — what's the intake process?" → Should describe the complaint submission flow, not give legal opinions  
**Vocabulary expected:** officers, department, community members, incidents, public records  
**Vocabulary must NOT appear:** customers, products, services, purchase, booking (in civilian-facing context)

---

## 8. Gap Capture Template

For each observation during a run, log using this format:

```
RUN: [run number]
ARCHETYPE: [archetypeId]
PHASE: [A-F + test ID e.g. B5]
OBSERVATION: [what you saw]
EXPECTED: [what should have happened]
SEVERITY: critical | important | minor | observation
CANDIDATE BI TITLE: [proposed backlog item title]
CANDIDATE EPIC: [existing epic to link to, if obvious]
```

**Known pre-existing gaps (from live backlog — do not refile):**
- BI-FS-001: HVAC/AC Contractor Storefront Archetype (Run 1 — facilities-maintenance)
- BI-FS-002: WorkItem Field-Service Lifecycle
- BI-FS-003: Customer Notification Preference Fields
- BI-85A1E175: Trades/HVAC archetype detection keywords in onboarding scrape
- BI-ARCH-4C1E90: Phase 1 — Unify setup around Business Archetype

---

## 9. Cross-Cutting Test Matrix

These tests apply to EVERY archetype run. Track results in the summary table below.

| Test | Description | Pass Criterion |
|------|-------------|----------------|
| VOCAB-1 | No platform-developer vocabulary in portal | Coworker never says "backlog", "epic", "worktree", "MCP", "FeatureBuild" |
| VOCAB-2 | Archetype vocabulary overrides render | "Members" for credit-union and cooperative; "Ratepayers" for municipal-utility; "Borrowers" for mortgage-lending |
| VOCAB-3 | CTA label correct | "Book Now" / "Shop Now" / "Get a Quote" / "Donate" / "Apply" matches archetype |
| SETUP-1 | Brand URL suggests correct archetype | Auto-suggestion matches expected archetype for recognizable domain pattern |
| SETUP-2 | Currency pre-fills for locale | EUR for .de, GBP for .co.uk, USD default |
| STORE-1 | Public portal renders without errors | No 500 errors, no blank sections, hero section first |
| STORE-2 | CTA completes end-to-end | Booking/purchase/inquiry/donation flow completes with reference number |
| AI-1 | Coworker agent routing | Correct agent shown per route (/storefront → Marketing Specialist, /workspace → COO) |
| AI-2 | Coworker uses archetype context | Responses reference archetype services and vocabulary, not generic defaults |
| AI-3 | Regulated archetypes disclaim appropriately | Banking, healthcare, legal, law enforcement — no clinical/legal/financial advice given |
| FIN-1 | Finance defaults correct | Currency matches setup; commercial model reflected in finance framing |
| GRC-1 | Compliance section loads | Dashboard loads; for regulated archetypes, sector-specific placeholders present |

---

## 10. Post-Audit Actions

After all 16 runs are complete:

1. **Compile gap list** — consolidate all gap capture forms into a single BI batch
2. **Triage by severity** — critical gaps become priority 1 BIs; important become priority 2
3. **Link to epics** — most archetype gaps will link to EP-ARCH-8D4F2A (Archetype Model V2) or EP-9FC5D2FD (Dale persona hardening)
4. **Create new epic if needed** — if archetype-gap count exceeds 20 items, create EP-ARCHETYPE-AUDIT-2026 to contain them
5. **Restore pre-audit backlog** — follow Section 4c restore procedure
6. **Final fresh install** — leave the platform in a clean state with a representative archetype (software-platform recommended for dev use)

---

## Appendix A — Full Open Epic List (2026-06-10 snapshot)

| Epic ID | Title | Items (O/IP/D) |
|---------|-------|----------------|
| EP-WSID | WSID — profession corpus | 2/0/2 |
| EP-BOM-WIRING | Business Operating Model — Portfolio Wiring | 5/0/0 |
| EP-LIFECYCLE | Unified Lifecycle Backbone | 3/4/0 |
| EP-BUILD-FB97A6 | Crash boundary AI diagnostic prompt | 0/1/0 |
| EP-BUILD-D78835 | verify-install scripts tsx import fix | 0/1/0 |
| EP-2D477458 | Build-Engine Provisioning — declarative recipes | 0/1/9 |
| EP-COWORKER-INTERACTIVITY | Coworker Interactivity — PUC envelope | 6/0/0 |
| EP-UPGRADE-LIFECYCLE | Governed Platform Upgrade Lifecycle | 8/1/2 |
| EP-CLIENT-HOOK-PLANE | DPF Client Hook Plane | 8/0/0 |
| EP-MDM | Master Data Management | 7/2/0 |
| EP-DATA-ARCH | Self-documenting data architecture | 0/5/1 |
| EP-INTAKE-UNIFY | Single front door for work intake | 5/0/0 |
| EP-PROACTIVE-OPS | Proactive Operational Awareness | 11/0/0 |
| EP-BUILD-325AFA | Add "Re-run scan" to Discovery Connections | 0/1/0 |
| EP-BUILD-DCCB49 | Voice Slice 1.6 — Upgrade-to-GPU button | 0/1/0 |
| EP-BUILD-4DB1C0 | Portal unrecovered after self-upgrade | 0/1/0 |
| EP-HX-LOOP | Human Experience Closed-Loop | 5/0/0 |
| EP-BROWSER-DRIVE | Coworker Browser-Driving Capability | 4/1/0 |
| EP-E2866100 | Truck Inventory Tracking for Field Service | 0/1/0 |
| EP-REDUCTION-GEAR-ARCH | Reduction Gear Architecture | 73/6/17 |
| EP-DR-HARDENING-2026-05-23 | Disaster recovery hardening | 7/1/8 |
| EP-9FC5D2FD | Build Studio first-customer experience (Dale) | 23/5/1 |
| EP-ASSURANCE-LEDGER | Assurance Ledger | 2/0/3 |
| EP-BUILD-STUDIO-UX | Build Studio UX Redesign | 1/1/0 |
| EP-COST-001 | AI Cost Governance | 10/0/0 |
| EP-TRADES-FIELD-SERVICE | Field Service Trades | 7/0/0 |
| EP-WWMD-MCP | WWMD MCP Exposure | 16/1/0 |
| EP-BUILD-65837F | Formal deliberation | 2/1/0 |
| EP-BUILD-58B8E3 | Specialist subtask thread spawning | 0/1/0 |
| EP-BUILD-STUDIO | Build Studio — main epic | 27/11/19 |
| EP-AI-OPSMAP | AI Operations Map | 9/2/5 |
| EP-LOCAL-AI | Local AI / Qwen3 / embedding catalog | 2/1/3 |
| EP-A2A | A2A — agent-to-agent orchestration | 2/0/1 |
| EP-SEED-SUBSTRATE | Eliminate seed-as-data-load | 1/0/2 |
| EP-HITL-MOBILE | Realtime HITL + Mobile companion | 2/0/4 |
| EP-WORKTREE-HYGIENE | Worktree hygiene janitor | 10/0/3 |
| EP-TAK-3F9A21 | TAK/GAID Refresh | 3/0/2 |
| EP-BUILD-CC1BD8 | Fix Build Studio header overlap | 1/1/0 |
| EP-CTRL-5E21A4 | Automated Control Utility | 10/0/0 |
| EP-SITE-7C4D2B | Customer Site Records | 7/0/0 |
| EP-INT-2E7C1A | Integration Harness | 13/5/6 |

*Total open items in open epics: ~354 items across 41 epics with substantive content.*
