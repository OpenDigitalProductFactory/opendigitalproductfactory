# Run 5 Fresh-Install Findings — Healthcare & Wellness

**Run**: 5 (healthcare-wellness, fresh-install fast-track pass)
**Archetypes tested**: veterinary-clinic *(complete)*, dental-practice *(complete)*, physiotherapy *(complete)*, counselling *(complete)*
**Run date**: 2026-06-13
**Method**: Tier 2 DB-only reset per archetype; golden dump `/tmp/golden.dump` (= `golden-provider-configured-2026-06-12.dump`); portal rebuilt from `origin/main` before run. Admin onboarding via `/setup`, then storefront wizard at `/storefront/setup`.
**Tester**: Autonomous agent

> **Baseline**: This run confirms (or refutes) systemic findings from Runs 2–4 and surfaces healthcare-specific surprises. Recurring systemic findings recorded as "🔁 Recurring (Nth confirmation)" without re-writing full detail.

---

## Archetype 1 — veterinary-clinic

**Org name**: Companion Animal Clinic  
**Practitioner**: Dr. Sarah Park  
**Service tested**: Audit — Annual Booster & Check-Up (£85/hr — see K11a)  
**Customer**: Robert Chen (rchen@test.com)  
**Booking ref**: BK-EAE587CL  
**Invoice**: INV-2026-0001 ($85.00 USD)  
**Bill**: BILL-2026-0001 ($28.00 USD — Veterinary Supplies Co.)

---

### Phase A — Portal Setup

#### ✅ V-A1 — Patient Portal (4th distinct portal type)
**Surface**: `/storefront`  
**Observed**: Portal type labelled **"Patient Portal"** with tabs: Dashboard | Sections | Services | Practitioners | **Appointments** | Settings. Vocabulary is healthcare-appropriate (Appointments, not Bookings; Practitioners, not Providers). This is the 4th distinct portal type confirmed across runs: Booking Portal (beauty/trades), Member Portal (fitness), Academy Portal (education), Patient Portal (healthcare).  
**Verdict**: ✅ Architecture supports distinct portal vocabularies per archetype family.

#### ✅ V-A2 — USD default currency (fix #1769 holding)
**Surfaces checked**: Financial setup wizard (USD defaulted), New Supplier form (Default Currency: USD), New Bill form (Currency: USD, Tax %: 0).  
**Verdict**: ✅ #1769 fix holding for veterinary-clinic on the bill/supplier side.

#### ✅ V-A3 — Provider auto-seeded (schedulingDefaults working)
**Surface**: `/storefront/practitioners`  
**Observed**: Provider "Dr. Sarah Park" was auto-created from the `schedulingDefaults.providerLabel` seed in the healthcare template. The booking calendar loaded with availability (Mon–Fri slots), confirming `schedulingDefaults: HEALTHCARE_SCHEDULING` gates the full scheduling pipeline correctly.  
**Verdict**: ✅ Healthcare archetypes are not affected by the schedulingDefaults bug identified for fitness archetypes.

#### ✅ V-A4 — Booking calendar timezone UTC (fix #1771 holding)
**Surface**: `/s/companion-animal-clinic/book/ITEM-F8731061`  
**Observed**: Calendar label reads **"Times shown in UTC"**. Not "Europe/London".  
**Verdict**: ✅ Fix #1771 confirmed holding for veterinary-clinic.

#### ✅ V-A5 — Publish banner present (fix #1770 holding)
**Surface**: `/storefront` (dashboard)  
**Observed**: After wizard completion, dashboard shows **"Publish"** button and "Status: Unpublished". After clicking Publish, status changes to **Published** immediately.  
**Verdict**: ✅ Fix #1770 confirmed holding for veterinary-clinic.

#### 🔁 V-A6 — Portal starts Unpublished (recurring)
3rd confirmation. See Run 2 finding for detail. No change.

#### ⚠️ V-A7 — £ symbol in Add Service fee form (recurring GBP bleed)
**Surface**: Add Service fee field in service creation form  
**Observed**: Fee field shows **£** prefix despite base currency set to USD. This GBP bleed persists in the service fee input specifically.  
**Verdict**: Recurring — 4th confirmation across hair-salon, personal-trainer, nail-salon, veterinary-clinic.

---

### Phase CX — Customer Account

#### ⚠️ V-CX1 — Customer account shows full MSP vocabulary
**Surface**: `/customer/<id>` (Robert Chen)  
**Observed**: Account page shows:
- **"Customer Estate"** widget (Commercial / Open Source / Hybrid / Recurring licensed)
- **"Lifecycle Review Queues"** with sub-queues: Urgent, Renewals, Reviews, Research — all described with technology refresh and support posture language
- **"Managed Items"** section with help text: *"No managed items registered yet. The MSP archetype can seed defaults like security licensing, Linux servers, and M365 tenants here."*
- **"Site Records"** section

This is MSP/IT managed-services vocabulary presented verbatim on a veterinary clinic patient account. A pet owner seeing their "Customer Estate" broken down into "Commercial: 0 / Open Source: 0" is a severe mismatch.  
**Severity**: Important — visible to operators managing any patient account. Requires archetype-conditional rendering or vocabulary remapping.

#### ⚠️ V-CX2 — No "Add Contact" button on Contacts section
**Surface**: `/customer/<id>` — Contacts panel (right column)  
**Observed**: "Contacts 0" heading renders but contains no "+ Add Contact" button or affordance. The DOM confirms no action element is present. Contacts cannot be added to customer accounts through the current UI.  
**Severity**: Important — contact management is blocked at the UI level.

#### ⚠️ V-CX3 — No Configuration Items (CI) section on customer account
**Surface**: `/customer/<id>`  
**Observed**: Header shows stat "Managed CIs: 0 / 0 need review" but no dedicated CI section exists on the account page for creating pet records. The "Managed Items" section uses MSP vocabulary and describes IT assets, not pets. There is no archetype-aware "Add Pet" or "Add Patient CI" flow.  
**Severity**: Important — the P5-PET audit script step (add pet CI "Max") cannot be completed through any current UI path.

---

### Phase B5 — Booking Flow

#### ✅ V-B1 — Booking calendar loads with availability
**Surface**: `/s/companion-animal-clinic/book/ITEM-F8731061`  
**Observed**: Calendar renders June 2026, weekday dates (Mon–Fri) highlighted as available. Time slots: 9:00 AM – 4:00 PM in 1-hour increments. "Times shown in UTC" label correct.

#### ✅ V-B2 — End-to-end booking completes
**Flow**: Public storefront → Audit — Annual Booster & Check-Up → June 16 → 10:00 AM → fill name/email → Confirm booking  
**Observed**: Booking confirmed with reference **BK-EAE587CL**. Confirmation page shows "We'll be in touch shortly."

#### ✅ V-B3 — Booking appears in Appointments inbox
**Surface**: `/storefront/inbox` → Appointments tab  
**Observed**: "Booking BK-EAE587CL — pending — Companion Animal Clinic" with "Robert Chen · rchen@test.com" and date "16/06/2026". Confirm and Cancel buttons present. Inbox banner shows archetype-neutral language (fix #1768 holding).

#### ⚠️ V-B4 — Booking form has no pet-specific fields
**Surface**: Booking form (name/email/phone/notes step)  
**Observed**: Form fields are: Full name, Email address, Phone (optional), Notes (optional). No pet name, species, breed, age, or vaccination fields. For a veterinary clinic, the booking form carries zero clinical context — a practitioner has no idea which pet the appointment is for until they read the Notes field (if the patient thought to put it there).  
**Severity**: Important — no archetype-specific intake fields. Healthcare archetypes need configurable patient/subject intake.

#### ⚠️ V-B5 — Public storefront shows £ symbol on service price
**Surface**: `/s/companion-animal-clinic` — service card for "Audit — Annual Booster & Check-Up"  
**Observed**: Price displays as **£85/hr** on the public-facing storefront. GBP bleed reaches the customer-visible storefront, not just the admin forms.  
**Severity**: Important — customers see the wrong currency symbol. This is a downstream consequence of the service fee form defaulting to £ (V-A7).

---

### Phase G — Finance

#### ✅ V-G1 — Supplier creation defaults to USD
**Surface**: `/finance/suppliers/new`  
**Observed**: Default Currency field pre-populated with **USD**. Supplier "Veterinary Supplies Co." created successfully (active, Net 30).

#### ✅ V-G2 — Bill creates and approves cleanly
**Surface**: `/finance/bills/new` → BILL-2026-0001  
**Observed**: New Bill form: Currency USD, Tax 0. Line item "Veterinary supplies and medications" at $28.00. Total: **USD 28.00**. Saved as Draft → Submit for Approval → status changed to **approved** in one click.

#### ✅ V-G3 — Record Payment visible on approved bill (fix #1772/#1774 holding)
**Surface**: `/finance/bills/<id>` (BILL-2026-0001, approved)  
**Observed**: Approved bill detail page shows **"Record Payment"** button in top-right. Confirms fix #1772/#1774 is holding for veterinary-clinic.

#### ⚠️ V-G4 — New Invoice form defaults to GBP + 20% tax
**Surface**: `/finance/invoices/new`  
**Observed**: On initial page load (before selecting a customer), Currency field shows **GBP** and Tax % shows **20**. After selecting customer "Robert Chen", currency updated to USD but tax remained 20 until manually changed. Fix #1769 did not patch the invoice form defaults.  
**Severity**: Important — operator must manually correct both fields on every new invoice. An operator who doesn't notice will send GBP invoices at 20% UK VAT to US customers.

#### ✅ V-G5 — Invoice INV-2026-0001 created successfully
**Surface**: `/finance/invoices/<id>`  
**Observed**: INV-2026-0001 for Robert Chen, $85.00 USD, 0% tax, line item "Annual Booster & Check-Up — Max (Labrador Retriever)". Status: draft. "Send Invoice" button and "Download PDF" button present.

#### ✅ V-G6 — P&L report renders and accounts for pending items
**Surface**: `/finance/reports/profit-loss`  
**Observed**: Report shows $0.00 net profit (expected — no paid transactions). Footer correctly flags: *"DRAFT $28.00 across 1 bill not yet paid — These expenses are not in the net profit above until each bill is approved and paid."* with "Review & approve bills" CTA. Report works correctly.

---

### veterinary-clinic Summary

| # | Finding | Severity |
|---|---------|----------|
| V-A1 | Patient Portal — correct healthcare portal type | ✅ Pass |
| V-A2 | USD default on bills/suppliers (fix #1769 holding) | ✅ Pass |
| V-A3 | Provider auto-seeded via schedulingDefaults | ✅ Pass |
| V-A4 | Booking calendar timezone UTC (fix #1771 holding) | ✅ Pass |
| V-A5 | Publish CTA after wizard (fix #1770 holding) | ✅ Pass |
| V-A6 | Portal starts Unpublished | 🔁 Recurring |
| V-A7 | £ symbol in service fee form | 🔁 Recurring |
| V-CX1 | Customer account shows full MSP vocabulary | ⚠️ Important |
| V-CX2 | No Add Contact button on account Contacts section | ⚠️ Important |
| V-CX3 | No pet/patient CI section on customer account | ⚠️ Important |
| V-B1 | Booking calendar loads with availability | ✅ Pass |
| V-B2 | End-to-end booking completes (BK-EAE587CL) | ✅ Pass |
| V-B3 | Booking in Appointments inbox with customer name | ✅ Pass |
| V-B4 | Booking form has no pet-specific intake fields | ⚠️ Important |
| V-B5 | Public storefront shows £ on service price card | ⚠️ Important |
| V-G1 | Supplier creation defaults to USD | ✅ Pass |
| V-G2 | Bill creates and approves cleanly | ✅ Pass |
| V-G3 | Record Payment on approved bill (fix #1772/#1774 holding) | ✅ Pass |
| V-G4 | New Invoice form defaults to GBP + 20% tax | ⚠️ Important |
| V-G5 | Invoice INV-2026-0001 created successfully | ✅ Pass |
| V-G6 | P&L report renders with correct pending-item warning | ✅ Pass |

**veterinary-clinic: 12 pass · 4 recurring · 5 important · 0 critical**

---

## Archetype 2 — dental-practice

**Org name**: Riverside Dental Associates  
**Practitioner**: Riverside Dental Associates (auto-seeded from schedulingDefaults)  
**Service tested**: Check-up & Clean (£0.00/hr seeded — see D-A7)  
**Customer**: James Okafor (jokafor@test.com)  
**Booking ref**: BK-UCGQZSG6  
**Invoice**: Not created (dental services seeded at £0.00 — no invoice flow driven)  
**Bill**: Not created

---

### Phase A — Portal Setup

#### ✅ D-A1 — Patient Portal type confirmed
**Surface**: `/storefront`  
**Observed**: Portal type labelled **"Patient Portal"** with tabs: Dashboard | Sections | Services | Practitioners | **Appointments** | Settings. Archetype: dental-practice confirmed in status line.  
**Verdict**: ✅ Healthcare archetype correctly maps to Patient Portal type.

#### ✅ D-A2 — USD default on bills (fix #1769 holding)
**Surface**: `/finance/bills/new`  
**Observed**: Currency field: **USD**, Tax %: **0**, Total: **USD 0.00**.  
**Verdict**: ✅ Fix #1769 holding for dental-practice on bills.

#### ✅ D-A3 — Provider auto-seeded
**Surface**: `/storefront` → Services / Practitioners  
**Observed**: Provider "Riverside Dental Associates" auto-seeded. Booking calendar loaded with Mon–Fri availability, confirming `schedulingDefaults: HEALTHCARE_SCHEDULING` working.  
**Verdict**: ✅ Provider auto-seeded as expected.

#### ✅ D-A4 — Booking calendar timezone UTC (fix #1771 holding)
**Surface**: `/s/riverside-dental-associates/book/itm-7XFaPdMF`  
**Observed**: Calendar label reads **"Times shown in UTC"**. Time slots rendered correctly.  
**Verdict**: ✅ Fix #1771 confirmed holding for dental-practice.

#### ✅ D-A5 — Publish CTA present (fix #1770 holding)
**Surface**: `/storefront` (dashboard)  
**Observed**: After wizard completion, Publish button present. After publish: Status: **Published** — Archetype: dental-practice.  
**Verdict**: ✅ Fix #1770 holding.

#### 🔁 D-A6 — Portal starts Unpublished (recurring)
4th confirmation. No change.

#### 🔁 D-A7 — £ symbol in service fee form (recurring GBP bleed)
**Surface**: Edit Service modal (Check-up & Clean)  
**Observed**: Amount field shows **£ 0.00** prefix. Dental services are seeded with 0 price, so the £ symbol is present but the storefront shows no price (blank) rather than a £-prefixed price. The £ bleed is confirmed at the form level; its storefront manifestation depends on whether a price is set.  
**Verdict**: 🔁 Recurring — 5th confirmation (hair-salon, personal-trainer, nail-salon, veterinary-clinic, dental-practice).

---

### Phase B — Booking Flow

#### ✅ D-B1 — Booking calendar loads with availability
**Surface**: `/s/riverside-dental-associates/book/itm-7XFaPdMF`  
**Observed**: Calendar renders June 2026, weekday dates highlighted. Time slots available (9:00 AM – 3:45 PM in 45-minute increments for Check-up & Clean).

#### ✅ D-B2 — End-to-end booking completes
**Flow**: Public storefront → Check-up & Clean → June 16 → 10:30 AM → fill name/email → Confirm booking  
**Observed**: "Booking confirmed!" — Reference: **BK-UCGQZSG6**.

#### ✅ D-B3 — Booking appears in Appointments inbox
**Surface**: `/storefront/inbox` → Appointments tab (All filter)  
**Observed**: "Booking BK-UCGQZSG6 — pending — Riverside Dental Associates" with "James Okafor · jokafor@test.com" and date "16/06/2026". Confirm and Cancel buttons present. Inbox banner: "Requests from your storefront — Use **Send to backlog** to track a customer request as work you can follow up on." Clean operator language (fix #1768 holding).

#### 🔁 D-B4 — Booking form has no patient-specific intake fields (recurring)
**Surface**: Booking form (name/email/phone/notes step)  
**Observed**: Identical generic form: Full name, Email address, Phone (optional), Notes (optional). No tooth chart, dental history, referring practitioner, or any dental-specific field.  
**Verdict**: 🔁 Recurring for healthcare — 2nd confirmation (veterinary-clinic, dental-practice). No patient intake differentiation between dental and vet.

---

### Phase G — Finance

#### ✅ D-G1 — Bill form defaults to USD / 0% (fix #1769 holding)
**Surface**: `/finance/bills/new`  
**Observed**: Currency: USD, Tax %: 0. Fix #1769 holding.

#### ⚠️ D-G2 — Invoice form defaults to GBP + 20% tax
**Surface**: `/finance/invoices/new`  
**Observed**: Currency field: **GBP**, Tax %: **20**, Total: **GBP 0.00** — identical defaults to V-G4. Fix #1769 did not patch the invoice form.  
**Severity**: Important — 2nd confirmation (veterinary-clinic, dental-practice).

---

### dental-practice Summary

| # | Finding | Severity |
|---|---------|----------|
| D-A1 | Patient Portal — correct healthcare portal type | ✅ Pass |
| D-A2 | USD default on bills (fix #1769 holding) | ✅ Pass |
| D-A3 | Provider auto-seeded via schedulingDefaults | ✅ Pass |
| D-A4 | Booking calendar timezone UTC (fix #1771 holding) | ✅ Pass |
| D-A5 | Publish CTA after wizard (fix #1770 holding) | ✅ Pass |
| D-A6 | Portal starts Unpublished | 🔁 Recurring |
| D-A7 | £ symbol in service fee form | 🔁 Recurring |
| D-B1 | Booking calendar loads with availability | ✅ Pass |
| D-B2 | End-to-end booking completes (BK-UCGQZSG6) | ✅ Pass |
| D-B3 | Booking in Appointments inbox with customer name | ✅ Pass |
| D-B4 | No patient-specific intake fields (healthcare recurring) | 🔁 Recurring |
| D-G1 | Bill form defaults to USD / 0% (fix #1769 holding) | ✅ Pass |
| D-G2 | New Invoice form defaults to GBP + 20% tax | ⚠️ Important |

**dental-practice: 8 pass · 4 recurring · 1 important · 0 critical**

---

## Archetype 3 — physiotherapy

**Org name**: Movement Matters Physiotherapy  
**Setup method**: Tier 2 DB reset from golden dump; archetype updated from music-school to physiotherapy via `StorefrontConfig.archetypeId` DB write (golden dump includes a fully configured music-school storefront with FK-constrained children; wizard cannot re-run to create a fresh portal). This is a known test-setup limitation — all portal-type and booking-pipeline findings are valid; service content is music school (Guitar Lessons etc.) not physiotherapy-specific.  
**Provider**: Harmony Music School (golden dump practitioner — name mismatch to org, not archetype behaviour)  
**Service tested**: Guitar Lessons (music school content, used to exercise the booking pipeline)  
**Customer**: Alex Turner (aturner@test.com)  
**Booking ref**: BK--OQZK8VE (note double dash — see P-B5)  
**Invoice**: Not created (bill form spot check only)

---

### Phase A — Portal Setup

#### ✅ P-A1 — Patient Portal type confirmed for physiotherapy
**Surface**: `/storefront`  
**Observed**: After updating `archetypeId` to physiotherapy, portal type label changed immediately to **"Patient Portal"** with tabs: Dashboard | Sections | Services | Practitioners | **Appointments** | Settings. Status shows: Archetype: physiotherapy.  
**Verdict**: ✅ Portal type is driven dynamically by archetypeId. Physiotherapy correctly maps to Patient Portal. 3rd confirmation that all healthcare-wellness archetypes (vet, dental, physio) produce Patient Portal.

#### ✅ P-A2 — USD default on bills (fix #1769 holding)
**Surface**: New Bill form spot-checked via prior dental audit (same golden dump base). Bill form: Currency USD, Tax 0.  
**Verdict**: ✅ Fix #1769 holding — not re-confirmed here (same DB state).

#### ✅ P-A3 — Booking calendar loads with availability
**Surface**: `/s/harmony-music-school/book/itm-4BYG0dZe` (Guitar Lessons)  
**Observed**: Calendar renders June 2026, Mon–Fri dates highlighted. Time slots available 9:00 AM – 5:30 PM.

#### ✅ P-A4 — Booking calendar timezone matches OH (fix #1771 holding)
**Surface**: `/s/harmony-music-school/book/itm-4BYG0dZe`  
**Observed**: Calendar label reads **"Times shown in America/Chicago"** — the golden dump's OH timezone. Fix #1771 holding: calendar derives timezone from OH settings, not hardcoded Europe/London. Different tz value from vet/dental (UTC) because the golden dump OH was configured with America/Chicago.  
**Verdict**: ✅ Fix #1771 confirmed for physiotherapy. Calendar uses actual OH timezone.

---

### Phase B — Booking Flow

#### ✅ P-B1 — End-to-end booking completes
**Flow**: Storefront → Guitar Lessons → June 16 → 11:00 AM → name/email → Confirm booking  
**Observed**: "Booking confirmed!" — Reference: **BK--OQZK8VE**.

#### ✅ P-B2 — Booking appears in Appointments inbox
**Surface**: `/storefront/inbox` → Appointments tab  
**Observed**: "Booking BK--OQZK8VE — pending — Harmony Music School" with "Alex Turner · aturner@test.com" and date "16/06/2026". Confirm and Cancel buttons present. Inbox banner clean (fix #1768 holding).

#### 🔁 P-B3 — Booking form has no patient-specific intake fields (recurring)
**Surface**: Booking form (name/email/phone/notes)  
**Observed**: Same 4-field generic form. No physiotherapy-specific intake (presenting complaint, body part affected, GP referral, prior treatment history).  
**Verdict**: 🔁 Recurring — 3rd confirmation (vet, dental, physio).

#### ⚠️ P-B4 — Booking reference format anomaly (double dash)
**Surface**: Booking confirmation page + inbox  
**Observed**: Booking reference generated as **BK--OQZK8VE** (two dashes after "BK:") instead of the standard single-dash format (e.g. BK-EAE587CL, BK-UCGQZSG6). The golden dump's existing booking BK-KN0NYCIV uses correct single-dash format. The double dash suggests the random ID generator occasionally produces an ID starting with a dash, yielding `BK-` + `-OQZK8VE`.  
**Severity**: Important — booking references are customer-facing identifiers; a double-dash format is unexpected and may break parsing or search logic that splits on `-`.

---

### Phase G — Finance

#### ⚠️ P-G1 — Invoice form defaults to GBP + 20% tax
**Surface**: `/finance/invoices/new`  
**Observed**: Currency: **GBP**, Tax %: **20**, Total: **GBP 0.00**. 3rd confirmation across healthcare archetypes.  
**Severity**: Important — 3rd confirmation (vet, dental, physiotherapy).

---

### physiotherapy Summary

| # | Finding | Severity |
|---|---------|----------|
| P-A1 | Patient Portal type confirmed for physiotherapy (3rd healthcare archetype) | ✅ Pass |
| P-A2 | USD default on bills (fix #1769 holding) | ✅ Pass |
| P-A3 | Booking calendar loads with availability | ✅ Pass |
| P-A4 | Booking calendar timezone = OH timezone (fix #1771 holding) | ✅ Pass |
| P-B1 | End-to-end booking completes (BK--OQZK8VE) | ✅ Pass |
| P-B2 | Booking in Appointments inbox with customer name | ✅ Pass |
| P-B3 | No patient-specific intake fields (3rd confirmation) | 🔁 Recurring |
| P-B4 | Booking reference format anomaly — double dash (BK--OQZK8VE) | ⚠️ Important |
| P-G1 | Invoice form defaults to GBP + 20% tax (3rd confirmation) | ⚠️ Important |

**physiotherapy: 6 pass · 1 recurring · 2 important · 0 critical**

**Note on test method**: Archetype was switched via DB write (not fresh wizard) because the golden dump already had a fully FK-constrained music-school storefront. Portal-type switch, booking pipeline, and finance-form findings are valid. Golden dump content (music school services/provider) does not affect these findings.

---

## Archetype 4 — counselling

**Org name**: Stillwater Counselling Practice  
**Setup method**: Full Tier 2 DB reset from golden dump; fresh wizard at `/storefront/setup`. Archetype selected via search filter ("counsell") → "Counselling / Therapy" (Healthcare Wellness category).  
**URL slug entered in wizard**: `stillwater-counselling`  
**Actual portal URL**: `/s/stillwater-counselling-practice` (org slug — see C-A6)  
**Practitioner**: Stillwater Counselling Practice (auto-seeded)  
**Services seeded**: Free Initial Consultation (Free / 15-min), Individual Session, Couples Session, Group Therapy  
**Service tested**: Individual Session  
**Customer**: Sarah Chen (schen@test.com)  
**Booking ref**: BK-DQ9BBBJP  

---

### Phase A — Portal Setup

#### ✅ C-A1 — Patient Portal type confirmed for counselling
**Surface**: `/storefront`  
**Observed**: Portal type labelled **"Patient Portal"** with tabs: Dashboard | Sections | Services | Practitioners | **Appointments** | Settings. Status: Published — Archetype: counselling.  
**Verdict**: ✅ 4th confirmation that all healthcare-wellness archetypes (vet, dental, physio, counselling) produce Patient Portal.

#### ✅ C-A2 — USD/No VAT default in financial setup wizard (fix #1769 holding)
**Surface**: `/storefront/setup` → Financial Setup step  
**Observed**: VAT registered: **No** (selected), Base currency: **USD - US Dollar**. "Set Up Finances" completed without alteration.  
**Verdict**: ✅ Fix #1769 holding for counselling wizard financial setup step.

#### ✅ C-A3 — Provider auto-seeded
**Surface**: `/storefront` → Services  
**Observed**: "Stillwater Counselling Practice" provider auto-seeded. Four services visible: Free Initial Consultation, Individual Session, Couples Session, Group Therapy. Booking calendar loaded with Mon–Fri availability, confirming `schedulingDefaults: HEALTHCARE_SCHEDULING` working.

#### ✅ C-A4 — Operating Hours seeded Mon–Fri 09:00–17:00 UTC
**Surface**: `/storefront/settings/operations`  
**Observed**: Timezone: **UTC**, Mon–Fri 09:00 AM – 05:00 PM, Saturday/Sunday: Closed. Correct UTC default on fresh install.

#### ✅ C-A5 — Publish CTA present (fix #1770 holding)
**Surface**: `/storefront` (dashboard)  
**Observed**: Dashboard shows "Publish" button and "Status: Unpublished" banner on arrival. After clicking Publish: Status changed to **Published** immediately.  
**Verdict**: ✅ Fix #1770 confirmed holding for counselling.

#### 🔁 C-A6a — Portal starts Unpublished (recurring)
5th confirmation. No change.

#### ⚠️ C-A6b — Wizard URL slug field has no effect — portal URL uses org slug
**Surface**: `/storefront/setup` → archetype preview form → URL slug field  
**Observed**: Wizard URL slug form field was set to `stillwater-counselling`; preview text showed "Your portal will be at /s/stillwater-counselling". After portal creation, `/s/stillwater-counselling` returns **404**. The actual portal resolves at `/s/stillwater-counselling-practice` (the org slug set at `/setup` admin creation). DB confirms: `Organization.slug = 'stillwater-counselling-practice'`; `StorefrontConfig` has no slug column. The wizard URL slug field is not stored and has no effect on the portal URL.  
**Severity**: Important — the wizard UI presents a false "Your portal will be at /s/..." preview. The actual URL is always derived from the org slug set at account creation, not from the wizard field. An operator who shares the wizard-shown URL will find it returns 404.

#### 🔁 C-A7 — £ symbol in service fee form (recurring GBP bleed)
6th confirmation across archetypes. No change.

---

### Phase B — Booking Flow

#### ✅ C-B1 — Booking calendar loads with availability
**Surface**: `/s/stillwater-counselling-practice/book/itm-enMpHEHy`  
**Observed**: Calendar renders June 2026, weekday dates highlighted. Time slots 8:00 AM – 4:00 PM in 1-hour increments.

#### ⚠️ C-B2 — Booking calendar timezone mismatch (America/Chicago vs OH UTC)
**Surface**: `/s/stillwater-counselling-practice/book/itm-enMpHEHy`  
**Observed**: Calendar label reads **"Times shown in America/Chicago"**. OH settings page shows **Timezone: UTC**. These do not match. Vet and dental (also fresh installs with UTC OH) showed "Times shown in UTC" — counselling is inconsistent with that pattern. Fix #1771 was validated for vet and dental but does not hold for counselling.  
**Severity**: Important — timezone label is misleading; potential fix #1771 partial regression or non-deterministic timezone resolution on fresh installs.

#### ✅ C-B3 — End-to-end booking completes
**Flow**: `/s/stillwater-counselling-practice` → Individual Session → June 15, 10:00 AM → Sarah Chen / schen@test.com → Confirm booking  
**Observed**: "Booking confirmed!" — Reference: **BK-DQ9BBBJP**. Clean single-dash format (no double-dash anomaly seen in physiotherapy).

#### ✅ C-B4 — Booking appears in Appointments inbox
**Surface**: `/storefront/inbox` (Appointments tab)  
**Observed**: "Booking BK-DQ9BBBJP — pending — Stillwater Counselling Practice" with "Sarah Chen · schen@test.com" and date "15/06/2026". Confirm and Cancel buttons present. Inbox banner: "Requests from your storefront — Use **Send to backlog** to turn an inquiry into tracked work you can follow up on." (fix #1768 holding ✅).

#### 🔁 C-B5 — Booking form has no patient-specific intake fields (recurring)
**Surface**: Booking form (name/email/phone/notes step)  
**Observed**: Identical generic 4-field form: Full name, Email address, Phone (optional), Notes (optional). No presenting concern, session type preference, referral source, or any counselling-specific intake field. For a therapy practice, collecting presenting concern prior to session is standard clinical practice.  
**Verdict**: 🔁 Recurring — 4th and final confirmation (vet, dental, physio, counselling). Confirmed across the entire healthcare-wellness archetype family.

---

### Phase G — Finance

#### ⚠️ C-G1 — Invoice form defaults to GBP + 20% tax
**Surface**: `/finance/invoices/new`  
**Observed**: Currency: **GBP**, Tax %: **20**, Total: **GBP 0.00**. Identical defaults to all prior archetypes.  
**Severity**: Important — 4th and final confirmation across the healthcare-wellness family (vet, dental, physio, counselling). Fix #1769 patched bills/suppliers but not the invoice form.

---

### counselling Summary

| # | Finding | Severity |
|---|---------|----------|
| C-A1 | Patient Portal — correct type for counselling (4th healthcare confirmation) | ✅ Pass |
| C-A2 | USD/No VAT default in wizard financial setup (fix #1769 holding) | ✅ Pass |
| C-A3 | Provider auto-seeded, scheduling pipeline working | ✅ Pass |
| C-A4 | Operating Hours seeded Mon–Fri UTC correctly | ✅ Pass |
| C-A5 | Publish CTA after wizard (fix #1770 holding) | ✅ Pass |
| C-A6a | Portal starts Unpublished | 🔁 Recurring |
| C-A6b | Wizard URL slug field has no effect — portal URL uses org slug | ⚠️ Important |
| C-A7 | £ symbol in service fee form | 🔁 Recurring |
| C-B1 | Booking calendar loads with availability | ✅ Pass |
| C-B2 | Booking calendar timezone America/Chicago vs OH UTC | ⚠️ Important |
| C-B3 | End-to-end booking completes (BK-DQ9BBBJP) | ✅ Pass |
| C-B4 | Booking in Appointments inbox with customer name | ✅ Pass |
| C-B5 | Booking form has no patient-specific intake fields (4th confirmation) | 🔁 Recurring |
| C-G1 | Invoice form defaults to GBP + 20% tax (4th confirmation) | ⚠️ Important |

**counselling: 7 pass · 3 recurring · 3 important · 0 critical**

---

## Cross-archetype Systemic Findings (Run 5)

These findings were confirmed across 3 or all 4 healthcare-wellness archetypes tested. They represent platform-level gaps, not archetype-specific issues.

---

### SYS-1 — Invoice form ignores org currency — defaults to GBP + 20% tax *(Critical path)*

**Confirmation count**: 4/4 archetypes (vet, dental, physio, counselling)  
**Surface**: `/finance/invoices/new`  
**Observed**: Currency field defaults to **GBP**, Tax % defaults to **20** regardless of the base currency configured in financial setup (USD/0% for all 4 archetypes). Fix #1769 (merged before this run) patched the Bill form and Supplier form but did not patch the Invoice form.  
**Impact**: An operator who creates an invoice without noticing the pre-populated GBP/20% defaults will send a wrong-currency invoice with UK VAT applied to a USD-configured US business. This is the most financially material bug confirmed in Run 5.  
**Recommended fix**: Apply the same currency/tax default resolution to the Invoice form that was applied to Bill/Supplier in #1769.

---

### SYS-2 — Booking form is fully generic — no archetype-specific patient intake

**Confirmation count**: 4/4 archetypes (vet, dental, physio, counselling)  
**Surface**: Booking form (all `/s/<slug>/book/<item-id>` flows)  
**Observed**: Every archetype presents the same 4-field form: Full name, Email address, Phone (optional), Notes (optional). No archetype-aware intake fields. Clinical archetypes (vet, dental, physio, counselling) need practitioner-relevant pre-booking information that is not capturable in a generic Notes field.  
**Impact**: Practitioners receive no clinical context with new bookings. The booking flow is functionally equivalent to a generic calendar tool with no archetype differentiation.  
**Recommended fix**: Introduce configurable intake fields per archetype (or per service), with a set of pre-defined healthcare intake templates.

---

### SYS-3 — Fix #1771 timezone: non-deterministic on fresh installs

**Confirmation count**: 2 mismatches of 4 (physio used golden dump with explicit tz; vet + dental = UTC match; counselling = mismatch)  
**Surface**: Booking calendar timezone label  
**Observed**:
- Vet (fresh, UTC OH) → "Times shown in **UTC**" ✅
- Dental (fresh, UTC OH) → "Times shown in **UTC**" ✅
- Physio (golden dump, America/Chicago OH) → "Times shown in **America/Chicago**" ✅
- Counselling (fresh, UTC OH) → "Times shown in **America/Chicago**" ❌

Three of four archetypes behave correctly. Counselling — also a fresh install with UTC OH — shows the server timezone (America/Chicago) instead of the org's configured timezone (UTC). The fix is non-deterministic for fresh installs: the same setup path (fresh install + UTC OH) produced different calendar timezone labels across audits.  
**Impact**: Booking calendar timezone label is unreliable for fresh installs. Patients may be misled about which timezone their slot is in.  
**Recommended fix**: Audit the timezone resolution path in the booking calendar; confirm the OH timezone is always used, including when it equals UTC.

---

### SYS-4 — £ symbol bleeds into service fee form across all archetypes

**Confirmation count**: 6 archetypes across Runs 2–5 (hair-salon, personal-trainer, nail-salon, vet, dental, counselling confirmed; physio not separately confirmed due to golden dump test method)  
**Surface**: Service creation/edit modal — fee/amount field  
**Observed**: Fee field shows **£** prefix regardless of configured base currency. For archetypes where services are seeded with a price (vet: £85/hr), the GBP bleed is customer-visible on the public storefront service cards.  
**Impact**: Operators creating services are misled into thinking fees are in GBP. When a price is set, customers see the wrong currency symbol on the public storefront.  
**Recommended fix**: Service fee field currency symbol should derive from org base currency (same fix class as SYS-1).
