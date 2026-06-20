# Run 1 Swap Findings — Electrician / Facilities-Maintenance / Landscaping / Cleaning-Service

**Run**: 1 (trades-maintenance swap archetypes)
**Archetypes tested**: electrician, facilities-maintenance, landscaping, cleaning-service
**Run date**: 2026-06-12
**Method**: archetype-reset API swap from plumber lead; Phases B5/G per archetype *(superseded — see methodology note below)*
**Tester**: Autonomous agent

> **Methodology note**: These findings were produced using the now-superseded API-swap approach. The audit plan has been revised (2026-06-12) to require a fresh DB install per archetype (Tier 2 golden-dump restore). Findings marked "Methodology artifact" below are consequences of the swap approach and are not reproducible on a fresh install. All other findings remain valid and should be reproduced on the next fresh-install pass of these archetypes.

---

## Cross-Archetype (recurring across all 4 swaps)

### AUDIT-R1S-001 · Methodology artifact · Archetype-reset does not update company name, slug, or hero copy

> **Methodology artifact**: This finding is a direct consequence of the API-swap approach. A fresh install has no prior company identity to persist. This is not a bug on the standard operator path. It is only relevant as a "mid-life archetype change" use case, which is tracked separately under audit finding #1 (missing "change archetype" UI). GitHub Issue [#1748](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/1748) updated to reflect this scope.

**Observed**: After each archetype-reset call, the portal continued showing "Riverside Plumbing Solutions" name, slug, and hero copy. Only service items swapped.
**Valid scope**: Post-go-live archetype change via admin API only — not first-time install path.
**Resolution** ([#1748](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/1748)): `resetStorefrontArchetype` now (a) accepts an optional `identity` (`{ orgName, slug, tagline }`) so a caller — e.g. a future "change archetype" UI — can perform a full identity swap, with the slug uniqueness-guarded; and (b) when identity is not supplied, deliberately **preserves** the operator-owned name/slug/tagline (archetypes carry no defaults for these) and returns `result.identity` + `result.warnings` naming exactly what still reflects the prior setup, so the surface can prompt the operator instead of silently presenting the wrong business identity. See `apps/web/lib/storefront/archetype-reset.ts`.

### AUDIT-R1S-002 · Important · Inquiry form has no archetype-specific fields on any swap archetype

**Observed**: Every archetype inquiry form (electrician, facilities-maintenance, landscaping, cleaning-service) presents the same 4 fields: name (required), email (required), phone (optional), message. No property type, urgency, frequency, or site-count fields appeared on any archetype.
**Expected per plan**:
- Electrician: property type field
- Facilities-maintenance: company/site count field (B2B)
- Landscaping: property size and frequency (recurring vs one-off) fields
- Cleaning-service: property type, frequency, and property size fields
**Impact**: Operators cannot gather the context they need to respond to enquiries without a follow-up call. The `TRADES_FORM_FIELDS` extension (urgency, property type) mentioned in the audit plan is not rendering.

### AUDIT-R1S-003 · Critical · DPF platform meta-language in inbox persists across all archetypes (R1-F-001 recurring)

**Observed**: "Customer-zero inquiry intake is wired to product backlog triage" header and "Customer-zero signal" badge visible on all swap archetype inquiries in `/storefront/inbox`.
**Impact**: Cross-archetype blocker. Not fixed by any of the merged PRs. Confirmed on: electrician (INQ-AJVUB--Q), facilities-maintenance (INQ-EIH8L1OO), landscaping (INQ-2NSAWLCL), cleaning-service (INQ-WXL37VHM).

### AUDIT-R1S-004 · Important · Storefront Operations Manager "blocked" coworker response recurring (R1-004 recurring)

**Observed**: Coworker panel at `/storefront/settings/operations` showed "Status: blocked, cannot proceed with operations until we have organizational structure defined" on electrician swap — same wording as Run 1 plumber. HVAC coworker response on facilities-maintenance also returned "Status: Blocked (Awaiting tenant details)".
**Impact**: Systematic false-blocker pattern across the trades-maintenance category. The coworker context prompt queries org for departments and returns "blocked" when none exist.

### AUDIT-R1S-005 · Methodology artifact · All swap-archetype inquiries accumulated in shared inbox

> **Methodology artifact**: Under the fresh-install approach, each archetype begins with an empty DB. Cross-archetype inbox pollution cannot occur. This finding is not reproducible on a fresh install and is not a platform bug.

**Observed**: `/storefront/inbox` showed all 5 inquiries from all swap archetypes in one list (plumber through cleaning-service). This was a consequence of all archetypes sharing the same database in the API-swap approach.
**Valid scope**: None — obsoleted by the fresh-install methodology revision.

### AUDIT-R1S-006 · Important · Bill line-item fields require direct coordinate click; ref-based typing fails

**Observed**: Using `form_input` to set line-item values in `/finance/bills/new` set the DOM value but React state was not updated (totals stayed $0.00). Direct coordinate clicks with `type` resolved the issue.
**Note**: This is a test-harness compatibility issue, not a UX finding per se. However it indicates the bill form uses uncontrolled or custom React inputs that do not respond to programmatic DOM value changes — which may also affect screen reader / accessibility tool compatibility.

---

## Per-Archetype Findings

### Electrician (Bright Wire Electric)

#### AUDIT-R1S-E-001 · Minor · Electrician seed items differ from audit plan expectations

**Observed**: Items seeded: Electrical Safety Certificate, Consumer Unit Replacement, Socket & Switch Installation, Lighting Installation, EV Charger Installation, Emergency Call-Out.
**Plan expected**: Consumer Unit Installation, Fault Diagnosis, EV Charger Install, Safety Inspection, Emergency Rewire.
**Gaps**: "Fault Diagnosis" absent; "Emergency Rewire" replaced by "Emergency Call-Out".
**Impact**: Minor — items cover the archetype adequately. "Fault Diagnosis" is a primary revenue stream for electricians.

#### AUDIT-R1S-E-002 · Pass · Electrician end-to-end inquiry flow works

**Observed**: INQ-AJVUB--Q submitted for "Emergency Call-Out", appeared in inbox within seconds. Reference number issued. Core flow passes.

#### AUDIT-R1S-E-003 · Minor · Bill tax rate defaults to 20% (UK VAT) for US-based install

**Observed**: `/finance/bills/new` line item "Tax %" pre-populated with "20". For a US install, the expected default is 0% (US does not have a national VAT).
**Impact**: Recurring finding across all trades archetypes. US operators must manually clear the tax rate on every bill line item.

#### AUDIT-R1S-E-004 · Important · Draft bills do not appear in P&L report

**Observed**: After saving a bill for $435.00 (qty 3 × $145 MCB consumer units), `/finance/reports/profit-loss` showed $0.00 expenses. "Based on 0 paid invoices, 0 paid bills."
**Expected**: Either (a) the P&L shows committed/draft expenses with a clear "draft" label, or (b) there is a clear path from draft → approved → paid that a trades operator can follow.
**Impact**: A small trades operator creating a purchase bill expects to see it reflected immediately. The approval workflow is invisible — there is no "approve" or "mark as paid" button visible on the bill list page.

---

### Facilities-Maintenance / HVAC (ProSite Facilities Group)

#### AUDIT-R1S-FM-001 · Pass · Facilities-maintenance items correctly seeded

**Observed**: Items: Planned Maintenance Contract, Reactive Repair, Building Inspection, HVAC Servicing, Electrical Testing, Emergency Call-Out. All 5 plan-required items present (+ Electrical Testing bonus).

#### AUDIT-R1S-FM-002 · Important · HVAC coworker gives Level 1 response — no domain dispatch guidance

**Observed**: Asked "A tenant is complaining about no cold air — what do we do?" Coworker (Storefront Operations Manager) responded: "I couldn't find a specific troubleshooting guide for 'no cold air' in our knowledge base right now... Can you tell me what kind of system or unit the tenant is referring to?"
**Expected Level 3**: Log an HVAC Servicing call-out, triage urgency (summer/heat risk), dispatch the HVAC team, follow up with tenant ETA.
**Impact**: The coworker deferred to knowledge base search rather than domain procedure. Empty knowledge base on fresh install produces a Level 1 response. HVAC vocabulary used ✓ — no platform terms.
**Gap**: BI-FS-001 confirmed — no dedicated `hvac-contractor` leaf exists; facilities-maintenance covers HVAC as a sub-service.

#### AUDIT-R1S-FM-003 · Important · No B2B company/site field on facilities-maintenance inquiry form

**Observed**: Same 4-field form. The plan required a company name and site count field for a B2B-primary archetype.
**Impact**: ProSite Facilities Group cannot tell from the inquiry whether the enquirer is a single-site SME or a 50-building property portfolio.

---

### Landscaping (GreenScape Outdoor Services)

#### AUDIT-R1S-L-001 · Minor · "Seasonal cleanup" item absent from landscaping seed

**Observed**: Items seeded: Garden Design Consultation, Lawn Maintenance Contract, Patio & Decking Installation, Fencing & Gates, Tree Surgery, Irrigation Systems.
**Gap**: "Seasonal cleanup" (autumn leaf clearing, spring prep) is a high-volume, recurring revenue line for landscapers — absent.

#### AUDIT-R1S-L-002 · Pass · Landscaping inquiry submitted successfully

**Observed**: INQ-2NSAWLCL for "Lawn Maintenance Contract" submitted and confirmed. Reference number issued.

---

### Cleaning-Service (Spotless Spaces Cleaning Co.)

#### AUDIT-R1S-CS-001 · Pass · Cleaning-service items correctly seeded

**Observed**: Regular Domestic Clean, One-Off Deep Clean, End of Tenancy Clean, Office Cleaning, Carpet & Upholstery Clean, Window Cleaning. All 4 plan-required items present.

#### AUDIT-R1S-CS-002 · Pass · Cleaning-service inquiry submitted successfully

**Observed**: INQ-WXL37VHM for "End of Tenancy Clean" submitted and confirmed. Reference number issued.

---

## Summary — Run 1 Swap Archetypes

| Severity | Count | IDs |
|---|---|---|
| Critical | 2 | R1S-001, R1S-003 |
| Important | 6 | R1S-002, R1S-004, R1S-005, R1S-E-004, R1S-FM-002, R1S-FM-003 |
| Minor | 4 | R1S-006, R1S-E-001, R1S-E-003, R1S-L-001 |
| Pass | 4 | R1S-E-002, R1S-FM-001, R1S-L-002, R1S-CS-001, R1S-CS-002 |

**Top findings from swap phase:**

1. **Archetype-reset leaves plumber identity on portal** (R1S-001 Critical) — every swap archetype presents as a plumbing company
2. **DPF meta-language in inbox** (R1S-003 Critical) — confirmed unfixed, affects all 4 swap archetypes
3. **No archetype-specific form fields on any archetype** (R1S-002 Important) — TRADES_FORM_FIELDS not rendering; trades operators cannot collect the data they need
4. **Draft bills invisible in P&L** (R1S-E-004 Important) — approval workflow path is invisible to operators
5. **HVAC coworker Level 1 response** (R1S-FM-002 Important) — empty knowledge base produces generic deferral, not domain dispatch guidance
