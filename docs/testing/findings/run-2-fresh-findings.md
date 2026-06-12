# Run 2 Fresh-Install Findings — Beauty & Personal Care

**Run**: 2 (beauty-personal-care, fresh-install pass)  
**Archetypes tested**: hair-salon *(complete)*, barber-shop, nail-salon, beauty-spa, optician, personal-trainer *(pending)*  
**Run date**: 2026-06-12  
**Method**: Tier 2 DB-only reset per archetype; golden dump `/d/DPF-audit-backup/golden-provider-configured-2026-06-12.dump`  
**Tester**: Autonomous agent  

> **Fix-validation note**: Six fix PRs (#1752, #1759, #1760, #1761, #1762, #1763) were merged to `main` between Run 1 and Run 2. This run exercises those surfaces naturally — no dedicated re-test pass. Fix verdicts are recorded inline per finding.

---

## Hair Salon — Glamour & Grace Hair Studio (fresh install)

**Company**: Glamour & Grace Hair Studio  
**Owner persona**: Chloe Martinez (test customer)  
**URL slug**: glamour-grace-hair-studio (wizard-entered slug correctly preserved — see B-002)  
**Phases run**: A, P-BOOKING, B, F, I, G, O  
**Fix PRs under test**: #1752 (inbox language), #1759 (currency/tax defaults), #1760 (archetype form fields), #1761 (bill P&L visibility), #1762 (operating hours toast), #1763 (model timeout)  

---

### Phase A — Onboarding

#### AUDIT-R2-HS-A-001 · Important · GBP default currency on US install (recurring — R1-E-A-001, fix #1759 not resolved for currency)

**Observed**: Financial setup step pre-filled "GBP - British Pound" as base currency on a fresh hair-salon install with no UK locale signals. Operator must manually switch to USD.  
**Fix #1759 verdict**: ❌ Not resolved for currency field. GBP default persists.  
**Impact**: US salon operators will incorrectly default to GBP pricing unless they catch it manually.

#### AUDIT-R2-HS-A-002 · Pass · Appointment Checkout financial model with Recurring "Optional" (fix #1759 partial confirmed)

**Observed**: Financial setup pre-selected "Appointment Checkout" payment model with "Recurring: Optional" for hair-salon. This is the correct model for a booking archetype. In Run 1, trades archetypes incorrectly showed "Recurring: Required".  
**Fix #1759 verdict**: ✅ Recurring field now Optional for booking archetypes. Correct model pre-selected.  
**Note**: Currency default (GBP) remains incorrect; that sub-item of #1759 is not resolved (see A-001).

---

### Phase P — Catalog & Prerequisites

#### AUDIT-R2-HS-P-001 · Warn · Operating hours save gives no confirmation feedback (recurring — R1-E-P-002, fix #1762 not resolved)

**Observed**: Saving operating hours (Mon–Fri 09:00–17:00 for hair salon) posts a 200 response but shows no toast notification or "Saved" indicator. Hours ARE persisted (confirmed by reload), but the operator has no visual confirmation.  
**Fix #1762 verdict**: ❌ Not resolved. No toast or saved state visible after save.  
**Impact**: Operators may save multiple times or assume the save failed.

#### AUDIT-R2-HS-P-002 · Pass · Seeded hair salon items present with booking CTA

**Observed**: Hair salon archetype has seeded service items with "Book Now" CTA. Items render in the items management screen. ✓

#### AUDIT-R2-HS-P-003 · Pass · Staff provider created; booking calendar shows availability

**Observed**: Provider added at `/storefront/team`, Mon–Fri 09:00–17:00 availability configured. Provider appears as selectable in booking calendar slots. ✓

---

### Phase B — Storefront

#### AUDIT-R2-HS-B-001 · Important · Wizard-created portal starts as Unpublished (new Run 2 finding)

**Observed**: After completing the setup wizard, the portal at `/s/glamour-grace-hair-studio` returned a 404. Investigation revealed the storefront dashboard shows an "Unpublished" status badge. Clicking "Publish" resolved the 404 and made the portal accessible. Run 1 archetypes (created via API) did not exhibit this — portals were immediately accessible.  
**Impact**: Operators who do not notice the Unpublished badge will assume the portal is broken. No wizard prompt or post-wizard reminder to publish is shown. This is a blocking UX gap for every wizard-created archetype in Runs 2–16.  
**Note**: Confirmed new finding — not a methodology artifact from the wizard path.

#### AUDIT-R2-HS-B-002 · Pass · Slug correctly preserved from wizard input

**Observed**: Entered slug "glamour-grace-hair-studio" during wizard; public portal URL matches exactly. Run 1 finding (slug ignored/overridden) does not reproduce on hair-salon. ✓

#### AUDIT-R2-HS-B-003 · Pass · Public portal renders with correct identity and "Book Now" CTA

**Observed**: `http://localhost:3000/s/glamour-grace-hair-studio` shows "Glamour & Grace Hair Studio" with "Book Now" CTA buttons. Vocabulary is salon-appropriate. ✓

#### AUDIT-R2-HS-B-004 · Important · No hair-specific booking form fields (fix #1760 not resolved)

**Observed**: Booking form for every hair salon service presents only 4 generic fields: Full Name (required), Email (required), Phone (optional), Notes (optional). No hair-specific fields: no "service type" dropdown (cut/colour/treatment), no "hair length" selector, no "existing colour" note field that would allow the stylist to prepare.  
**Fix #1760 verdict**: ❌ Not resolved. Form fields are identical to Run 1 trades inquiry forms — fully generic.  
**Impact**: The booking form does not capture the information a hair salon needs to prepare for an appointment. Stylists will need to follow up by phone to understand what the client wants.

---

### Phase F — Booking Flow

#### AUDIT-R2-HS-F-001 · Pass · Booking end-to-end works; reference number issued

**Observed**: Drove full booking flow: portal → select service → select provider → choose date/time → fill name/email/phone/notes → submit. Booking reference **BK-JCZXKF9G** issued on confirmation page. ✓  
**Note**: Form submitted successfully despite absence of hair-specific fields (see B-004). The generic form is functional; it is an archetype-fit gap, not a functional failure.

---

### Phase I — Inbox

#### AUDIT-R2-HS-I-001 · Critical · DPF meta-language in inbox after booking (fix #1752 not resolved)

**Observed**: `/storefront/inbox` displays "Customer-zero inquiry intake is wired to product backlog triage" header text and "Customer-zero signal" badge on the BK-JCZXKF9G booking record. This language is unchanged from Run 1.  
**Fix #1752 verdict**: ❌ Not resolved. Identical DPF platform-developer language present on fresh hair-salon install.  
**Impact**: A salon owner viewing their inbox sees DPF internal engineering terminology instead of customer booking language. "Customer-zero signal" is meaningless to a hairdresser. This is the most prominent operator-hostile surface in the platform.

#### AUDIT-R2-HS-I-002 · Pass · Booking record appears in inbox with correct reference

**Observed**: BK-JCZXKF9G appears in `/storefront/inbox`. Booking is accessible and can be opened. ✓  
**Note**: Despite the meta-language (I-001), the booking routing mechanics work correctly.

---

### Phase G — Finance

#### AUDIT-R2-HS-G-001 · Pass · Supplier creation works

**Observed**: "Salon Pro Supplies" created at `/finance/suppliers` via `POST /api/v1/finance/suppliers`. Redirected to supplier list. ✓

#### AUDIT-R2-HS-G-002 · Important · Bill tax rate defaults to 20% (recurring — R1-E-G-002, fix #1759 not resolved for bill tax)

**Observed**: New bill line item "Tax %" pre-populated with 20 despite currency set to USD. US hair salons do not charge VAT/20% sales tax. Operator must manually clear to 0% on every bill.  
**Fix #1759 verdict**: ❌ Not resolved for bill tax rate. 20% UK VAT default persists in bill creation.  
**Impact**: US operators risk accidentally billing at an incorrect tax rate if they miss the pre-filled field.

#### AUDIT-R2-HS-G-003 · Pass · Bill saved in USD; approval workflow now accessible

**Observed**: BILL-2026-0001 created for Salon Pro Supplies — "Hair colour supplies and tints", 1 × $85.00 USD, 0% tax (manually set), total $85.00. Bill detail shows "Submit for Approval" button in draft state.  
**Fix #1761 verdict partial**: ✅ "Submit for Approval" button present (not present in Run 1). Bill approval workflow is now navigable.  
**Note**: USD currency on bill confirms the fix #1759 partial for currency at bill creation (the bill defaulted to USD, not GBP, even though account setup defaulted to GBP). The bill CTA labelled correctly as "Submit for Approval" — clicking it progressed bill directly from draft → approved in one click (auto-approved).

#### AUDIT-R2-HS-G-004 · Important · No payment recording UI after bill approval (blocking path to "paid")

**Observed**: After clicking "Submit for Approval" on BILL-2026-0001, status changed immediately to "approved". No "Record Payment" or "Mark as Paid" button appeared on the approved bill detail page. The bill list confirms the status transitions (draft → awaiting approval → approved → partially paid → paid) exist in the data model, but the UI offers no way to progress from approved → paid.  
**Impact**: Bills cannot reach "paid" status via the UI. Combined with G-005, this means the P&L report permanently shows $0 expenses regardless of bills created.

#### AUDIT-R2-HS-G-005 · Important · P&L shows $0.00 expenses; approved bills invisible (fix #1761 partial — still blocked by G-004)

**Observed**: `/finance/reports/profit-loss` shows Expenses ($0.00), Net Profit $0.00. Footer: "Based on 0 paid invoices, 0 paid bills, and 0 expense claims." Checked with BILL-2026-0001 in both draft and approved states — neither state is counted by the P&L. Only "paid" bills count.  
**Fix #1761 verdict partial**: ⚠️ Submit for Approval button added (progress), but the approval → payment gap (G-004) means the P&L is still permanently dark for expenses. The root fix must include a payment recording path.  
**Confirmed recurring from Run 1**: R1-E-G-004, R1-FM-G-002, R1-L-G-001, R1-CS-G-001 — reproduced on all 4 Run 1 archetypes; reproduces again here.

---

### Phase O — AI Coworker Operating Intelligence

**Coworker**: Finance Specialist (model: `local:docker.io/ai/gemma4:26B`)

#### AUDIT-R2-HS-O-001 · Important · Finance Specialist hits safety limit at ~118s for simple P&L query (fix #1763 partial)

**Observed**: Asked Finance Specialist: "Generate a profit and loss summary for Glamour & Grace Hair Studio for June 2026." Coworker showed "Finance Specialist is still working" for ~118 seconds, then responded: "I made several attempts (get_finance_period_summary, get_my_coworker_profile, query_backlog) but couldn't complete a final answer before hitting my safety limit. Try the same question again, or break it into a smaller piece."  
**Fix #1763 verdict partial**: ⚠️ The hard timeout error from Run 1 is replaced by a "safety limit" message — the coworker no longer crashes with a timeout. However, the root problem persists: 118 seconds of wall-clock waiting followed by task failure is not an acceptable user experience for a simple financial query. Model is `local:docker.io/ai/gemma4:26B`.  
**Impact**: The Finance Specialist coworker is effectively non-functional for financial analysis on local Gemma 26B. Operators will wait nearly 2 minutes and then receive an apology instead of a report.

---

### Hair Salon — Summary

| Phase | Finding | Severity | Fix PR | Verdict |
|-------|---------|----------|--------|---------|
| A | GBP default currency | Important | #1759 | ❌ Not resolved |
| A | Appointment Checkout + Recurring Optional | Pass | #1759 | ✅ Partial fix confirmed |
| P | Operating hours no confirmation toast | Warn | #1762 | ❌ Not resolved |
| P | Seeded items present, booking CTA | Pass | — | ✓ |
| P | Staff provider + calendar availability | Pass | — | ✓ |
| B | Wizard portal starts as Unpublished | Important | — | 🆕 New finding |
| B | Slug correctly preserved from wizard | Pass | — | ✓ |
| B | Portal renders with booking CTA | Pass | — | ✓ |
| B | No hair-specific booking form fields | Important | #1760 | ❌ Not resolved |
| F | Booking end-to-end works (BK-JCZXKF9G) | Pass | — | ✓ |
| I | DPF meta-language in inbox | Critical | #1752 | ❌ Not resolved |
| I | Booking record visible in inbox | Pass | — | ✓ |
| G | Supplier creation works | Pass | — | ✓ |
| G | Bill tax rate defaults to 20% | Important | #1759 | ❌ Not resolved |
| G | Bill saved USD; Submit for Approval present | Pass | #1761 | ✅ Partial fix confirmed |
| G | No payment recording UI after approval | Important | — | 🆕 New finding |
| G | P&L $0.00 expenses; approved bills invisible | Important | #1761 | ⚠️ Partial (blocked by payment gap) |
| O | Finance Specialist safety limit at 118s | Important | #1763 | ⚠️ Partial (no crash; still fails) |

**Totals**: 1 Critical · 7 Important · 1 Warn · 8 Pass (17 findings)

---

## Barber Shop — pending Tier 2 reset

*Awaiting next archetype reset. Tier 2 DB restore from golden dump required before testing.*

---

## Nail Salon — pending Tier 2 reset

*Awaiting next archetype reset.*

---

## Beauty Spa — pending Tier 2 reset

*Awaiting next archetype reset.*

---

## Optician — pending Tier 2 reset

*Awaiting next archetype reset.*

---

## Personal Trainer — pending Tier 2 reset

*Awaiting next archetype reset.*

---

## Run 2 Summary (hair-salon complete; 5 archetypes pending)

| Category | Count |
|----------|-------|
| Critical | 1 |
| Important | 7 |
| Warn | 1 |
| Pass | 8 |
| **Total** | **17** |

### Fix PR status after hair-salon (natural validation)

| PR | Title | Verdict |
|----|-------|---------|
| #1752 | fix(inbox): replace DPF meta-language with operator language | ❌ Not resolved |
| #1759 | fix(onboarding): USD default currency + 0% tax rate + Optional recurring | ⚠️ Partial — Recurring Optional ✓; GBP currency ✗; 20% bill tax ✗ |
| #1760 | fix(booking): add archetype-specific booking form fields | ❌ Not resolved |
| #1761 | fix(finance): surface draft/pending bills on P&L report | ⚠️ Partial — Submit for Approval button added ✓; approved→paid path missing ✗; P&L still dark ✗ |
| #1762 | fix(operating-hours): add save confirmation toast | ❌ Not resolved |
| #1763 | fix(coworker): resolve model timeout on financial queries | ⚠️ Partial — hard crash → safety limit message ✓; 118s latency + task failure ✗ |
