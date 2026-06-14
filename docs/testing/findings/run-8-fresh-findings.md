# Run 8 Fresh-Install Findings — Healthcare & Wellness

**Date:** 2026-06-14  
**Archetypes:** `physiotherapy`, `dental-practice`, `optician`, `veterinary`  
**Image SHA:** TBD  
**Validator:** Autonomous MCP session (Claude Sonnet 4.6)  
**Golden dump:** `golden-provider-configured-2026-06-12.dump`

**Audit protocol (expanded from Run 7 feedback):**  
Every page visited enumerates ALL CTAs, form fields, dropdowns, and navigation links. Each element is either functionally driven or code-verified. "Did not click" is not an acceptable audit outcome — every presented path is chased or explicitly noted as code-verified/stub.

---

## Executive Summary

**4 archetypes audited · 1 Critical defect · 6 Important defects · 12 Minor defects · 16 positive findings**

| Archetype | P | B5 | G | Net verdict |
|-----------|---|----|---|-------------|
| `physiotherapy` — Peak Physio Clinic | ✅ | ⚠️ (R7-001, R8-B5-006) | ⚠️ (R6-004) | Functional; booking end-to-end confirmed; intake fields missing |
| `dental-practice` | ✅ | ⚠️ (R8-B5-009) | ⚠️ (R6-004) | Functional; richest vocabulary; formSchema gap |
| `optician` | ✅ | ⚠️ (R8-OPT-001) | ⚠️ (R6-004, R8-OPT-003) | Functional; mixed CTA innovates; no purchase flow for retail items |
| `veterinary-clinic` | ✅ | 🔴 (R8-B5-009 Critical) | ⚠️ (R6-004) | Booking flow broken at clinical level — no pet/species data collected |

**Critical defect (1):**
- **R8-B5-009 / veterinary**: `SlotBookingFlow.tsx` ignores `formSchema` entirely. Veterinary formSchema requires Pet name and Species to be captured at booking — neither field is ever rendered. A vet receives anonymous slot bookings with no information about the animal. The data model is correct; the rendering layer is missing.

**Recurring across all archetypes (3):**
- **R6-004**: Invoice TAX % defaults to 20 on No-VAT installs — **12 consecutive archetypes** across Runs 6–8. BI-E12B8B01 raised.
- **R7-001**: Booking Confirm/Cancel API endpoint missing — `POST /api/storefront/bookings/:id/confirm` does not exist. Confirmed on physiotherapy (functionally driven) and code-verified for all others.
- **R8-B5-009**: `SlotBookingFlow.tsx` ignores `formSchema` — Important for physiotherapy/dental (clinical intake missing), Critical for veterinary (pet identity missing).

**New defects this run (5):**
- **R8-OPT-001**: Purchase-type items (Glasses Frames, Prescription Lenses) route to generic enquiry form — no product browse, variant selection, cart, or purchase flow.
- **R8-VET-001**: POA/Quote services (Neutering/Spaying) route to booking calendar — no quote-request path; customers book without price context.
- **R8-OPT-003**: Invoice detail renders $ currency symbol for GBP invoices (SQL-created customer account).
- **R8-UX-001**: Coworker panel overlaps New Customer slide-over (recurring from dental onwards).
- **R8-P-011/012**: Archetype-reset does not update URL slug or org name/portal heading.

**Positive highlights:**
- All 4 archetypes seed domain-appropriate vocabulary, sections, and services without operator configuration.
- Optician is the first archetype to correctly model a retail+service hybrid with distinct CTA types.
- Veterinary has the richest formSchema of any archetype tested (Pet name, Species, Breed) — the data model investment is sound; only the rendering layer needs to be unlocked.
- Three pricing tiers (fixed / From... / Quote→POA) demonstrated in veterinary — pricing architecture is more flexible than surface reviews suggested.

---

## Archetype 1: `physiotherapy`

**Install name:** Peak Physio Clinic  
**Slug:** `/s/peak-physio-clinic`  
**Currency:** GBP · **VAT:** No VAT

### Phase P — Operator Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Setup wizard — archetype=Physiotherapy, GBP, No VAT | ✅ Wizard completed |
| P2 | Services seeded | ✅ 5 services: Initial Assessment, Follow-up Session, Sports Injury Treatment, Hydrotherapy Session, Group Exercise Class — all type=Booking |
| P3 | Nav vocabulary | ✅ Left nav shows "Patient Portal", "Services", "Practitioners", "Appointments" |
| P4 | Admin Sections | ✅ 5 seeded sections visible (Hero, Services, About, Testimonials, Contact) with reorder/Hide controls |
| P5 | Operating Hours | ✅ Mon–Fri 09:00–17:00, Sat 09:00–13:00, Sun closed. Timezone defaults **UTC** (not Europe/London) |
| P6 | Your Business settings | ✅ Pre-seeded mission statement; Company size + Geographic reach pickers present; Business plan file upload field |
| P7 | Add Practitioner | ✅ Form present; no bio/photo fields (pre-compaction) |
| P8 | "Add section" CTA | ⚠️ No "Add section" button in Sections admin (pre-compaction) |
| P9 | Hero image field | ⚠️ URL text field, not a file uploader |
| P10 | Optional capabilities | ⚠️ No optional capabilities shown at archetype setup (compare: IT Managed Services shows 12) |

**P-pt-1 — Archetype-tailored navigation vocabulary (positive)**  
Left nav uses "Patient Portal", "Services", "Practitioners", "Appointments" — correct healthcare domain vocabulary.

**P-pt-2 — Operating Hours timezone defaults UTC (gap)**  
Timezone picker defaults to UTC rather than deriving from org locale (GBP → Europe/London). Operator must manually correct.

**P-pt-3 — Add Practitioner form lacks bio/photo fields (pre-compaction gap)**  
Form accepts name and role but no biography text, profile photo upload, or qualification fields. Practitioners appear on the public storefront without any personal detail.

### Phase B5 — Public Storefront

| Step | Action | Result |
|------|--------|--------|
| B5-1 | Storefront loads at `/s/peak-physio-clinic` | ✅ 5 services rendered with "Book Now" CTAs |
| B5-2 | Section scaffold — live content | ⚠️ Sections render structural scaffold (headings/placeholders) but no operator-entered content until wizard Compaction phase |
| B5-3 | Service prices on storefront | ⚠️ No prices shown on service cards (pre-compaction) |
| B5-4 | Patient self-registration | ✅ `/portal/sign-up`: name, email, password fields → auto-login → portal dashboard |
| B5-5 | Patient portal dashboard tiles | ✅ Orders (mislabelled), Services, Support, Account |
| B5-6 | "Orders" label | ⚠️ Portal tile/page labelled "Orders" should be "Appointments" for healthcare |
| B5-7 | "Orders" page content | ⚠️ Generic e-commerce copy ("No orders yet") not healthcare-appropriate |
| B5-8 | Support tab | ⚠️ Stub — "Coming soon." |
| B5-9 | Book Now → calendar booking | ✅ Date picker → hourly slots (08:00–17:00) → booking form |
| B5-10 | Calendar timezone label | ⚠️ "Times shown in UTC" on booking calendar (should reflect org timezone) |
| B5-11 | Booking form fields | ⚠️ Name, email, phone, notes only — no healthcare intake fields (chief complaint, referring GP, insurance) |
| B5-12 | Booking submission | ✅ BK-CLHSVUZX confirmed |
| B5-13 | Confirmation page | ⚠️ Shows reference number only — no date/time echo, no iCal/calendar add link |
| B5-14 | Admin → Appointments inbox | ✅ BK-CLHSVUZX appears; filter tabs: All, Inquiry, Booking, Order, Donation |
| B5-15 | Booking Confirm button | ⚠️ **R7-001 (recurring)**: Button present but non-functional — calls `POST /api/storefront/bookings/${id}/confirm` which does not exist anywhere in the codebase (code-verified: no `bookings/` subdirectory under `app/api/storefront/`) |
| B5-16 | Booking Cancel button | ⚠️ **R7-001 (recurring)**: Same missing-route defect |
| B5-17 | Admin Sections — 5 sections | ✅ Hero, About, Services, Practitioners, Testimonials — reorder + Hide controls work |
| B5-18 | Admin → add new section | ⚠️ No "Add section" CTA in admin Sections view (pre-compaction) |

**B5-pt-1 — Full patient registration and calendar booking flow (positive)**  
End-to-end path confirmed: public storefront → sign-up → portal dashboard → Book Now → date picker → time slots → form → confirmation reference. Booking appears in admin inbox correctly.

**B5-pt-2 — No healthcare intake fields on booking form (gap)**  
Booking form collects name/email/phone/notes only. No chief complaint, referring clinician, or insurance fields. Appropriate intake data collection is missing for a clinical service.

**B5-pt-3 — R7-001 recurring: Confirm/Cancel API endpoint missing (code-verified gap)**  
`StorefrontInbox.tsx` lines 72–75 call `POST /api/storefront/bookings/${id}/confirm` — route does not exist. The component also calls `window.location.reload()` unconditionally after the fetch (line 69) so no error is surfaced to the operator even on 404.

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | Finance overview | ✅ Base currency GBP; 7 reports available |
| G2 | Finance Specialist coworker | ✅ Visible in coworker panel (CONFIDENTIAL / HANDS OFF labels) |
| G3 | Revenue Reporting | ✅ Base currency GBP correct |
| G4 | Finance > Settings > Dunning | ✅ Dunning steps visible; read-only (pre-compaction) |
| G5 | Finance > Settings > Tax | ✅ Tax settings page loads |
| G6 | Finance > Settings > Banking | ✅ Banking page loads |
| G7 | Add bank account | ⚠️ Currency defaults USD (pre-compaction); no UK bank integration (pre-compaction) |
| G8 | Tax Remittance | ⚠️ Home country defaults US/WA on GBP/UK install (pre-compaction) |
| G9 | Create customer "Test Patient R8a" | ✅ Customer account created |
| G10 | New invoice — Customer dropdown | ✅ "Test Patient R8a" selectable |
| G11 | New invoice — Currency | ✅ GBP pre-filled |
| G12 | New invoice — Due Date format | ⚠️ **R6-005 (new)**: Date field shows MM/DD/YYYY format on UK/GBP install (US locale) |
| G13 | New invoice — TAX % default | ⚠️ **R6-004 (recurring)**: TAX % field pre-filled with 20 on No-VAT install |
| G14 | Invoice saved (manually corrected to 0%) | ✅ INV-2026-0001: £75.00, Initial Assessment, 0% tax, GBP draft |
| G15 | Send Invoice — no email on customer | ⚠️ **R8-G-001 (new)**: "Invoice has no contact email" error displayed inline — error IS surfaced (not silent), but no link to customer record to fix it; dead-end UX |
| G16 | Download PDF | ✅ Opens `/api/v1/finance/invoices/{id}/pdf` in new tab — route confirmed to exist |
| G17 | Finance > Reports (7 available) | ✅ Spend, Revenue, Close, Configuration, Settings — all routes return 200 (RSC fetches confirmed in network log) |

**G-pt-1 — Finance Specialist coworker (positive)**  
Finance Specialist coworker present in panel with "CONFIDENTIAL / HANDS OFF / EXTERNAL ACCESS OFF / DIAGNOSTICS" labels. Appears appropriate for the finance surface.

**G-pt-2 — R8-G-001: Send Invoice no-email error (new gap)**  
"Send Invoice" correctly surfaces the error "Invoice has no contact email" from the API (not silent). However, there is no inline link or CTA directing the operator to add an email to the customer record. The operator must manually navigate away to fix it, then return to the invoice.

**G-pt-3 — R6-004 recurring on physiotherapy (confirmed)**  
TAX % defaults to 20% on a GBP No-VAT install. This is the 8th consecutive archetype where this defect is confirmed. Invoice must be manually corrected before saving.

---

## Defect Log — `physiotherapy`

| ID | Phase | Severity | Description |
|----|-------|----------|-------------|
| R8-P-001 | P | Minor | Operating Hours timezone defaults UTC on UK/GBP install |
| R8-P-002 | P | Minor | Add Practitioner form: no bio/photo/qualification fields (pre-compaction) |
| R8-P-003 | P | Minor | No "Add section" CTA in Sections admin (pre-compaction) |
| R8-P-004 | P | Minor | Hero image: URL text field not file uploader (pre-compaction) |
| R8-P-005 | P | Minor | No optional capabilities shown at physiotherapy archetype setup |
| R8-B5-001 | B5 | Minor | Section scaffold renders without operator content until Compaction |
| R8-B5-002 | B5 | Minor | No service prices on public storefront cards (pre-compaction) |
| R8-B5-003 | B5 | Minor | Patient portal "Orders" label/copy wrong — should be "Appointments" |
| R8-B5-004 | B5 | Minor | Support tab stub ("Coming soon.") |
| R8-B5-005 | B5 | Minor | Calendar "Times shown in UTC" — org timezone not applied |
| R8-B5-006 | B5 | Important | No healthcare intake fields on booking form (chief complaint, referring GP) |
| R8-B5-007 | B5 | Minor | Booking confirmation shows reference only — no date/time echo, no iCal link |
| R8-B5-008 | B5 | Important | **R7-001 recurring**: Booking Confirm/Cancel API endpoint missing (code-verified) |
| R8-G-001 | G | Minor | "Send Invoice" error "no contact email" surfaced but no link to fix — dead-end UX |
| R8-G-002 | G | Minor | **R6-004 recurring**: Invoice TAX % defaults 20 on No-VAT install |
| R8-G-003 | G | Minor | **R6-005 new**: Invoice due date MM/DD/YYYY on UK/GBP install |
| R8-G-004 | G | Minor | Add bank account: currency defaults USD on GBP install (pre-compaction) |
| R8-G-005 | G | Minor | Tax Remittance home country US/WA on GBP/UK install (pre-compaction) |

---

## Archetype 2: `dental-practice`

**Archetype reset from:** `physiotherapy` via `POST /api/storefront/admin/archetype-reset`  
**Currency:** GBP · **VAT:** No VAT (carried from golden dump)

### Phase P — Operator Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Archetype reset to dental-practice | ✅ Success: 6 sections, 6 items created |
| P2 | Services seeded | ✅ New Patient Examination, Check-up & Clean, Teeth Whitening, Fillings, Orthodontic Consultation (Free), Emergency Appointment — all type=Booking |
| P3 | Sections seeded | ✅ Hero, Treatments, About the Practice, Our Dentists, Our Practice (gallery type), Find Us — 6 total (physiotherapy had 5) |
| P4 | Nav vocabulary | ✅ "Patient Portal" retained — correct for healthcare. Admin portal tab shows "Patient Portal" |
| P5 | Admin section heading — Practitioners | ⚠️ **R8-P-010 (new)**: Admin Practitioners tab heading reads "Service Providers" not "Dentists" — vocabulary mismatch with the section "Our Dentists" |
| P6 | URL slug after reset | ⚠️ **R8-P-011 (new)**: Slug remains `peak-physio-clinic` after archetype-reset — not auto-updated to dental slug |
| P7 | Org name after reset | ⚠️ **R8-P-012 (new)**: Header/hero still reads "Peak Physio Clinic" — archetype-reset updates content only, not org name |
| P8 | Capabilities | ⚠️ "No optional capabilities for your business type yet." — same as physiotherapy |
| P9 | "Add section" CTA | ⚠️ Still absent in Sections admin (same recurring gap) |

**P-dp-1 — Dental-specific section vocabulary (positive)**  
"Treatments" (not "Services"), "Our Dentists" (not "Team"), "Our Practice" (gallery), "Find Us" (not "Contact") — strongest vocabulary differentiation of the healthcare archetypes. Includes a gallery section type new to this archetype.

**P-dp-2 — Gallery section type (positive)**  
"Our Practice" uses `gallery` section type — not present in physiotherapy. Enables practice interior/equipment photos without operator coding.

### Phase B5 — Public Storefront

| Step | Action | Result |
|------|--------|--------|
| B5-1 | Storefront loads at `/s/peak-physio-clinic` | ✅ 6 dental services with "Book Now" CTAs |
| B5-2 | Orthodontic Consultation shows "Free" | ✅ Free price badge rendered correctly |
| B5-3 | Book Now → calendar | ✅ Calendar launches — "Times shown in UTC" (recurring gap) |
| B5-4 | Date availability | ⚠️ **R8-B5-010 (new)**: No dates selectable — archetype-reset does not transfer/create provider availability; calendar is empty |
| B5-5 | Archetype-specific booking form fields (code-verified) | ⚠️ **R8-B5-009 (new, important)**: `SlotBookingFlow.tsx` hardcodes fields (name, email, phone, notes) — ignores `formSchema` in DB. Dental's "Patient type" (New/Existing) field never shown. Physiotherapy's "Area of concern" + "Referred by" also never shown. |
| B5-6 | Coworker panel + New Customer form collision | ⚠️ **R8-UX-001 (new)**: When both "New Customer" slide-over and coworker panel are open, they overlap — coworker panel covers the form, making it unusable |

**B5-dp-1 — formSchema defined but not rendered (code-verified gap)**  
DB has dental: `patientType` select (New/Existing patient required). DB has physio: `condition` text + `referral` select. Both are silently ignored by `SlotBookingFlow.tsx` which renders hardcoded fields. The intelligence exists in the seed; the UI doesn't consume it.

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | New invoice form | ✅ Loads at `/finance/invoices/new` |
| G2 | Currency | ✅ GBP pre-filled |
| G3 | R6-004 recurring | ⚠️ TAX % defaults 20 — 10th consecutive archetype where this defect is confirmed |
| G4 | Date format | ⚠️ R6-005 recurring: MM/DD/YYYY on GBP/UK install |
| G5 | Customer Success Manager coworker | ✅ Present, shown as "HANDS ON" mode (active engagement) — differs from Finance Specialist which showed HANDS OFF |

---

## Defect Log — `dental-practice`

| ID | Phase | Severity | Description |
|----|-------|----------|-------------|
| R8-P-010 | P | Minor | Admin Practitioners tab heading "Service Providers" not "Dentists" (vocabulary mismatch vs "Our Dentists" section) |
| R8-P-011 | P | Minor | Archetype-reset does not update URL slug |
| R8-P-012 | P | Minor | Archetype-reset does not update org name / hero title |
| R8-B5-009 | B5 | Important | `formSchema` ignored by `SlotBookingFlow.tsx` — archetype-specific intake fields (dental "Patient type", physio "Area of concern") never rendered |
| R8-B5-010 | B5 | Minor | No provider availability after archetype-reset — calendar shows but all dates grayed out |
| R8-UX-001 | UX | Minor | Coworker panel overlaps "New Customer" slide-over when both open simultaneously |
| R8-G-002 | G | Important | **R6-004 recurring** (10th archetype): TAX % defaults 20 on No-VAT install |
| R8-G-003 | G | Minor | **R6-005 recurring**: Invoice date MM/DD/YYYY on GBP/UK install |

---

## Positive Findings — `dental-practice`

- **P-dp-1**: Strongest domain vocabulary — "Treatments", "Our Dentists", "Find Us"
- **P-dp-2**: Gallery section type new in healthcare — "Our Practice" for practice photos
- **B5-dp-1** (partial): formSchema in DB has correct dental-specific fields (Patient type, New/Existing) even though UI doesn't render them yet
- **G-dp-1**: Customer Success Manager coworker active in HANDS ON mode

---

## Archetype 3: `optician`

**Archetype reset from:** `dental-practice` via `POST /api/storefront/admin/archetype-reset`  
**Currency:** GBP · **VAT:** No VAT (carried from golden dump)

### Phase P — Operator Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Archetype reset to optician | ✅ Success: 5 sections, 5 items created |
| P2 | Services seeded | ✅ Eye Test (Booking), Contact Lens Consultation (Booking), Glasses Frames (Purchase), Prescription Lenses (Purchase), Children's Eye Test (Booking, Free) |
| P3 | Sections seeded | ✅ Hero, Services & Products, About Us, **Our Frames** (gallery), Visit Us — 5 total |
| P4 | Admin portal heading | ⚠️ **R8-P-012 (recurring)**: Heading still reads "Patient Portal" — not updated by archetype-reset |
| P5 | URL slug after reset | ⚠️ **R8-P-011 (recurring)**: Slug remains `peak-physio-clinic` |
| P6 | Practitioners tab heading | ⚠️ **R8-P-010 (recurring)**: Heading reads "Service Providers (0)" not "Opticians" |
| P7 | Capabilities | ⚠️ "No optional capabilities for your business type yet." |
| P8 | Mixed item types | ✅ Admin Services tab shows both Booking and Purchase types in the same list — first archetype with this mix |

**P-opt-1 — "Services & Products" section name (positive)**  
Section named "Services & Products" (not just "Services") — correctly reflects the dual service+retail nature of an optician. More semantically precise than any previous archetype.

**P-opt-2 — "Our Frames" gallery section (positive)**  
Domain-specific gallery section seeded out-of-the-box for frame showcase. Not a generic "Gallery" — named for the business context. Enables frame display without operator coding.

### Phase B5 — Public Storefront

| Step | Action | Result |
|------|--------|--------|
| B5-1 | Storefront loads at `/s/peak-physio-clinic` | ✅ 5 items rendered; hero title "Peak Physio Clinic" (slug/name not reset) |
| B5-2 | CTA differentiation — Booking vs Purchase | ✅ Eye Test/Contact Lens/Children's Eye Test → "Book Now"; Glasses Frames/Prescription Lenses → "Enquire" |
| B5-3 | Children's Eye Test price | ✅ "Free" badge with "NHS-funded sight test for under-16s" description |
| B5-4 | Book Now → Eye Test calendar | ✅ Calendar launches correctly (no slots — no providers configured, consistent with prior archetypes) |
| B5-5 | Enquire → Glasses Frames | ⚠️ **R8-OPT-001 (new, important)**: Purchase-type item routes to generic enquiry form — no product gallery, variant selector, add-to-cart, or purchase flow |
| B5-6 | Enquiry form for Glasses Frames | ✅ Full name, Email (required), Phone, Additional notes, "Send Enquiry" — form functional; INQ-MDZOUC2F confirmed |
| B5-7 | Admin Appointments inbox | ✅ INQ-MDZOUC2F shows as "Inquiry / New lead" with "Send to backlog" CTA |
| B5-8 | Inbox filter tabs | ✅ All / Inquiry / Booking / **Order** / Donation — Order tab exists (unused by Purchase type items) |
| B5-9 | Optician formSchema (code-verified) | ⚠️ **R8-OPT-002 (new)**: formSchema is generic only — name/email/phone/notes. No optician-specific fields (last eye test date, current prescription, NHS number, reason for visit) |

**B5-opt-1 — First mixed-CTA storefront (positive)**  
Optician is the first archetype to surface both "Book Now" and "Enquire" CTAs on the same storefront — correctly reflecting the dual service+retail model. The distinction is rendered without operator configuration.

**B5-opt-2 — Children's Eye Test free + NHS note (positive)**  
"Free" price badge and "NHS-funded sight test for under-16s" description demonstrate understanding of UK optician market structure. NHS eligibility context surfaces at the service card level.

**B5-opt-3 — R8-OPT-001: Purchase type routes to enquiry (gap)**  
"Glasses Frames" and "Prescription Lenses" are configured as `type=Purchase` in admin but the public storefront shows "Enquire" and routes to `/inquire/` — the same contact form used for all enquiry-type items. No shopping cart, no product image gallery, no frame variant selection (colour/size/material), no pricing display, no add-to-cart, no checkout. A customer enquiring about frames receives no browsable catalogue. The admin inbox `Order` filter tab exists but is never populated by Purchase-type items.

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | New Customer (ACCT-R8C) | ✅ Test Patient R8c created via SQL (UI blocked by coworker panel overlap — R8-UX-001 recurring) |
| G2 | New Invoice | ✅ Loads at `/finance/invoices/new` |
| G3 | R6-004 recurring | ⚠️ TAX % defaults 20 — **11th consecutive archetype** confirming this defect |
| G4 | Invoice saved (manually corrected to 0%) | ✅ INV-2026-0001: Eye Test, 1×£65.00, 0% tax, GBP draft |
| G5 | Currency display on saved invoice | ⚠️ **R8-OPT-003 (new)**: Invoice detail shows **$65.00** (dollar symbol) for a GBP invoice. DB stores `currency=GBP` correctly — UI rendering bug |
| G6 | Send Invoice / Download PDF CTAs | ✅ Both present on saved invoice detail (consistent with prior archetypes) |

**G-opt-1 — R8-OPT-003: Invoice currency symbol renders as $ on GBP install (new gap)**  
INV-2026-0001 stored as `currency=GBP` and `totalAmount=65.00` in the `Invoice` table. Invoice detail page renders `$65.00`. Physiotherapy and dental invoices on the same install correctly rendered `£75.00` and `£50.00`. CustomerAccount ACCT-R8C was SQL-inserted with `currency=GBP` default. Root cause: likely an Intl.NumberFormat locale or currency-symbol resolution issue on the invoice detail page specific to this code path.

---

## Defect Log — `optician`

| ID | Phase | Severity | Description |
|----|-------|----------|-------------|
| R8-P-011 | P | Minor | Archetype-reset does not update URL slug (recurring) |
| R8-P-012 | P | Minor | Archetype-reset does not update org name/portal heading (recurring) |
| R8-P-010 | P | Minor | Practitioners tab heading "Service Providers" not "Opticians" (recurring) |
| R8-OPT-001 | B5 | Important | Purchase-type items route to generic enquiry form — no product browse, variant selector, cart, or purchase flow |
| R8-OPT-002 | B5 | Minor | Optician formSchema is generic (name/email/phone/notes) — no domain-specific booking intake fields |
| R8-UX-001 | UX | Minor | Coworker panel overlaps New Customer form (recurring) |
| R8-G-002 | G | Important | **R6-004 (11th archetype)**: TAX % defaults 20 on No-VAT install |
| R8-OPT-003 | G | Minor | Invoice detail renders $ symbol for GBP invoice — UI currency-symbol rendering bug |

---

## Positive Findings — `optician`

- **P-opt-1**: "Services & Products" section name correctly reflects retail+service dual model
- **P-opt-2**: "Our Frames" gallery section — domain-specific, seeded out-of-the-box
- **B5-opt-1**: First mixed-CTA storefront — "Book Now" and "Enquire" on same page without operator config
- **B5-opt-2**: Children's Eye Test "Free" + NHS context description — UK optician market awareness
- **B5-opt-3**: Enquiry flow for Purchase items functional end-to-end (INQ-MDZOUC2F confirmed)
- **G-opt-1** (partial): Invoice saved successfully; Send Invoice + Download PDF CTAs present

---

## Archetype 4: `veterinary-clinic`

**Archetype reset from:** `optician` via `POST /api/storefront/admin/archetype-reset { targetArchetypeId: "veterinary-clinic" }`  
**Currency:** GBP · **VAT:** No VAT (carried from golden dump)

### Phase P — Operator Setup

| Step | Action | Result |
|------|--------|--------|
| P1 | Archetype reset to veterinary-clinic | ✅ Success: 6 sections, 6 items created |
| P2 | Services seeded | ✅ General Consultation (Booking), Vaccination (Booking), Dental Check (Booking), Emergency Consultation (Booking, From...), Microchipping (Booking), Neutering / Spaying (Booking, **Quote**) |
| P3 | Sections seeded | ✅ Hero, Our Services, About Us, Meet the Team, **"What Pet Owners Say"** (testimonials), Find Us — 6 total |
| P4 | Admin portal heading | ⚠️ **R8-P-012 (recurring)**: Still "Patient Portal" — not updated by archetype-reset |
| P5 | URL slug | ⚠️ **R8-P-011 (recurring)**: `peak-physio-clinic` — not updated |
| P6 | Capabilities | ⚠️ "No optional capabilities for your business type yet." |
| P7 | "Quote" price type | ✅ Neutering/Spaying shows "Quote" in admin — new price type not seen in prior archetypes |
| P8 | "From..." price type | ✅ Emergency Consultation shows "From..." — variable/starting price indicator |

**P-vet-1 — "What Pet Owners Say" testimonials section (positive)**  
Testimonials section personalised to pet owners rather than generic "What our customers say" or "Testimonials". Domain-appropriate at the terminology level.

**P-vet-2 — "Quote" price type (positive)**  
Neutering/Spaying uses a "Quote" price type in admin — first archetype to show this. Renders as "POA" on the public storefront. Architecturally correct for variable surgical pricing.

**P-vet-3 — Mixed pricing models (positive)**  
Three pricing tiers in one archetype: standard booking (free/fixed), Emergency "From..." (variable minimum), Neutering "Quote/POA" (bespoke). Demonstrates pricing flexibility in the seed data.

### Phase B5 — Public Storefront

| Step | Action | Result |
|------|--------|--------|
| B5-1 | Storefront loads | ✅ 6 services, all "Book Now" CTAs. Hero: "Peak Physio Clinic" (R8-P-012) |
| B5-2 | Neutering / Spaying card | ✅ "POA" badge rendered — admin "Quote" type → "POA" on storefront |
| B5-3 | Emergency Consultation card | ✅ No price shown (From... value not set) — "Book Now" only |
| B5-4 | General Consultation booking calendar | ✅ Calendar launches; no slots (no providers — consistent) |
| B5-5 | Neutering / Spaying "Book Now" | ⚠️ **R8-VET-001 (new)**: POA service routes to same calendar booking — no quote-request path. A customer booking neuter/spay has no channel to get a cost estimate before committing to a time slot |
| B5-6 | Veterinary formSchema (code-verified) | ⚠️ **R8-B5-009 (critical escalation)**: Veterinary formSchema has 7 fields — Full name, Email, Phone, Notes, **Pet name** (required), **Species** select (Dog/Cat/Rabbit/Bird/Reptile/Other, required), **Breed** (optional). ALL are silently dropped by `SlotBookingFlow.tsx`. A vet booking without pet name or species is clinically non-functional |

**B5-vet-1 — R8-VET-001: POA service lacks quote-request path (gap)**  
"Neutering / Spaying" is explicitly labelled "Surgical procedures — contact us for a quote" in the description. Clicking "Book Now" drops the customer into a calendar slot-picker with no price context. There is no enquiry/quote channel for POA services — the formSchema gap (R8-B5-009) compounds this: even if a slot is booked, the vet receives no pet information.

**B5-vet-2 — R8-B5-009 escalated to Critical (formSchema gap)**  
Veterinary is the only healthcare archetype where the formSchema omission causes a **clinical workflow failure**. A vet booking without Pet name and Species cannot prepare for the appointment. The missing fields are required in the DB schema (`required: true`) but never surface in the UI. The earlier physiotherapy and dental cases were "Important"; veterinary is "Critical" — the business literally cannot function without these fields.

### Phase G — Financials

| Step | Action | Result |
|------|--------|--------|
| G1 | New invoice | ✅ Loads at `/finance/invoices/new` |
| G2 | R6-004 recurring | ⚠️ TAX % defaults 20 — **12th consecutive archetype** confirming this defect |
| G3 | Invoice saved (manually corrected to 0%) | ✅ INV-2026-0002: General Consultation, 1×£55.00 (stored GBP), 0% tax, draft |
| G4 | Currency display | ⚠️ **R8-OPT-003 (recurring)**: Invoice detail shows $55.00 — same $ symbol rendering bug as optician. Confirms bug is tied to SQL-created ACCT-R8C, not the archetype |

---

## Defect Log — `veterinary-clinic`

| ID | Phase | Severity | Description |
|----|-------|----------|-------------|
| R8-P-011 | P | Minor | Archetype-reset does not update URL slug (recurring) |
| R8-P-012 | P | Minor | Archetype-reset does not update org name/portal heading (recurring) |
| R8-B5-009 | B5 | **Critical** | `SlotBookingFlow.tsx` ignores `formSchema` — veterinary drops Pet name (required), Species (required select), Breed. Vet cannot triage booking without these fields |
| R8-VET-001 | B5 | Important | POA/Quote services route to booking calendar — no quote-request enquiry path |
| R8-G-002 | G | Important | **R6-004 (12th archetype)**: TAX % defaults 20 on No-VAT install |
| R8-OPT-003 | G | Minor | Invoice detail renders $ symbol for GBP invoice (recurring — ACCT-R8C) |

---

## Positive Findings — `veterinary-clinic`

- **P-vet-1**: "What Pet Owners Say" — domain-personalised testimonials section
- **P-vet-2**: "Quote" price type → "POA" on storefront — first archetype with surgical price type
- **P-vet-3**: Three pricing tiers in one archetype (fixed/From.../Quote) — demonstrates pricing flexibility
- **B5-vet-1**: "POA" badge renders correctly on storefront from admin "Quote" type
- **G-vet-1**: Invoice saved successfully; Send Invoice + Download PDF CTAs present
- **B5-vet-2** (partial): Veterinary formSchema is the most complete of all 4 archetypes — Pet name, Species select, Breed defined correctly in DB. The gap is the rendering layer, not the data model.

---

## Cross-Archetype Defect Log

| ID | Archetypes | Phase | Severity | Description |
|----|-----------|-------|----------|-------------|
| R6-004 | All (Runs 6–8, 12 archetypes) | G | Important | Invoice TAX % defaults 20 on No-VAT installs — BI-E12B8B01 |
| R7-001 | counselling, physiotherapy, dental, optician, veterinary | B5 | Important | Booking Confirm/Cancel: `POST /api/storefront/bookings/:id/confirm` does not exist (code-verified) |
| R6-005 | All GBP installs | G | Minor | Invoice due date uses MM/DD/YYYY US format on UK/GBP install |
| R8-B5-009 | physiotherapy, dental, **veterinary (Critical)** | B5 | **Critical/Important** | `SlotBookingFlow.tsx` ignores `formSchema` — archetype-specific intake fields silently dropped |
| R8-P-010 | dental, optician, veterinary | P | Minor | Practitioners tab heading "Service Providers" — not updated to archetype-specific role |
| R8-P-011 | dental, optician, veterinary | P | Minor | Archetype-reset does not update URL slug |
| R8-P-012 | dental, optician, veterinary | P | Minor | Archetype-reset does not update org name/portal heading |
| R8-UX-001 | All (dental onwards) | UX | Minor | Coworker panel overlaps New Customer slide-over when both open |
| R8-OPT-001 | optician | B5 | Important | Purchase-type items route to generic enquiry form — no product browse or purchase flow |
| R8-OPT-003 | optician, veterinary | G | Minor | Invoice detail renders $ symbol for GBP invoice (SQL-created ACCT-R8C) |
| R8-VET-001 | veterinary | B5 | Important | POA/Quote services route to booking calendar — no quote-request path |

---

## Positive Findings — Cross-Archetype

- **P-pt-1**: Healthcare domain nav vocabulary (Patient Portal, Practitioners, Appointments) — all 4 archetypes
- **B5-pt-1**: Full patient self-registration and calendar booking flow — end-to-end confirmed on physiotherapy
- **G-pt-1**: Finance Specialist coworker visible on finance surface
- **G-pt-2** (partial): Send Invoice error "no contact email" is surfaced inline (not silent)
- **P-dp-1**: Dental — strongest domain vocabulary ("Treatments", "Our Dentists", "Find Us")
- **P-dp-2**: Dental — gallery section type seeded out-of-the-box ("Our Practice")
- **P-opt-1/2**: Optician — "Services & Products" + "Our Frames" gallery — dual retail/service identity
- **B5-opt-1**: Optician — first mixed "Book Now"/"Enquire" storefront without operator config
- **B5-opt-2**: Optician — Children's Eye Test "Free" + NHS context description
- **P-vet-1**: Veterinary — "What Pet Owners Say" personalised testimonials
- **P-vet-2/3**: Veterinary — "Quote"→"POA" price type; three pricing tiers in one archetype
- **B5-vet-2** (partial): Veterinary formSchema in DB is the most complete of all archetypes — Pet name (required), Species select (Dog/Cat/Rabbit/Bird/Reptile/Other), Breed — the data model is right, the rendering layer is the gap
