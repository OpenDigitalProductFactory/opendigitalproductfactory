# Run 3 Fresh-Install Findings — Education & Training

**Run**: 3 (education-training, fresh-install fast-track pass)
**Archetypes tested**: tutoring *(complete)*, corporate-training *(complete)*, driving-school *(complete)*, music-school *(complete)*
**Run date**: 2026-06-12
**Method**: Tier 2 DB-only reset per archetype; golden dump `/tmp/golden.dump` (= `golden-provider-configured-2026-06-12.dump`); admin onboarding via `/setup`, then storefront wizard at `/storefront/setup`. Login note: the golden dump is captured in a *setup-incomplete* state, so each archetype begins by completing the `/setup` org+admin step (the documented "Phase A — Onboarding") rather than logging in at `/login`.
**Tester**: Autonomous agent

> **Baseline**: This run confirms (or refutes) the systemic findings catalogued in [run-2-fresh-findings.md](run-2-fresh-findings.md) and surfaces education-specific surprises. Recurring systemic findings are recorded as "🔁 Recurring (Nth confirmation)" without re-writing the full detail. Full detail is reserved for NEW findings.

---

## Run-level headline — education-training is a distinct portal family

Three structural facts hold across **all four** education-training archetypes and are the most important output of this run:

1. **Portal type is "Academy Portal", not "Booking Portal".** 🆕 Every education archetype renders an internal cockpit titled **Academy Portal** with the nav **Dashboard · Sections · Courses · Instructors · Enrolments · Settings** (the `/storefront/items`, `/storefront/team`, `/storefront/inbox` routes are re-labelled Courses / Instructors / Enrolments). This is a third portal-type label beyond Run 2's "Booking Portal" and "Patient Portal". Vocabulary fitness is **good** — education-appropriate language throughout.
2. **Financial model is Subscription + Recurring Required** for all four (not Appointment Checkout). 🆕 This matches the Run 2 optician pattern (subscription = internal billing only); storefront CTAs remain **service-type-driven** (Book Now / Buy / Enquire), not "Subscribe". Confirmed by driving real public flows.
3. **Item type drives the public CTA and the available flow**, and the four archetypes span the full matrix: Tutoring (all Booking), Music School (all Booking), Corporate Training (all Inquiry), Driving School (mixed Booking + Purchase). This exposed two NEW out-of-the-box breakages on Driving School (no provider → empty booking calendar; price-less Purchase items → 404 order page).

---

## Tutoring — Bright Minds Tutoring (fresh install)

**Company**: Bright Minds Tutoring · **Owner persona**: Liam Foster (test customer)
**URL slug**: bright-minds-tutoring (wizard-entered slug correctly preserved)
**Portal type**: Academy Portal · **Archetype**: tutoring

### Financial model
#### AUDIT-R3-TUT-A-001 · 🆕 Pass/Observation · Subscription + Recurring Required (correct for education)
**Observed**: Financial setup pre-selected Payment = **Subscription**, Recurring = **Required**, Invoices = "Prepared Not Prescribed". VAT = No. This is the education-family model (same as Run 2 optician), not Appointment Checkout. Subscription is internal billing only — public CTAs are Book Now (see B-003).

#### AUDIT-R3-TUT-A-002 · Important · GBP default currency on US install
🔁 Recurring (Run 2, 7th cumulative archetype). Base currency pre-filled "GBP - British Pound"; switched to USD manually. Fix #1759 ❌ not resolved.

### Portal creation
#### AUDIT-R3-TUT-B-001 · Important · Wizard-created portal starts Unpublished
🔁 Recurring. Dashboard showed Status: **Unpublished** with a Publish button after wizard completion; `/s/bright-minds-tutoring` accessible only after clicking Publish. No wizard prompt to publish.

#### AUDIT-R3-TUT-B-002 · Pass · Slug preserved; Academy Portal renders
**Observed**: Slug "bright-minds-tutoring" preserved exactly. Dashboard cards: 5 Sections · 5 Items · 0 Inquiries · 0 **Bookings** (Bookings card present).

### Service catalog
#### AUDIT-R3-TUT-P-001 · Pass · 5 courses seeded, all Booking type, matches preview
**Observed**: Courses tab (`/storefront/items`) lists 5 courses, all type **Booking**, `/hr` pricing: Maths Tutoring, English Tutoring, Science Tutoring, Exam Preparation, Online Session. Matches the template preview exactly. A default provider ("Bright Minds Tutoring", Active) is auto-created (booking works — see F-001).

### Public portal
#### AUDIT-R3-TUT-B-003 · Pass · Public portal renders with Book Now CTAs
**Observed**: `/s/bright-minds-tutoring` renders hero + 5 service cards, all **"Book Now"** — correct despite the Subscription billing model. Tutoring vocabulary throughout.

### Booking flow
#### AUDIT-R3-TUT-F-001 · Pass · Booking end-to-end works
**Observed**: Maths Tutoring → June 16 2026 → 10:00 AM (with "Bright Minds Tutoring") → Liam Foster / liam.foster@test.com → Confirm. Reference **BK-QSCKBSWK**. ✓

#### AUDIT-R3-TUT-F-002 · Important · Booking calendar timezone Europe/London
🔁 Recurring. Calendar showed "Times shown in Europe/London" after USD was selected.

#### AUDIT-R3-TUT-B-004 · Important · No tutoring-specific booking form fields
🔁 Recurring (fix #1760 ❌). Form is the 4 generic fields (Full name, Email, Phone, Notes) — no subject/level/exam-board fields.

### Inbox
#### AUDIT-R3-TUT-I-001 · Critical · DPF meta-language in inbox
🔁 Recurring (fix #1752 ❌). The "Enrolments" tab routes to `/storefront/inbox` and shows the "Customer-zero inquiry intake is wired to product backlog triage … Send to product backlog" banner. Booking BK-QSCKBSWK present (pending, Confirm/Cancel actions). ✓

### Tutoring — Summary
| Check | Finding | Severity | Verdict |
|-------|---------|----------|---------|
| Financial | Subscription + Recurring Required | Pass | 🆕 correct (education model) |
| Financial | GBP default currency | Important | 🔁 #1759 not resolved |
| Portal | Academy Portal; Unpublished on create | Important | 🔁 unpublished recurring |
| Catalog | 5 courses, all Booking, matches preview | Pass | ✓ |
| Public | Book Now CTAs render | Pass | ✓ |
| Booking | End-to-end works (BK-QSCKBSWK) | Pass | ✓ |
| Booking | Calendar timezone Europe/London | Important | 🔁 recurring |
| Booking | No tutoring-specific form fields | Important | 🔁 #1760 not resolved |
| Inbox | DPF meta-language banner | Critical | 🔁 #1752 not resolved |

---

## Corporate Training — Apex Corporate Training (fresh install)

**Company**: Apex Corporate Training · **Owner persona**: Rachel Green (test customer)
**URL slug**: apex-corporate-training · **Portal type**: Academy Portal · **Archetype**: corporate-training

### Financial model
#### AUDIT-R3-CORP-A-001 · 🆕 Pass/Observation · Subscription + Recurring Required
**Observed**: Same education-family model — Payment = Subscription, Recurring = Required. GBP default (🔁 Recurring, #1759 ❌; switched to USD).

### Service catalog & model
#### AUDIT-R3-CORP-P-001 · 🆕 Important/Observation · Inquiry-only archetype — all services are Inquiry type, no booking flow
**Observed**: All 6 seeded courses are type **Inquiry** (not Booking): Leadership Training, Team Building, Technical Skills Training, Communication & Presentation, Compliance Training, Bespoke Programme Design. Pricing shows **Quote / "From…" / POA** (price on application). The dashboard shows **0 Inquiries** and has **no Bookings card** (cards: 5 Sections · 6 Items · 0 Inquiries). The "Enquire Now" section (vs Tutoring's "Book a Trial Session") matches.
**Impact / classification**: This is a **by-design archetype variant**, not a defect — corporate training is consultative/quote-based, so a calendar booking flow is intentionally absent. Flagged per the run brief's "financial-model anomaly check" so reviewers know the standard booking checklist does not apply here.

### Public portal & inquiry flow
#### AUDIT-R3-CORP-B-001 · Pass · Public portal renders with Enquire CTAs
**Observed**: `/s/apex-corporate-training` renders 6 cards, all **"Enquire"** CTA, "POA" pricing. Correct for the inquiry model.

#### AUDIT-R3-CORP-F-001 · Pass · Inquiry flow works end-to-end
**Observed**: Enquire → "Enquire about Leadership Training" form (Your name, Email, Phone, Message) → Rachel Green / rachel.green@test.com / "Interested in leadership training for 12 managers." → Send Enquiry. Reference **INQ-3KK7EGDQ** (type=inquiry). ✓

#### AUDIT-R3-CORP-B-002 · Important · Portal starts Unpublished
🔁 Recurring.

### Inbox
#### AUDIT-R3-CORP-I-001 · Critical · DPF meta-language in inbox; inquiry record carries "Customer-zero signal" badge
🔁 Recurring (#1752 ❌). Banner present. Inquiry INQ-3KK7EGDQ shown with a **"Customer-zero signal"** badge on the record itself plus a "Send to product backlog" action — the operator-hostile DPF-internal language appears on the record, not just the header.

### Corporate Training — Summary
| Check | Finding | Severity | Verdict |
|-------|---------|----------|---------|
| Financial | Subscription + Recurring Required | Pass | 🆕 education model |
| Financial | GBP default currency | Important | 🔁 #1759 not resolved |
| Catalog | All 6 services Inquiry type (no booking) | Important | 🆕 inquiry-only variant (by design) |
| Public | Enquire CTAs render | Pass | ✓ |
| Inquiry | End-to-end works (INQ-3KK7EGDQ) | Pass | ✓ |
| Portal | Unpublished on create | Important | 🔁 recurring |
| Inbox | DPF meta-language + "Customer-zero signal" | Critical | 🔁 #1752 not resolved |

---

## Driving School — Safe Drive Academy (fresh install)

**Company**: Safe Drive Academy · **Owner persona**: (booking/order attempted; both flows broken)
**URL slug**: safe-drive-academy · **Portal type**: Academy Portal · **Archetype**: driving-school

### Financial model
#### AUDIT-R3-DRV-A-001 · Pass/Observation · Subscription + Recurring Required; GBP default
🆕 education model. 🔁 GBP recurring (#1759 ❌; switched to USD).

### Service catalog
#### AUDIT-R3-DRV-P-001 · Pass · 6 services, mixed Booking + Purchase, matches preview
**Observed**: Courses tab shows 6 services: **1-Hour Lesson** (Booking), Block of 10 Lessons (Purchase), Intensive Week Course (Purchase), Theory Test Preparation (Purchase), Pass Plus (Purchase), **Motorway Lesson** (Booking). Most carry **no price** (price column shows "—"). Dashboard cards: 5 Sections · 6 Items · 0 Inquiries · 0 **Orders** (Orders card present; no Bookings card).

### Public portal
#### AUDIT-R3-DRV-B-001 · Pass · Mixed CTAs render correctly
**Observed**: `/s/safe-drive-academy` renders 6 cards — 1-Hour Lesson & Motorway Lesson show **Book Now**; the four Purchase items show **Buy**. CTA-to-type mapping is correct.

### Booking flow
#### AUDIT-R3-DRV-F-001 · 🆕 Important · Booking flow broken — no service provider auto-seeded, calendar shows zero bookable days
**Observed**: Clicking **Book Now** on 1-Hour Lesson opens the calendar but **every date June 1–30 is greyed/disabled** — no selectable days, so no slots can be chosen and no booking can be made. Root cause confirmed on the **Instructors** tab: **"Service Providers (0) — No providers yet. Add a provider to start managing availability."** Tutoring and Music School both auto-create a default provider (their bookings work); Driving School does **not**, so its two Booking-type items are unbookable on a fresh install.
**Impact**: A driving-school operator who publishes the seeded portal has a live "Book Now" button that leads to a dead calendar until they manually add an instructor. This is an archetype-seed inconsistency (provider auto-creation present for some Academy-Portal archetypes, absent for driving-school).

### Order / purchase flow
#### AUDIT-R3-DRV-F-002 · 🆕 Important · "Buy" CTA on price-less Purchase items dead-ends at a 404 order page
**Observed**: Clicking **Buy** (e.g. Block of 10 Lessons) targets `/s/safe-drive-academy/order/itm-…`, which returns the platform **404** page ("This page could not be found. The link may be stale, or the route was renamed."). Confirmed by direct navigation and by clicking the link.
**Root cause (code-confirmed)**: `apps/web/app/(storefront)/s/[slug]/order/[itemId]/page.tsx` calls `notFound()` when `item.priceAmount === null` ("Without a price there is nothing to charge, so we 404 rather than render a checkout for £0"). The driving-school archetype **seeds its Purchase items without prices**, so the storefront still renders a **Buy** CTA for them, but the order route 404s for every one. Two-sided defect: (a) archetype seed ships Purchase items with null price; (b) the storefront shows a Buy CTA for an unpurchasable item instead of hiding it / showing "Enquire for price". Likely affects any archetype with price-less Purchase items (e.g. Run 2 optician's Glasses Frames/Prescription Lenses, which Run 2 never exercised).

### Inbox
#### AUDIT-R3-DRV-I-001 · Critical · DPF meta-language banner; inbox empty (both flows failed)
🔁 Recurring (#1752 ❌). Banner present; "No entries yet." because neither a booking nor an order could be created.

### Driving School — Summary
| Check | Finding | Severity | Verdict |
|-------|---------|----------|---------|
| Financial | Subscription + Recurring Required; GBP default | Important | 🆕 model / 🔁 #1759 |
| Catalog | 6 services, mixed Booking + Purchase, matches preview | Pass | ✓ |
| Public | Mixed Book Now / Buy CTAs render | Pass | ✓ |
| Booking | No provider auto-seeded → empty calendar, unbookable | Important | 🆕 booking flow broken |
| Order | Price-less Purchase items → Buy CTA 404s order route | Important | 🆕 purchase flow broken |
| Portal | Unpublished on create | Important | 🔁 recurring |
| Inbox | DPF meta-language banner; empty | Critical | 🔁 #1752 not resolved |

---

## Music School — Harmony Music School (fresh install)

**Company**: Harmony Music School · **Owner persona**: Noah Kim (test customer)
**URL slug**: harmony-music-school · **Portal type**: Academy Portal · **Archetype**: music-school

### Financial model
#### AUDIT-R3-MUS-A-001 · Pass/Observation · Subscription + Recurring Required; GBP default
🆕 education model. 🔁 GBP recurring (#1759 ❌; switched to USD).

### Service catalog
#### AUDIT-R3-MUS-P-001 · Pass · 6 courses, all Booking type, matches preview; provider auto-created
**Observed**: Courses tab shows 6 courses, all **Booking**, `/session` pricing: Guitar Lessons, Piano Lessons, Drum Lessons, Singing Lessons, Music Theory, Exam Preparation. Matches preview. **Instructors** tab shows **"Service Providers (1) — Harmony Music School, Active, 6 services"** — a default provider IS auto-created (contrast Driving School DRV-F-001). Dashboard: 5 Sections · 6 Items · 0 Inquiries · 0 Bookings.

### Public portal & booking flow
#### AUDIT-R3-MUS-B-001 · Pass · Public portal renders with Book Now CTAs
**Observed**: `/s/harmony-music-school` renders 6 cards, all **Book Now**. Music vocabulary throughout.

#### AUDIT-R3-MUS-F-001 · Pass · Booking end-to-end works
**Observed**: Guitar Lessons → June 16 2026 → 10:00 AM (with "Harmony Music School", 30-min slots 9:00–17:30) → Noah Kim / noah.kim@test.com → Confirm. Reference **BK-KN0NYCIV**. ✓

#### AUDIT-R3-MUS-F-002 · Important · Booking calendar timezone Europe/London
🔁 Recurring.

#### AUDIT-R3-MUS-B-002 · Important · Portal starts Unpublished
🔁 Recurring.

### Inbox
#### AUDIT-R3-MUS-I-001 · Critical · DPF meta-language in inbox
🔁 Recurring (#1752 ❌). Banner present; booking BK-KN0NYCIV present (pending, Confirm/Cancel). ✓

### Music School — Summary
| Check | Finding | Severity | Verdict |
|-------|---------|----------|---------|
| Financial | Subscription + Recurring Required; GBP default | Important | 🆕 model / 🔁 #1759 |
| Catalog | 6 courses all Booking, matches preview; provider auto-created | Pass | ✓ |
| Public | Book Now CTAs render | Pass | ✓ |
| Booking | End-to-end works (BK-KN0NYCIV) | Pass | ✓ |
| Booking | Calendar timezone Europe/London | Important | 🔁 recurring |
| Portal | Unpublished on create | Important | 🔁 recurring |
| Inbox | DPF meta-language banner | Critical | 🔁 #1752 not resolved |

---

## Run 3 Summary (all 4 education-training archetypes complete)

| Category | Count |
|----------|-------|
| Critical | 4 (inbox meta-language × 4) |
| Important | 13 |
| Pass / Observation | 19 |
| **Total findings** | **36** |

### NEW findings this run (not in the Run 2 baseline)

1. **Academy Portal is a distinct portal type** (🆕, all 4) — education archetypes render "Academy Portal" with **Courses / Instructors / Enrolments** nav (not "Booking Portal"). Answers the brief's watch item directly: portal type label *is* something other than Booking/Patient Portal. Vocabulary fitness is good.
2. **Education family uses Subscription + Recurring Required** (🆕, all 4) — not Appointment Checkout. Subscription is internal billing only; public CTAs stay service-type-driven. Same pattern as Run 2 optician.
3. **Corporate Training is inquiry-only** (🆕, AUDIT-R3-CORP-P-001) — all services Inquiry type, Enquire CTAs, no booking calendar, no Bookings dashboard card. By-design variant; standard booking checklist N/A.
4. **Driving School: no service provider auto-seeded → booking flow broken** (🆕 Important, AUDIT-R3-DRV-F-001) — Instructors = 0, calendar shows zero bookable days. Inconsistent with Tutoring/Music School which auto-create a provider.
5. **Driving School: price-less Purchase items → "Buy" CTA 404s the order route** (🆕 Important, AUDIT-R3-DRV-F-002) — code-confirmed: `s/[slug]/order/[itemId]/page.tsx` `notFound()`s when `priceAmount === null`; the driving-school seed ships Purchase items without prices yet the storefront still renders a Buy CTA. Likely affects all archetypes with price-less Purchase items (e.g. Run 2 optician, untested there).

### Recurring systemic findings reconfirmed (Run 2 baseline)

| Finding | Fix PR | Verdict in Run 3 |
|---------|--------|------------------|
| GBP default currency on US install | #1759 | ❌ Not resolved — all 4 archetypes |
| Bill tax 20% default | #1759 | (not re-driven this fast-track pass — finance lifecycle skipped per brief) |
| Wizard portal starts Unpublished | — | 🔁 All 4 archetypes |
| Booking calendar timezone Europe/London | — | 🔁 All booking archetypes (Tutoring, Music School; Driving School calendar empty so N/A) |
| DPF meta-language in inbox | #1752 | ❌ Not resolved — all 4 archetypes (Critical) |
| No archetype-specific booking form fields | #1760 | ❌ Not resolved (generic 4-field form) |

### Recommended follow-up backlog items (for triage, not filed in this pass)
- **BI candidate (Important)**: Driving-school archetype seed must auto-create a default service provider (parity with tutoring/music-school) OR the booking CTA must degrade gracefully when no provider exists.
- **BI candidate (Important)**: Storefront must not render a "Buy" CTA for Purchase items with `priceAmount === null` (hide, or route to an "Enquire for price" flow) — and/or the archetype seeds (driving-school, optician, …) must ship Purchase items with prices. Current behaviour is a live CTA that 404s.
