# CRM Research Synthesis: Design Decisions

**Date:** 2026-03-20
**Status:** Complete
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Purpose:** Research-backed design decisions for EP-CRM-001 + EP-CRM-SALES-001

**Sources:** Open source CRM analysis (Twenty, Frappe, SuiteCRM, Monica), public discourse
(Reddit, HN, CRM blogs), B2B pipeline best practices, ERPNext/Odoo quoting patterns.

---

## Critical Statistics Driving Design

| Stat | Source | Design Impact |
|------|--------|---------------|
| 5.5 hrs/week lost to manual CRM data entry | Clari | Auto-capture over manual logging |
| 79% of opportunity data never entered | Rethink Revenue | System must capture, not ask |
| 55% of CRM deployments fail (mostly adoption) | Johnny Grow | UX friction = death |
| 94% of businesses have duplicate contacts | RT Dynamic | Prevent at creation, not cleanup |
| 47% of enterprises can't trust CRM as source of truth | Multiple | Data quality is existential |
| 55% of sales pros say ease-of-use is #1 CRM feature | Nutshell | Simplicity > completeness |

---

## Decision 1: No Separate Lead Table

**What the research says:**
- Salesforce's separate Lead entity is the most-complained-about CRM pattern. Custom field data is lost during conversion. No cross-object deduplication means converted contacts get re-created as new Leads.
- HubSpot originally unified everything as Contact + lifecycle stage. In 2024, they added a lightweight "Lead" object (many-to-one with Contact) to track discrete prospecting efforts — proving the hybrid wins.
- Attio and Twenty have no Lead entity at all. Everything is a Person with relationships.

**Our decision:** Use `CustomerContact` as the identity anchor. Create a lightweight `Engagement` record (many-to-one with CustomerContact) to track discrete prospecting/qualification efforts. No data duplication, no "conversion" that loses fields.

**What changes from original spec:**
- ~~Lead model~~ → `Engagement` model linked to existing `CustomerContact`
- ~~Lead-to-Opportunity conversion~~ → Engagement qualifies into Opportunity (contact already exists)
- StorefrontInquiry auto-creates or matches a `CustomerContact`, then creates an `Engagement`

---

## Decision 2: Many-to-Many Contact↔Account with Junction Table

**What the research says:**
- Twenty, Pipedrive, Monica: one-to-many (simple but breaks on job changes)
- SuiteCRM: many-to-many at DB level, one-to-many in UI (best compromise)
- Attio: native many-to-many with role metadata (gold standard)
- Salesforce: one-to-many, admins build custom flows to handle job changes (workaround city)

**Our decision:** Many-to-many via `ContactAccountRole` junction table:

```
ContactAccountRole
  id, contactId, accountId, roleTitle, isPrimary, startedAt, endedAt
```

- `isPrimary` flag marks the current/active company for display
- `endedAt` preserves history when someone changes jobs
- UI shows primary company in list views, "all roles" in detail view
- Deals link to both Contact AND Account independently

**What changes from current schema:**
- Remove `accountId` FK from `CustomerContact`
- Add `ContactAccountRole` junction table
- Keep backward-compatible: query primary role for list views

---

## Decision 3: Extended Contact Model (EP-CRM-001 P1)

**Informed by Twenty, Frappe, SuiteCRM, Monica:**

| Field | Rationale | Source |
|-------|-----------|--------|
| `firstName`, `lastName` (replace `name`) | Every CRM splits name. Needed for salutation, sorting, dedup | All four |
| `phone` (primary) | Single primary phone, not 5 columns | Twenty, Frappe |
| `jobTitle` | First-class field, not buried in notes | Twenty, Frappe, SuiteCRM |
| `linkedinUrl` | Modern B2B essential — primary research channel | Twenty, Attio |
| `source` | Where did this contact come from? (web, referral, import, manual) | Frappe, SuiteCRM |
| `doNotContact` | GDPR/compliance flag | SuiteCRM |
| `avatarUrl` | Human recognition in lists | Twenty |

**What we're NOT adding (learned from SuiteCRM's mistakes):**
- ~~5 phone fields~~ (home, mobile, work, other, fax) — 1 primary phone, extensible later
- ~~10 address columns~~ — structured address via JSON or separate model
- ~~salutation/prefix/suffix~~ — low value, high friction, add later if demanded
- ~~assistant/assistant_phone~~ — SuiteCRM legacy, nobody uses

**Progressive disclosure principle:** Create a contact with just email (or name + email). Everything else is optional and can be added as the relationship deepens.

---

## Decision 4: Extended Account Model

**Informed by research:**

| Field | Rationale | Source |
|-------|-----------|--------|
| `industry` | Segmentation, already in our validator | Frappe, SuiteCRM |
| `website` | First thing salespeople look up | All four |
| `employeeCount` | ICP qualification | Twenty (as number), Frappe (as range) |
| `annualRevenue` + `currency` | Deal sizing, ICP targeting | Twenty (CurrencyMetadata), Frappe |
| `lifecycleState` | prospect→qualified→onboarding→active→at_risk→suspended→closed | CRM Core epic (already planned) |
| `notes` | Already in our validator | Universal |
| `parentAccountId` | Corporate hierarchies (parent/subsidiary) | SuiteCRM |

**Store `employeeCount` as integer, not range.** Frappe's "1-10, 11-50" enum is limiting. Store the number, display as ranges in UI.

**Store `annualRevenue` as Decimal with separate `currency`.** Twenty's CurrencyMetadata pattern — never store money as a bare number or string.

---

## Decision 5: Activity Model — Unified Polymorphic Timeline

**What the research says:**
- Attio auto-captures email/calendar, displays in unified timeline — best-in-class adoption
- Twenty uses rich notes with markdown in a timeline alongside emails
- Every modern CRM converges on: single reverse-chronological timeline per record
- Auto-capture is the #1 adoption driver. Manual-only = empty CRM within weeks

**Our decision:** Single `Activity` table with type discriminator:

Types: `note | call | email | meeting | task | status_change | quote_event | system`

- `system` type auto-logs stage changes, ownership changes, quote sent/accepted — zero manual effort
- `note` type for manual context ("discussed pricing, they're comparing with Competitor X")
- Email/calendar auto-capture is a future integration, but the model supports it from day one

**Key UX principle:** The activity timeline IS the contact detail page. Not a tab, not a section — the primary view. Everything else (deals, quotes, account info) is in a sidebar or secondary panels.

---

## Decision 6: Pipeline — 6 Stages, Buyer-Centric

**What the research says:**
- 5-7 stages is the practical ceiling. Below 4 loses forecasting, above 7 adds friction.
- Stages must reflect buyer progress, not seller activity. "Demo Completed" is seller-centric. "Need Confirmed" is buyer-centric.
- Separate stage from forecast category. Stage = buyer progress. Forecast = seller confidence.

**Our default stages:**

| Stage | Default Probability | Exit Criteria (buyer action) |
|-------|-------------------|------------------------------|
| Qualification | 10% | Budget, authority, need, timeline confirmed |
| Discovery | 20% | Requirements documented, stakeholders identified |
| Proposal | 40% | Quote/proposal delivered and reviewed by buyer |
| Negotiation | 60% | Terms discussion, buyer comparing options |
| Closed Won | 100% | Contract signed / PO received |
| Closed Lost | 0% | Buyer chose alternative or cancelled |

Plus `Dormant` status — auto-flagged after 45 days of no activity. Can be reopened.

**Stuck deal handling:** Per-stage aging threshold (configurable, default 30 days). Auto-flag at threshold. Surface in pipeline dashboard as "deals at risk."

---

## Decision 7: Quoting — Line + Header Discounts, Versioning

**What the research says (ERPNext + Odoo patterns):**
- Line-level discounts for per-product negotiations ("10% off this SKU")
- Header-level discounts for deal-level concessions ("5% off for signing this week")
- Both are applied in sequence: line discounts first, then header discount on subtotal
- Versioning via amendment chain (new version links to previous), not overwrite
- PDF generation is expected but can be phase 2

**Our MVP quote features:**
1. Line items: product/service, quantity, unit price, line discount %
2. Header discount: percentage or fixed amount
3. Tax rate per line (simple %)
4. Quote versioning: supersede → new version
5. Status: Draft → Sent → Accepted → Converted (or Rejected/Expired)
6. Validity period (expiry date)
7. Link to Opportunity + Account

**Deferred:**
- E-signatures, complex pricing rules, multi-currency, approval workflows, PDF generation

---

## Decision 8: Duplicate Prevention at Creation

**What the research says:**
- 94% of businesses have duplicate data. Dedup must be prevention, not cleanup.
- SuiteCRM's approach: check on save, warn before creating.
- Modern CRMs use fuzzy matching on name + email + company + phone.

**Our approach:**
- On contact creation: fuzzy match against `email` (exact), `firstName + lastName` (normalized), `phone` (digit-only comparison)
- Return potential matches with confidence scores
- UI shows "Did you mean?" before creating
- Server-side: always check, return `similarContacts` in the response (same pattern as our epic creation API)

---

## Decision 9: Full-Text Search

**What the research says:**
- HubSpot's inability to search across notes/contacts is the most upvoted feature request
- "If I can't find it in 3 seconds, the CRM is useless"
- Twenty builds `searchVector` columns directly into entities

**Our approach:**
- Add `searchVector` tsvector column to `CustomerContact` and `CustomerAccount`
- Include: name, email, phone, company name, notes
- Extend to Activity body text (search across all interactions)
- PostgreSQL native full-text search — no external dependency

---

## Implementation Order (Revised)

Based on research, the dependency chain and impact ranking:

### Phase 1: Foundation (EP-CRM-001 P1 — what we're starting now)
1. **Extended contact model** — firstName/lastName split, phone, jobTitle, linkedinUrl, source, doNotContact
2. **ContactAccountRole junction table** — many-to-many with role, isPrimary, dates
3. **Extended account model** — website, employeeCount, annualRevenue, currency, parentAccountId
4. **Duplicate prevention** — fuzzy matching on contact creation
5. **Full-text search** — searchVector on contacts and accounts

### Phase 2: Sales Pipeline
6. **Engagement model** — lightweight prospecting tracker (replaces Lead)
7. **Opportunity model** — 6 buyer-centric stages, probability, aging thresholds
8. **Activity model** — polymorphic timeline with auto-logged system events

### Phase 3: Quoting & Orders
9. **Quote + QuoteLineItem** — line + header discounts, versioning
10. **SalesOrder** — auto-created on quote acceptance
11. **Quote-to-Order conversion flow**

### Phase 4: UI
12. **/customer enhanced** — list with lifecycle filters, search, dedup warnings
13. **/customer/[id] detail** — timeline-first layout, sidebar for account/deals
14. **Pipeline Kanban** — drag-and-drop stage advancement
15. **Quote detail** — line item editor, version history
16. **Dashboard tile** — pipeline value, conversion rates, stuck deals

---

## Anti-Patterns We're Deliberately Avoiding

| Anti-Pattern | Who Does It | Why It Fails | Our Alternative |
|-------------|-------------|--------------|-----------------|
| Separate Lead table with conversion | Salesforce, SuiteCRM | Data loss, dedup nightmare, non-linear journeys break | Unified contact + Engagement record |
| 50+ columns on contact table | SuiteCRM (37 cols) | Most are empty, overwhelms UI, slows queries | Core fields only, progressive disclosure |
| Status stored as string enum | Our current schema | Can't evolve, no audit trail | Lifecycle state + Activity log for transitions |
| Revenue stored as VARCHAR | SuiteCRM | Can't sum, sort, or forecast | Decimal + currency code |
| Single address as 5 flat columns | SuiteCRM (x2 = 10 cols) | Rigid, repeated, can't handle address history | Structured JSON or separate address model |
| Manual-only activity logging | Most CRMs | 79% of data never entered | System auto-logs + manual notes |
| Lead "conversion" destroys original | Salesforce, SuiteCRM | Can't report on lead-to-close journey | Engagement record stays, links to Opportunity |
