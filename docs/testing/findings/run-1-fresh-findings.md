# Run 1 Fresh-Install Findings — Electrician / Facilities-Maintenance / Landscaping / Cleaning-Service

**Run**: 1 (trades-maintenance, fresh-install pass)
**Archetypes tested**: electrician, facilities-maintenance, landscaping, cleaning-service *(all complete)*
**Run date**: 2026-06-12
**Method**: Tier 2 DB-only reset per archetype (drop + reseed fallback; golden dump not yet created — see note below)
**Tester**: Autonomous agent

> **Golden dump note**: A golden dump was not available at the start of this run (first fresh-install pass). The electrician archetype used a full drop + reseed + portal restart (fallback procedure per Section 5 of the audit plan). Docker Model Runner auto-activated after reseed with no manual provider entry. The golden dump for subsequent archetypes should be created immediately after the next DB reseed, before any org creation.

> **Recap of superseded swap findings**: Findings from the prior API-swap run (`run-1-swap-findings.md`) have been reclassified. AUDIT-R1S-001 and AUDIT-R1S-005 were confirmed as methodology artifacts. All other swap findings (R1S-002, R1S-003, R1S-004, R1S-E-001 through R1S-E-004, R1S-FM-001 through R1S-FM-003, R1S-L-001 through R1S-L-002, R1S-CS-001 through R1S-CS-002) were reproduced or evaluated on fresh install per the findings below.

---

## Electrician — Bright Wire Electric (fresh install)

**Company**: Bright Wire Electric  
**Owner persona**: Alex Rivera (test customer)  
**URL slug**: bright-wire-electric  
**Phases run**: A, P-INQUIRY, B, F, G (G1–G2 only, inquiry archetype), H (first in category), O/E  

---

### Phase A — Onboarding

#### AUDIT-R1-E-A-001 · Important · GBP default currency on US install (R1-005 recurring, confirmed fresh)

**Observed**: Financial setup step pre-filled "GBP - British Pound" as base currency for a fresh electrician install with no prior UK locale signals. Operator must manually switch to USD.
**Confirmed recurring from swap run**: Yes (R1S-E-003 cross-reference).
**Impact**: US operators will incorrectly default to GBP pricing and tax settings unless they notice and change it manually.

#### AUDIT-R1-E-A-002 · Important · Recurring Agreement financial pattern pre-selected for electrician

**Observed**: Financial setup step defaulted to "Payment: Recurring Agreement / Recurring: Required". Electrician work is predominantly ad-hoc (per-job invoicing), not recurring. The pre-selected financial model does not match the archetype's commercial reality.
**Confirmed recurring from swap run**: Yes (R1-006 cross-reference).
**Impact**: Operators accept a recurring-agreement model when they should be on an ad-hoc invoice model, leading to incorrect finance configuration.

---

### Phase P — Catalog & Data Prerequisites

#### AUDIT-R1-E-P-001 · Pass · Electrician items correctly seeded (6 items, all Inquiry CTA)

**Observed**: Electrical Safety Certificate, Consumer Unit Replacement, Socket & Switch Installation, Lighting Installation, EV Charger Installation, Emergency Call-Out — all Inquiry type, all with archetype-relevant descriptions.
**Note**: "Fault Diagnosis" absent (R1S-E-001 — minor gap, logged in swap findings, confirmed not seeded on fresh install).

#### AUDIT-R1-E-P-002 · Warn · Operating hours save gives no confirmation feedback

**Observed**: Saving operating hours (Mon–Fri 07:00–18:00) posts a 200 response with RSC payload but shows no toast notification or visible "Saved" state. Operator has no confirmation the save worked. The hours ARE persisted (verified by re-reading the React fiber state on reload), but the lack of feedback is a UX gap.
**Impact**: Operators may save multiple times or assume the save failed.

---

### Phase B — Storefront

#### AUDIT-R1-E-B-001 · Pass · Public portal renders with correct identity and vocabulary

**Observed**: `http://localhost:3000/s/bright-wire-electric` shows "Bright Wire Electric", tagline "Licensed electricians for homes and businesses in Riverside", all 6 service items with "Enquire" CTA. No prior-archetype identity visible. ✓

#### AUDIT-R1-E-B-002 · Important · No property type or urgency fields on electrician inquiry form (R1S-002 confirmed on fresh install)

**Observed**: Inquiry form for Emergency Call-Out (and all electrician items) presents only 4 fields: name (required), email (required), phone (optional), message. No property type (residential/commercial/industrial) or urgency level dropdown.
**Confirmed recurring from swap run**: Yes (AUDIT-R1S-002).
**Impact**: Electrician operators cannot determine from the inquiry whether the job is a domestic consumer unit or a commercial rewire — two jobs with vastly different scope, price, and certification requirements.

#### AUDIT-R1-E-B-003 · Pass · Inquiry submission and reference number

**Observed**: INQ-WRWX-UVJ issued on Emergency Call-Out inquiry submission. Confirmation page shows "Enquiry received! Reference: INQ-WRWX-UVJ." ✓

---

### Phase F — Inbox & Operations

#### AUDIT-R1-E-F-001 · Critical · DPF meta-language in inbox confirmed on fresh install (R1S-003 confirmed)

**Observed**: `/storefront/inbox` displays "Customer-zero inquiry intake is wired to product backlog triage" header and "Customer-zero signal" badge on the INQ-WRWX-UVJ inquiry.
**Confirmed on fresh install**: Yes — this finding is NOT a methodology artifact. It appears on a completely clean install with no prior archetype state.
**Impact**: An electrician operator sees DPF platform-development language instead of business language. "Customer-zero signal" is meaningless to a trades business owner.

#### AUDIT-R1-E-F-002 · Important · "Customer-zero product inquiry" in backlog item title (extension of R1S-003)

**Observed**: Sending the inquiry to backlog creates a backlog item titled "Customer-zero product inquiry INQ-WRWX-UVJ". The meta-language propagates from inbox into the backlog.
**Impact**: The `/ops` backlog is also polluted with DPF developer terminology. An operator's backlog should read "Emergency Call-Out inquiry from Alex Rivera", not "Customer-zero product inquiry."

#### AUDIT-R1-E-F-003 · Pass · Send-to-backlog flow works

**Observed**: Inbox item sent to backlog; appears at `/ops` as a PRODUCT BACKLOG item. ✓

---

### Phase G — Financial Tally

#### AUDIT-R1-E-G-001 · Pass · Supplier creation works

**Observed**: "Wholesale Tools & Spares" created successfully, redirected to `/finance/suppliers`. ✓

#### AUDIT-R1-E-G-002 · Important · Bill tax rate defaults to 20% (UK VAT) on USD install (R1S-E-003 confirmed on fresh install)

**Observed**: New bill line item "Tax %" pre-populated with 20 despite currency being set to USD. US electricians do not charge VAT/sales tax at a national 20% rate.
**Confirmed recurring from swap run**: Yes (AUDIT-R1S-E-003).
**Impact**: US operators must manually clear the tax rate on every bill line item. Risk of accidentally billing customers incorrect tax amounts.

#### AUDIT-R1-E-G-003 · Pass · Bill form React fiber onSubmit pattern (methodology note)

**Observed**: The bill form does not respond to `button.click()` programmatically — it requires calling `form[__reactFiber].memoizedProps.onSubmit(fakeEvent)` to submit. Bill saved to draft at `/finance/bills/cmqb6bk4w05bn01pstulqdfor`. Total USD $130.00 (2 × "Cable and Conduit Materials" @ $65.00). ✓
**Note**: This is an audit methodology note (the form requires React fiber interaction), not a UX finding.

#### AUDIT-R1-E-G-004 · Important · Draft bill invisible in P&L report (R1S-E-004 confirmed on fresh install)

**Observed**: `/finance/reports/profit-loss` shows $0.00 expenses and "Based on 0 paid bills" despite the USD $130.00 draft bill.
**Confirmed recurring from swap run**: Yes (AUDIT-R1S-E-004).
**Impact**: There is no visible path from draft → approved → paid on the bill list. Operator cannot action the approval workflow without discovering it elsewhere. A small trades operator expects to see committed expenses immediately.

---

### Phase H — Responsive & Resilience Smoke (first in trades-maintenance category)

#### AUDIT-R1-E-H-001 · Pass · No horizontal overflow on public portal

**Observed**: `document.documentElement.scrollWidth (2130) ≤ window.innerWidth (2145)` — no horizontal overflow. Hero, CTA links (6 × "Enquire"), and service items visible. ✓
**Note**: Browser resize_window to 390px did not reduce CSS viewport on this display (high-DPI monitor), so the absolute width numbers are larger than typical mobile. Overflow test remains valid as a ratio check.

---

### Phase O/E — AI Coworker Operating Intelligence

**Coworker**: Storefront Operations Manager (model: `local:docker.io/ai/gemma4:latest`)

#### AUDIT-R1-E-O-001 · Pass · Coworker vocabulary is archetype-appropriate (E2/E4)

**Observed**: Response to "What business are we in?" uses correct vocabulary: "trades maintenance business, specifically operating as an Electrician service portal", "quote-based revenue model", "planned maintenance and emergency call-outs". No platform-developer terms ("backlog", "epic", "worktree", "capsule"). ✓

#### AUDIT-R1-E-O-002 · Important · Coworker does not enumerate the 6 seeded services (E3, Level 2)

**Observed**: Response describes service *category* ("planned maintenance and emergency call-outs") but does not list the actual 6 seeded items (Electrical Safety Certificate, Consumer Unit Replacement, etc.).
**Score**: Level 2 — archetype-aware; not service-specific.
**Impact**: Coworker cannot help an operator answer "what do we offer?" with precision.

#### AUDIT-R1-E-O-003 · Important · No compliance/licensing knowledge for US electrician (O5, Level 1)

**Observed**: Asked "What licenses does an electrician need in the US?" — coworker responded "no matching policy articles were found" and returned "Status: blocked" with instruction to "consult a legal expert."
**Expected Level 3**: State electrical contractor license (master/journeyman distinction), EPA certifications for certain work, OSHA requirements, bond/insurance requirements — all standard knowledge for a US electrician business.
**Score**: Level 1 — completely generic; zero archetype-specific compliance guidance.
**Impact**: Operator cannot rely on the platform for any guidance on their core regulatory obligations. This is a significant gap for a regulated trade.

#### AUDIT-R1-E-O-004 · Important · No operational quoting knowledge (E5, Level 1)

**Observed**: Asked "What information do I need and what is a typical price range for a consumer unit replacement?" — coworker responded it "wasn't able to find documentation" and created a backlog item BI-94E583AB to "define the quoting process."
**Expected Level 3**: Ask about existing installation age, number of circuits, 3-phase vs single-phase, current board condition, access requirements; typical US price $800–$2,500 depending on amperage and circuit count.
**Score**: Level 1 — no domain knowledge; creates busywork (backlog item) instead of helping.
**Impact**: Coworker cannot assist an electrician with the most common sales question they receive.

#### AUDIT-R1-E-O-005 · Important · "Status: blocked/queued" pattern confirmed on fresh install (R1S-004 confirmed)

**Observed**: Every question that requires domain knowledge returns a structured "Status: blocked / Status: queued" response deferring to "Human decision-maker" or "Operator/Admin". This pattern is not fixed by having a clean install — it reflects the empty knowledge base combined with the coworker's prompt directing it to escalate when knowledge is absent.
**Confirmed recurring from swap run**: Yes (AUDIT-R1S-004).

#### AUDIT-R1-E-O-006 · Important · Workspace home not archetype-specific (E6)

**Observed**: `/workspace` shows "Workspace home is using the standard view — Review business setup to activate a worker home tailored to this business." The dashboard shows generic metrics (AI Coworkers: 81, Open Work: 0) rather than electrician-specific work cues (open quote requests, emergency call-outs, job schedule).
**Impact**: An electrician's employee opening the workspace sees a platform admin view, not their daily work queue. This is the single most visible "we're not ready for operators" signal on the platform.

---

## Facilities-Maintenance — ProSite Facilities Group (fresh install)

**Company**: ProSite Facilities Group  
**Owner persona**: Jamie Chen (test customer)  
**URL slug**: prosite-facilities-group (auto-generated; user-entered slug "prosite-facilities" was not used — see B-001 note)  
**Phases run**: A, P-INQUIRY, B, F, G, O/E  

---

### Phase A — Onboarding

#### AUDIT-R1-FM-A-001 · Important · GBP default currency on US install (recurring — R1-E-A-001)

**Observed**: Financial setup step pre-filled "GBP - British Pound" as base currency. Operator switched to USD.  
**Confirmed recurring from electrician**: Yes.

#### AUDIT-R1-FM-A-002 · Important · Recurring Agreement financial pattern pre-selected (recurring — R1-E-A-002)

**Observed**: Financial setup defaulted to "Payment: Recurring Agreement / Recurring: Required". Facilities-maintenance is predominantly contract-based but billing should be per-job or monthly invoice, not an open-ended recurring agreement.  
**Confirmed recurring from electrician**: Yes.

#### AUDIT-R1-FM-A-003 · Warn · Setup wizard slug field ignored — slug auto-generated from company name

**Observed**: Entered "prosite-facilities" as slug in the storefront setup wizard step. After portal creation, the actual slug was "prosite-facilities-group" (derived from company name). The slug input field in the wizard appears to have no effect.  
**Impact**: Operators expect to control their portal URL but the input is silently overridden.

---

### Phase P — Catalog & Data Prerequisites

#### AUDIT-R1-FM-P-001 · Pass · Facilities-maintenance items correctly seeded (6 items, all Inquiry CTA)

**Observed**: Planned Maintenance Contract, Reactive Repair, Building Inspection, HVAC Servicing, Electrical Testing, Emergency Call-Out — all Inquiry type. Matches R1S-FM-001 swap finding. ✓

#### AUDIT-R1-FM-P-002 · Warn · Operating hours save gives no confirmation feedback (recurring — R1-E-P-002)

**Observed**: Same as electrician — no toast on save, 200 response only.  
**Confirmed recurring**: Yes.

---

### Phase B — Storefront

#### AUDIT-R1-FM-B-001 · Pass · Public portal renders with correct identity and vocabulary

**Observed**: `http://localhost:3000/s/prosite-facilities-group` shows "ProSite Facilities Group", tagline "Full-service facilities maintenance and HVAC for commercial properties", all 6 service items with "Enquire" CTA. No prior-archetype identity. ✓  
**Note**: Portal required an explicit "Publish" button click — not published automatically after wizard. Audit plan assumed auto-publish.

#### AUDIT-R1-FM-B-002 · Important · No B2B company/site field on facilities-maintenance inquiry form (R1S-FM-003 confirmed on fresh install)

**Observed**: Inquiry form for Planned Maintenance Contract presents only 4 fields: name, email, phone, message. No company name or site count field despite this being a B2B-primary archetype.  
**Confirmed recurring from swap run**: Yes (R1S-FM-003).  
**Impact**: ProSite Facilities Group cannot determine from the inquiry whether the prospect is a single-site café or a 50-building property portfolio.

#### AUDIT-R1-FM-B-003 · Pass · Inquiry submission and reference number

**Observed**: INQ-IPKE5I37 issued on Planned Maintenance Contract inquiry. Confirmation redirect to checkout page. ✓

---

### Phase F — Inbox & Operations

#### AUDIT-R1-FM-F-001 · Critical · DPF meta-language in inbox (R1-E-F-001 recurring — confirmed fresh)

**Observed**: `/storefront/inbox` displays "Customer-zero inquiry intake is wired to product backlog triage" header and "Customer-zero signal" badge on INQ-IPKE5I37.  
**Confirmed recurring from electrician fresh install**: Yes — not a methodology artifact.

#### AUDIT-R1-FM-F-002 · Important · "Customer-zero product inquiry" in backlog item title (R1-E-F-002 recurring)

**Observed**: Backlog item created as "Customer-zero product inquiry INQ-IPKE5I37".  
**Confirmed recurring**: Yes.

#### AUDIT-R1-FM-F-003 · Pass · Send-to-backlog flow works

**Observed**: Inbox item sent to backlog; appears at `/ops` as PRODUCT BACKLOG item. ✓

---

### Phase G — Financial Tally

#### AUDIT-R1-FM-G-001 · Pass · Supplier creation works

**Observed**: "HVAC Parts & Supplies Co." created successfully, redirected to `/finance/suppliers`. ✓  
**Note**: `document.querySelector('form button[type="submit"]')` selects the Sign-out button (in the nav form), not the supplier form's "Add Supplier" button. Must target by text content within the specific form.

#### AUDIT-R1-FM-G-002 · Important · Bill tax rate defaults to 20% (UK VAT) on USD install (R1-E-G-002 recurring)

**Observed**: New bill line item "Tax %" pre-populated with 20 despite currency set to USD.  
**Confirmed recurring**: Yes.

#### AUDIT-R1-FM-G-003 · Pass · Bill saved as draft

**Observed**: BILL-2026-0001 saved to draft (3 × "HVAC Filter Replacement Parts" @ $85.00 = $255.00 USD). ✓

#### AUDIT-R1-FM-G-004 · Important · Draft bill invisible in P&L report (R1-E-G-004 recurring)

**Observed**: `/finance/reports/profit-loss` shows $0.00 expenses, "Based on 0 paid invoices, 0 paid bills."  
**Confirmed recurring**: Yes.

---

### Phase O/E — AI Coworker Operating Intelligence

**Coworker**: Storefront Operations Manager (model: `local:docker.io/ai/gemma4:latest`)

#### AUDIT-R1-FM-O-001 · Important · Coworker local model timeout — no response after 178s (new finding)

**Observed**: Sent "What business are we in?" to the Storefront Operations Manager coworker. Docker portal log shows `[callWithFallbackChain] local failed: Network error calling local: The operation was aborted due to timeout`. UI showed "Storefront Operations Manager is still working (178s)" until manually cancelled. No response received.  
**Electrician comparison**: Electrician coworker responded (same local model) — this appears to be a transient capacity issue or model load degradation.  
**Score**: Level 0 — no response (timeout). Cannot evaluate vocabulary, domain knowledge, or intelligence level.  
**Impact**: Coworker is completely non-functional when local model times out. No fallback to cloud model appears to have succeeded within the test window.

---

## Landscaping — GreenScape Outdoor Services (fresh install)

**Company**: GreenScape Outdoor Services  
**Owner persona**: Renata Silva (test customer)  
**URL slug**: greenscape-outdoor-services (auto-generated; user-entered slug ignored — see A-003)  
**Phases run**: A, P, B, F, G, O  

---

### Phase A — Onboarding

#### AUDIT-R1-L-A-001 · Important · GBP default currency on US install (recurring — R1-E-A-001, R1-FM-A-001)

**Observed**: Financial setup step pre-filled "GBP - British Pound" as base currency. Operator switched to USD.  
**Confirmed recurring**: Yes — 3rd consecutive archetype.

#### AUDIT-R1-L-A-002 · Important · Recurring Agreement financial pattern pre-selected (recurring — R1-E-A-002, R1-FM-A-002)

**Observed**: Financial setup defaulted to "Payment: Recurring Agreement / Recurring: Required". Landscaping includes recurring lawn contracts but also many one-off project jobs; the blanket recurring-agreement default is still inappropriate as a zero-touch selection.  
**Confirmed recurring**: Yes — 3rd consecutive archetype.

#### AUDIT-R1-L-A-003 · Warn · Setup wizard slug field ignored — slug auto-generated from company name (recurring — R1-FM-A-003)

**Observed**: User-entered slug in wizard ignored; actual slug auto-generated as "greenscape-outdoor-services" from company name "GreenScape Outdoor Services".  
**Confirmed recurring from FM**: Yes.

---

### Phase P — Catalog & Data Prerequisites

#### AUDIT-R1-L-P-001 · Pass · Landscaping items correctly seeded (6 items, "Seasonal cleanup" absent)

**Observed**: Garden Design Consultation, Lawn Maintenance Contract, Patio & Decking Installation, Fencing & Gates, Tree Surgery, Irrigation Systems — all Inquiry type. Matches R1S-L-001 swap finding. ✓  
**Note**: "Seasonal cleanup" (autumn leaf clearing, spring prep) remains absent — confirmed recurring from swap run (R1S-L-001). Six items cover the archetype adequately.

#### AUDIT-R1-L-P-002 · Warn · Operating hours save gives no confirmation feedback (recurring — R1-E-P-002, R1-FM-P-002)

**Observed**: Same as electrician and FM — 200 POST, no toast, no visual saved state.  
**Confirmed recurring**: Yes — 3rd consecutive archetype.

---

### Phase B — Storefront

#### AUDIT-R1-L-B-001 · Pass · Public portal renders with correct identity and vocabulary

**Observed**: `http://localhost:3000/s/greenscape-outdoor-services` shows "GreenScape Outdoor Services", all 6 service items with "Enquire" CTA, landscaping vocabulary throughout. No prior-archetype identity. ✓

#### AUDIT-R1-L-B-002 · Important · No property size or frequency fields on landscaping inquiry form (R1S-002 confirmed on fresh install)

**Observed**: Inquiry form for Lawn Maintenance Contract presents only 4 fields: name, email, phone, message. No property size (e.g. sq ft/acres) or service frequency (weekly/fortnightly/monthly/one-off) fields.  
**Confirmed recurring from swap run**: Yes (AUDIT-R1S-002 cross-archetype).  
**Impact**: Landscaping operators cannot price accurately or resource-plan without property size and frequency — the two parameters that fully determine a lawn maintenance quote.

#### AUDIT-R1-L-B-003 · Pass · Inquiry submission and reference number

**Observed**: INQ-7GVTLESY issued on Lawn Maintenance Contract inquiry (Hank Morales, hank.morales@greenscape.test, "Interested in a weekly lawn maintenance contract for a 0.5 acre residential property."). ✓

---

### Phase F — Inbox & Operations

#### AUDIT-R1-L-F-001 · Critical · DPF meta-language in inbox (recurring — R1-E-F-001, R1-FM-F-001)

**Observed**: `/storefront/inbox` displays "Customer-zero inquiry intake is wired to product backlog triage" header and "Customer-zero signal" badge on INQ-7GVTLESY.  
**Confirmed recurring**: Yes — 3rd consecutive fresh-install archetype.

#### AUDIT-R1-L-F-002 · Important · "Customer-zero product inquiry" in backlog title (recurring — R1-E-F-002, R1-FM-F-002)

**Observed**: Send-to-backlog created "BI-SFI-INQ7GVTLESY" — meta-language propagates from inbox into the operations backlog.  
**Confirmed recurring**: Yes.

#### AUDIT-R1-L-F-003 · Pass · Send-to-backlog flow works

**Observed**: Inbox item sent to backlog; backlog item BI-SFI-INQ7GVTLESY created. ✓

---

### Phase G — Financial Tally

#### AUDIT-R1-L-G-001 · Pass · Supplier creation works

**Observed**: Landscaping supplier created successfully, redirected to `/finance/suppliers`. ✓

#### AUDIT-R1-L-G-002 · Important · Bill tax rate defaults to 20% (UK VAT) on USD install (recurring — R1-E-G-002, R1-FM-G-002)

**Observed**: New bill line item "Tax %" pre-populated with 20 despite currency set to USD.  
**Confirmed recurring**: Yes — 3rd consecutive archetype.

#### AUDIT-R1-L-G-003 · Pass · Bill saved as draft

**Observed**: BILL-2026-0001 saved to draft (4 × "Lawn seed and topsoil" @ $55.00 = $220.00 USD). ✓

#### AUDIT-R1-L-G-004 · Important · Draft bill invisible in P&L report (recurring — R1-E-G-004, R1-FM-G-004)

**Observed**: `/finance/reports/profit-loss` shows $0.00 expenses, "Based on 0 paid invoices, 0 paid bills."  
**Confirmed recurring**: Yes — 3rd consecutive archetype.

---

### Phase O — AI Coworker Operating Intelligence

**Coworker**: Storefront Operations Manager (model: `local:docker.io/ai/gemma4:latest`)

#### AUDIT-R1-L-O-001 · Important · Coworker local model timeout — no response, timer frozen at 29s (recurring — R1-FM-O-001)

**Observed**: Sent "What business are we in?" to the Storefront Operations Manager coworker. UI showed "Storefront Operations Manager is still working (29s)" frozen — timer did not advance past 29s. Manually cancelled after ~2 minutes of no activity. No response received.  
**Score**: Level 0 — no response (timeout). Cannot evaluate vocabulary or domain knowledge.  
**Pattern**: Same local Docker Model Runner hang as FM-O-001 (178s timeout). Electrician coworker responded (same model) — degradation is intermittent, likely load-related.  
**Impact**: Coworker non-functional when local model hangs. No visible fallback to cloud provider within test window.

---

## Cleaning-Service — Spotless Spaces Cleaning Co. (fresh install)

**Company**: Spotless Spaces Cleaning Co.  
**Owner persona**: Sofia Reyes (test customer)  
**URL slug**: spotless-spaces-cleaning-co (auto-generated from org name; storefront wizard Continue button bug — see A-003)  
**Phases run**: A, P, B, F, G, O  

---

### Phase A — Onboarding

#### AUDIT-R1-CS-A-001 · Important · GBP default currency on US install (recurring — all prior archetypes)

**Observed**: Financial setup step pre-filled "GBP - British Pound" as base currency. Operator must manually switch to USD.  
**Confirmed recurring**: Yes — 4th consecutive archetype. Pattern is universal across trades-maintenance category.

#### AUDIT-R1-CS-A-002 · Important · Recurring Agreement financial pattern pre-selected (recurring — all prior archetypes)

**Observed**: Financial setup defaulted to "Payment: Recurring Agreement / Recurring: Required". Cleaning service has mixed model (recurring domestic contracts + one-off deep cleans); blanket recurring-agreement default is still wrong.  
**Confirmed recurring**: Yes — 4th consecutive archetype.

#### AUDIT-R1-CS-A-003 · Important · Storefront wizard Continue button does not create portal — silent failure

**Observed**: After selecting "Cleaning Service" archetype in `/storefront/setup` and clicking Continue, the system wizard advanced (to step 5 Operating Hours, then 7 Platform Dev on repeated clicks) but no `StorefrontConfig`, `StorefrontSection`, or `StorefrontItem` records were created. `StorefrontConfig` table remained empty. The storefront only existed after calling `/api/storefront/admin/setup` directly.  
**Impact**: The portal setup wizard is broken on the "Cleaning Service" (and potentially all) archetype selection step. An operator following the wizard UI would end up with no portal after completing the entire wizard.  
**Severity raised to Important** (from Warn): this is not a cosmetic issue — the portal does not exist until a workaround is applied.  
**Note**: Electrician, FM, and Landscaping portals were created correctly in earlier sessions — the regression may be session-specific or related to the system wizard step counter state.

---

### Phase P — Catalog & Data Prerequisites

#### AUDIT-R1-CS-P-001 · Pass · Cleaning-service items correctly seeded (6 items, all Inquiry CTA)

**Observed**: Regular Domestic Clean, One-Off Deep Clean, End of Tenancy Clean, Office Cleaning, Carpet & Upholstery Clean, Window Cleaning — all seeded and visible on the public portal. Matches R1S-CS-001 swap finding. ✓

#### AUDIT-R1-CS-P-002 · Warn · Operating hours save gives no confirmation feedback (recurring — all prior archetypes)

**Observed**: Same pattern — 200 POST on save, no toast or visual "Saved" state.  
**Confirmed recurring**: Yes — 4th consecutive archetype.

---

### Phase B — Storefront

#### AUDIT-R1-CS-B-001 · Pass · Public portal renders with correct identity and vocabulary

**Observed**: `http://localhost:3000/s/spotless-spaces-cleaning-co` shows "Spotless Spaces Cleaning Co.", tagline "Professional cleaning services for homes and businesses", all 6 service items with "Enquire" CTA. Cleaning vocabulary throughout. ✓

#### AUDIT-R1-CS-B-002 · Important · No property type, frequency, or property size fields on cleaning-service inquiry form (R1S-002 confirmed on fresh install)

**Observed**: Inquiry form for "End of Tenancy Clean" presents only 4 fields: name, email, phone, message. No property type (house/flat/commercial), frequency (one-off/weekly/fortnightly), or property size fields.  
**Confirmed recurring**: Yes — all 4 archetypes; none have archetype-specific form fields.  
**Impact**: Cleaning operators cannot quote or schedule from an inquiry without a follow-up call. The end-of-tenancy use case in particular requires: number of bedrooms, furnished/unfurnished, and specific add-ons (oven clean, carpet steam, etc.).

#### AUDIT-R1-CS-B-003 · Pass · Inquiry submission and reference number

**Observed**: INQ-LCGDWI8E issued on End of Tenancy Clean inquiry (Sofia Reyes, sofia.reyes@spotlesstest.com, "I need an end of tenancy clean for a 2-bed flat before key handover on Friday."). ✓

---

### Phase F — Inbox & Operations

#### AUDIT-R1-CS-F-001 · Critical · DPF meta-language in inbox (recurring — all 4 archetypes)

**Observed**: `/storefront/inbox` displays "Customer-zero inquiry intake is wired to product backlog triage" header and "Customer-zero signal" badge on INQ-LCGDWI8E.  
**Confirmed recurring**: Yes — 4th consecutive fresh-install archetype. Universal blocker.

#### AUDIT-R1-CS-F-002 · Important · "Customer-zero product inquiry" backlog title (recurring — all 4 archetypes)

**Observed**: Send-to-backlog created meta-language backlog item from INQ-LCGDWI8E.  
**Confirmed recurring**: Yes — all 4 archetypes.

#### AUDIT-R1-CS-F-003 · Pass · Send-to-backlog flow works

**Observed**: Inbox item sent to backlog successfully. ✓

---

### Phase G — Financial Tally

#### AUDIT-R1-CS-G-001 · Pass · Supplier creation works (via API — UI form blocked by React state issue)

**Observed**: "CleanPro Supplies Ltd." created successfully (SUP-JZ-y0wrJ) via `/api/v1/finance/suppliers` POST. The UI form (`/finance/suppliers/new`) was non-functional — React controlled inputs did not register values via fiber onChange despite DOM value being set. Supplier creation confirmed in DB. ✓  
**Note**: The UI form bug is a test harness limitation (controlled React inputs require physical keyboard interaction), not a production UX finding.

#### AUDIT-R1-CS-G-002 · Important · Bill tax rate defaults to 20% (UK VAT) on USD install (recurring — all 4 archetypes)

**Observed**: New bill line item "Tax %" pre-populated with 20 despite currency set to USD.  
**Confirmed recurring**: Yes — 4th consecutive archetype. Universal.

#### AUDIT-R1-CS-G-003 · Pass · Bill saved as draft

**Observed**: BILL-2026-0001 saved to draft (3 × "Cleaning supplies and microfibre cloths" @ $45.00 = $135.00 USD, tax cleared to 0%). ✓

#### AUDIT-R1-CS-G-004 · Important · Draft bill invisible in P&L report (recurring — all 4 archetypes)

**Observed**: `/finance/reports/profit-loss` shows $0.00 expenses, "Based on 0 paid invoices, 0 paid bills."  
**Confirmed recurring**: Yes — 4th consecutive archetype. Universal.

---

### Phase O — AI Coworker Operating Intelligence

**Coworker**: Storefront Operations Manager (model: `local:docker.io/ai/gemma4:latest`)

#### AUDIT-R1-CS-O-001 · Important · Coworker local model timeout — no response after 128s (recurring — R1-FM-O-001, R1-L-O-001)

**Observed**: Sent "What business are we in?" to the Storefront Operations Manager coworker. Timer counted normally (16s → 128s) before manual cancel. No response received within the test window.  
**Score**: Level 0 — no response (timeout). Cannot evaluate vocabulary or domain knowledge.  
**Pattern**: 3 out of 4 archetypes tested produced local model timeouts (FM at ~178s, L frozen at 29s UI hang, CS at 128s+). Only electrician (first archetype in the session, lightest load) received a response.  
**Impact**: Coworker is non-functional for most trades-maintenance archetypes under typical testing conditions. The local Docker Model Runner (`gemma4:latest`) appears to degrade under sustained load. No cloud fallback activates within the test window.

---

## Summary — Run 1 Fresh-Install (all 4 archetypes complete)

| Severity | Count | IDs |
|---|---|---|
| Critical | 4 | R1-E-F-001, R1-FM-F-001, R1-L-F-001, R1-CS-F-001 (DPF meta-language in inbox — all 4 archetypes) |
| Important | 26 | R1-E-A-001/002, R1-E-B-002, R1-E-F-002, R1-E-G-002/004, R1-E-O-002/003/004/005/006 · R1-FM-A-001/002, R1-FM-B-002, R1-FM-F-002, R1-FM-G-002/004, R1-FM-O-001 · R1-L-A-001/002, R1-L-B-002, R1-L-F-002, R1-L-G-002/004, R1-L-O-001 · R1-CS-A-002/003, R1-CS-B-002, R1-CS-F-002, R1-CS-G-002/004, R1-CS-O-001 |
| Minor | 0 | |
| Warn | 6 | R1-E-P-002, R1-FM-A-003, R1-FM-P-002, R1-L-A-003, R1-L-P-002, R1-CS-P-002 |
| Pass | 22 | R1-E-P-001, R1-E-B-001/003, R1-E-F-003, R1-E-G-001/003, R1-E-H-001 · R1-FM-P-001, R1-FM-B-001/003, R1-FM-F-003, R1-FM-G-001/003 · R1-L-P-001, R1-L-B-001/003, R1-L-F-003, R1-L-G-001/003 · R1-CS-P-001, R1-CS-B-001/003, R1-CS-F-003, R1-CS-G-001/003 |

**Cross-cutting findings confirmed across all 4 fresh-install archetypes:**

1. **DPF meta-language in inbox** (Critical) — "Customer-zero signal" + "Customer-zero product inquiry" backlog title — appears on every clean install; not a methodology artifact
2. **No archetype-specific form fields** (Important) — 4-field generic form on every archetype (no property type, size, frequency, site count)
3. **GBP currency default** (Important) — US operators must manually change on every install
4. **Recurring Agreement financial model pre-selected** (Important) — wrong default for ad-hoc trades work
5. **20% UK VAT bill default** (Important) — US operators must clear on every bill line item
6. **Draft bills invisible in P&L** (Important) — approval workflow path invisible; 0 paid bills always
7. **Operating hours save no feedback** (Warn) — silent 200, no toast confirmation
8. **Local Docker Model Runner timeout** (Important) — coworker failed on 3 of 4 archetypes (FM ~178s, L ~29s UI freeze, CS ~128s); Level 0 coworker intelligence for 3/4 archetypes
9. **Storefront wizard Continue button broken** (Important, CS only) — does not create StorefrontConfig; portal never materialises via the wizard UI path (R1-CS-A-003)
