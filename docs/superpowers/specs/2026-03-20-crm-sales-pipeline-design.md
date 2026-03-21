# EP-CRM-SALES-001: CRM Sales Pipeline & Quote-to-Order

**Date:** 2026-03-20
**Status:** Draft (revised — research-backed)
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-CRM-SALES-001

**Prerequisites:**
- CRM Core epic (lifecycle state machine, CustomerAccount/CustomerContact schema extensions)

**Related:**
- CRM Core epic — foundation models and lifecycle states
- EP-FINANCE-001 — Financial Primitives and Budget Management (order-to-cash, Finance + CRM integration)
- Storefront epic — customer-facing order/inquiry/booking capture
- Phase 4B — Customer route read-only admin view
- [2026-03-20-crm-research-synthesis.md](2026-03-20-crm-research-synthesis.md) — research findings driving design decisions

**Supersedes:**
- Original version of this spec (pre-research, same date) — replaced Lead model with Engagement model, added many-to-many contact↔account, added discovery stage, changed to buyer-centric stage names

---

## Problem Statement

The platform has a **customer account registry** (`CustomerAccount` with prospect/active/inactive status) and a **storefront** that captures orders, inquiries, bookings, and donations. But there is **no sales process** connecting these two ends:

1. **No prospect tracking.** Storefront inquiries (`StorefrontInquiry`) sit in a table with no workflow to qualify them, assign them to a salesperson, or track follow-up. Inquiries are not linked to prospect accounts.

2. **No sales pipeline.** There is no concept of an opportunity, deal stage, probability, or expected close date. Sales teams have no visibility into what's being worked and what's likely to close.

3. **No quoting.** There is no way to create a quote/proposal for a prospect — itemised pricing, validity dates, terms, versioning, or approval workflows.

4. **No quote-to-order conversion.** The storefront captures `StorefrontOrder` records, but there is no internal sales order that flows from an accepted quote through fulfilment. The two systems are disconnected.

5. **No activity tracking.** Interactions with prospects and customers (calls, emails, meetings, notes) are not recorded. There is no timeline of engagement to inform sales decisions.

6. **No pipeline visibility.** No dashboard, no forecasting, no conversion metrics. Sales management is blind.

---

## Goals

1. **Prospect engagement tracking** — lightweight Engagement records linked to existing contacts, tracking discrete qualification attempts with source attribution and assignment. No separate lead table (avoids Salesforce's conversion nightmare).

2. **Sales opportunity pipeline** — stage-based opportunity tracking with buyer-centric stages (qualification → discovery → proposal → negotiation → closed-won/lost) with probability, expected value, expected close date, and dormant auto-flagging.

3. **Quote/proposal management** — create itemised quotes linked to opportunities, with versioning, validity periods, line-level AND header-level discounts (ERPNext/Odoo pattern), and accept/reject workflow.

4. **Quote-to-order conversion** — accepted quotes automatically create internal sales orders (distinct from storefront orders) with fulfilment tracking.

5. **Activity timeline** — unified polymorphic interaction log per account/contact/opportunity (notes, calls, emails, meetings, system events) as the primary contact view. Auto-logged system events for zero-effort audit trail.

6. **Pipeline dashboard** — workspace tile showing funnel metrics, weighted forecast, conversion rates, and stuck deal warnings.

7. **Integration with existing models** — build on `CustomerAccount`, `CustomerContact`, `StorefrontInquiry`, `StorefrontOrder`, and `DigitalProduct` rather than creating parallel structures.

---

## Non-Goals

- **Marketing automation** — email campaigns, drip sequences, lead scoring ML. Future epic.
- **Payment processing** — handled by EP-FINANCE-001 (ERPNext integration).
- **Customer portal quote acceptance** — portal-side UX is a follow-on. This epic covers the internal sales workflow.
- **Commission tracking** — sales compensation is out of scope.
- **Territory management** — geographic/team assignment rules are future work.
- **Email auto-capture** — auto-logging email/calendar interactions. Model supports it, integration is future.
- **PDF quote generation** — template-based document generation is future.

---

## Design

### Research-Backed Design Decisions

See [2026-03-20-crm-research-synthesis.md](2026-03-20-crm-research-synthesis.md) for full analysis.

| Decision | Rationale | Sources |
|----------|-----------|---------|
| **No separate Lead table** — use Engagement record (many:1 with Contact) | Salesforce's lead conversion is the most-hated CRM pattern. 79% of data lost. HubSpot added lightweight Lead object in 2024 to fix this. | HubSpot 2024 redesign, Attio, Twenty |
| **Many-to-many Contact↔Account** via junction table with role metadata | Handles job changes, consultants, board members without data loss. SuiteCRM does this at DB level. | SuiteCRM, Attio, SugarCRM |
| **Buyer-centric pipeline stages** with separate forecast category | "Demo Completed" is seller-centric and inflates pipelines. Stages must reflect buyer progress. | Inflexion Point, Belkins, Default |
| **6 stages + Dormant** with per-stage aging thresholds | 5-7 stages is consensus ceiling. Stuck deals destroy forecast accuracy. | Community consensus |
| **Line + header discounts** on quotes | ERPNext and Odoo both validate this pattern. Line for per-product, header for deal-level. | ERPNext, Odoo |
| **Unified polymorphic Activity table** | Single timeline query, extensible. All modern CRMs converge here. | Attio, Twenty, HubSpot |
| **Auto-logged system events** in Activity | 79% of manual data never entered. System events provide audit trail at zero cost. | Clari, Rethink Revenue |
| **Duplicate prevention at creation** | 94% of businesses have duplicate contacts. Prevention > cleanup. | RT Dynamic, Insycle |
| **Full-text search** via PostgreSQL tsvector | HubSpot's #1 feature request. "Find it in 3 seconds or CRM is useless." | HubSpot Community |
| **Progressive disclosure** — create contact with just email | Every required field is friction. Ask for data when relevant, not at creation. | Nutshell, Aufait UX |

### 1. Data Model Extensions

All new models live in the same PostgreSQL database via Prisma. No external CRM.

#### 1.1 Engagement (replaces Lead)

Lightweight prospecting record linked to an existing CustomerContact. Tracks discrete qualification attempts — a single contact can have multiple Engagements over time (re-engagement campaigns, different products, etc.).

```prisma
model Engagement {
  id              String           @id @default(cuid())
  engagementId    String           @unique  // ENG-<uuid>
  title           String                    // "Acme Corp interested in Enterprise Plan"
  status          String           @default("new")
  // new | contacted | qualified | unqualified | converted
  source          String?                   // web_inquiry | manual | referral | import
  sourceRefId     String?                   // FK to StorefrontInquiry.id if source=web_inquiry
  accountId       String?                   // FK to CustomerAccount (matched or created)
  contactId       String                    // FK to CustomerContact (identity anchor — required)
  assignedToId    String?                   // FK to User (salesperson)
  notes           String?
  convertedToId   String?                   // FK to Opportunity.id when qualified→converted
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  account         CustomerAccount? @relation(fields: [accountId], references: [id])
  contact         CustomerContact  @relation(fields: [contactId], references: [id])
  assignedTo      User?            @relation("EngagementAssignments", fields: [assignedToId], references: [id])

  @@index([status])
  @@index([accountId])
  @@index([contactId])
  @@index([assignedToId])
}
```

**Key difference from a "Lead" table:** `contactId` is **required**, not optional. The contact must exist first. No data duplication — name, email, phone all live on CustomerContact. Engagement only tracks the qualification attempt.

#### 1.2 Opportunity

A qualified sales opportunity moving through buyer-centric pipeline stages.

```prisma
model Opportunity {
  id              String           @id @default(cuid())
  opportunityId   String           @unique  // OPP-<uuid>
  title           String
  stage           String           @default("qualification")
  // qualification | discovery | proposal | negotiation | closed_won | closed_lost
  isDormant       Boolean          @default(false)  // auto-flagged after aging threshold
  probability     Int              @default(10)     // 0-100%
  expectedValue   Decimal?                          // estimated deal value
  currency        String           @default("GBP")
  expectedClose   DateTime?                         // target close date
  actualClose     DateTime?
  lostReason      String?
  accountId       String                            // FK to CustomerAccount
  contactId       String?                           // FK to primary contact
  assignedToId    String?                           // FK to User (owner)
  engagementId    String?                           // FK to Engagement (if converted from engagement)
  notes           String?
  stageChangedAt  DateTime         @default(now())  // for aging threshold tracking
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  account         CustomerAccount  @relation(fields: [accountId], references: [id])
  contact         CustomerContact? @relation(fields: [contactId], references: [id])
  assignedTo      User?            @relation("OpportunityAssignments", fields: [assignedToId], references: [id])
  quotes          Quote[]
  activities      Activity[]

  @@index([stage])
  @@index([accountId])
  @@index([assignedToId])
  @@index([expectedClose])
  @@index([isDormant])
}
```

#### 1.3 Quote

An itemised proposal attached to an opportunity. Supports both line-level and header-level discounts.

```prisma
model Quote {
  id              String           @id @default(cuid())
  quoteId         String           @unique  // QUO-<uuid>
  quoteNumber     String           @unique  // QUO-2026-0001 (sequential, human-readable)
  version         Int              @default(1)
  previousId      String?                   // FK to previous Quote version (amendment chain)
  status          String           @default("draft")
  // draft | sent | accepted | rejected | expired | superseded
  opportunityId   String                    // FK to Opportunity
  accountId       String                    // FK to CustomerAccount
  validFrom       DateTime         @default(now())
  validUntil      DateTime                  // quote expiry
  subtotal        Decimal                   // sum of line totals (after line discounts)
  discountType    String           @default("percentage") // percentage | fixed
  discountValue   Decimal          @default(0)            // header discount
  taxAmount       Decimal          @default(0)
  totalAmount     Decimal                   // subtotal - header discount + tax
  currency        String           @default("GBP")
  terms           String?                   // payment terms, T&Cs
  notes           String?
  sentAt          DateTime?
  acceptedAt      DateTime?
  rejectedAt      DateTime?
  createdById     String?                   // FK to User who created
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  opportunity     Opportunity      @relation(fields: [opportunityId], references: [id])
  account         CustomerAccount  @relation(fields: [accountId], references: [id])
  createdBy       User?            @relation("QuoteCreations", fields: [createdById], references: [id])
  previous        Quote?           @relation("QuoteVersions", fields: [previousId], references: [id])
  revisions       Quote[]          @relation("QuoteVersions")
  lineItems       QuoteLineItem[]
  salesOrder      SalesOrder?      // 1:1 — accepted quote creates one order

  @@index([opportunityId])
  @@index([accountId])
  @@index([status])
}

model QuoteLineItem {
  id              String           @id @default(cuid())
  quoteId         String                    // FK to Quote
  productId       String?                   // FK to DigitalProduct (optional — ad-hoc lines allowed)
  description     String
  quantity        Int              @default(1)
  unitPrice       Decimal
  discountPercent Decimal          @default(0)  // line-level discount
  taxPercent      Decimal          @default(0)  // per-line tax rate
  lineTotal       Decimal                       // (unitPrice * quantity * (1 - discountPercent/100))
  sortOrder       Int              @default(0)
  createdAt       DateTime         @default(now())

  quote           Quote            @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  product         DigitalProduct?  @relation(fields: [productId], references: [id])

  @@index([quoteId])
}
```

#### 1.4 SalesOrder

Internal order created when a quote is accepted. Distinct from `StorefrontOrder` (which is customer-initiated via the storefront).

```prisma
model SalesOrder {
  id              String           @id @default(cuid())
  orderRef        String           @unique  // SO-2026-0001 (sequential)
  status          String           @default("confirmed")
  // confirmed | in_progress | fulfilled | cancelled
  quoteId         String           @unique  // FK to Quote (1:1)
  accountId       String                    // FK to CustomerAccount
  totalAmount     Decimal
  currency        String           @default("GBP")
  fulfilledAt     DateTime?
  cancelledAt     DateTime?
  notes           String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  quote           Quote            @relation(fields: [quoteId], references: [id])
  account         CustomerAccount  @relation(fields: [accountId], references: [id])

  @@index([accountId])
  @@index([status])
}
```

#### 1.5 Activity

Unified polymorphic interaction log. The activity timeline IS the primary contact/opportunity view.

```prisma
model Activity {
  id              String           @id @default(cuid())
  activityId      String           @unique  // ACT-<uuid>
  type            String
  // note | call | email | meeting | task | status_change | quote_event | system
  subject         String
  body            String?
  scheduledAt     DateTime?
  completedAt     DateTime?
  accountId       String?          // FK to CustomerAccount
  contactId       String?          // FK to CustomerContact
  opportunityId   String?          // FK to Opportunity
  createdById     String?          // FK to User (null for system-generated)
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  account         CustomerAccount? @relation(fields: [accountId], references: [id])
  contact         CustomerContact? @relation(fields: [contactId], references: [id])
  opportunity     Opportunity?     @relation(fields: [opportunityId], references: [id])
  createdBy       User?            @relation("ActivityCreations", fields: [createdById], references: [id])

  @@index([accountId])
  @@index([contactId])
  @@index([opportunityId])
  @@index([createdAt])
  @@index([type])
}
```

**System-generated activity types** (auto-logged, zero manual effort):
- `status_change` — "Account status changed from prospect to qualified" (createdById = null)
- `quote_event` — "Quote QUO-2026-0042 sent to contact" (createdById = sending user)
- `system` — "Opportunity marked dormant after 45 days of inactivity"

### 2. Lifecycle Flows

#### 2.1 Engagement → Opportunity Flow

```
StorefrontInquiry (new)
        ↓ auto-match email → CustomerContact
        ↓ create Engagement (source=web_inquiry)
Engagement (new) → (contacted) → (qualified) → convert()
        ↓                              ↓
   (unqualified)                 Opportunity (qualification)
                                       ↓
                                 (discovery) → requirements documented
                                       ↓
                                 (proposal) → Quote created & sent
                                       ↓
                                 (negotiation) → terms discussion
                                       ↓
                              (closed_won)  |  (closed_lost)
                                    ↓
                              Quote accepted → SalesOrder (confirmed)
                                    ↓
                              (in_progress) → (fulfilled)
```

**No "conversion" that destroys data.** The Engagement record stays (status=converted). The Opportunity links back via `engagementId`. The Contact already exists and is shared.

#### 2.2 Stage → Probability Defaults (Buyer-Centric)

| Stage | Default Probability | Exit Criteria (buyer action) |
|-------|-------------------|------------------------------|
| qualification | 10% | Budget, authority, need, timeline confirmed |
| discovery | 20% | Requirements documented, stakeholders identified |
| proposal | 40% | Quote/proposal delivered and reviewed by buyer |
| negotiation | 60% | Terms discussion, buyer comparing options |
| closed_won | 100% | Contract signed / PO received |
| closed_lost | 0% | Buyer chose alternative or cancelled |

Users can override probability per opportunity. Stage changes auto-suggest the default but don't force it.

**Dormant handling:** If `stageChangedAt` is >45 days ago and stage is not closed_won/closed_lost, auto-set `isDormant = true` and log a system Activity. Dormant opportunities surface in dashboard as "deals at risk."

#### 2.3 Quote Versioning (Amendment Chain)

When a quote is revised:
1. Current quote status → `superseded`
2. New quote created with `version = previous.version + 1`, `previousId = previous.id`
3. Both remain linked to the same opportunity
4. Only one quote per opportunity can be `sent` or `accepted` at a time
5. Full version history traversable via `previousId` chain

### 3. Server Actions

All actions are role-gated. Required permissions: `manage_customer` (HR-200, HR-000, superusers).

| Action | Input | Effect |
|--------|-------|--------|
| `createEngagement` | title, contactId, source, accountId? | Creates Engagement linked to existing contact |
| `qualifyEngagement` | engagementId | Creates Opportunity, sets engagement.status=converted, logs Activity |
| `createOpportunity` | title, accountId, contactId?, stage? | Direct creation without engagement |
| `advanceOpportunityStage` | opportunityId, newStage, probability? | Stage transition, updates stageChangedAt, logs system Activity |
| `closeOpportunity` | opportunityId, won: boolean, lostReason? | Sets closed_won/closed_lost + actualClose, logs Activity |
| `createQuote` | opportunityId, lineItems[], validUntil, terms?, discountType?, discountValue? | Creates Quote with line items, calculates totals |
| `reviseQuote` | quoteId | Supersedes current, creates new version via amendment chain |
| `sendQuote` | quoteId | Sets status=sent, sentAt=now, logs quote_event Activity |
| `acceptQuote` | quoteId | Sets status=accepted, creates SalesOrder, closes opportunity as won, logs Activities |
| `rejectQuote` | quoteId, reason? | Sets status=rejected, logs Activity |
| `logActivity` | type, subject, body?, accountId?, contactId?, opportunityId? | Creates Activity record |

### 4. API Endpoints

```
GET    /api/v1/customer/engagements       — paginated list, filter by status/assignee
POST   /api/v1/customer/engagements       — create engagement
PATCH  /api/v1/customer/engagements/:id   — update engagement, qualify to opportunity
GET    /api/v1/customer/opportunities     — paginated list, filter by stage/assignee/dormant
POST   /api/v1/customer/opportunities     — create opportunity
PATCH  /api/v1/customer/opportunities/:id — update, advance stage, close
GET    /api/v1/customer/quotes            — paginated list, filter by status
POST   /api/v1/customer/quotes            — create quote with line items
PATCH  /api/v1/customer/quotes/:id        — revise, send, accept, reject
GET    /api/v1/customer/sales-orders      — paginated list, filter by status
PATCH  /api/v1/customer/sales-orders/:id  — update fulfilment status
GET    /api/v1/customer/activities        — paginated list, filter by account/contact/opportunity
POST   /api/v1/customer/activities        — log activity
```

### 5. UI Routes

| Route | Purpose |
|-------|---------|
| `/customer` | Enhanced with pipeline summary cards (engagements, opportunities, quotes, orders) |
| `/customer/engagements` | Engagement list with status filters, source badges, bulk assign |
| `/customer/engagements/[id]` | Engagement detail — qualify-to-opportunity action |
| `/customer/opportunities` | Pipeline board (Kanban by stage, drag to advance) + list view toggle |
| `/customer/opportunities/[id]` | Opportunity detail — timeline-first layout, quotes tab, stage controls |
| `/customer/quotes/[id]` | Quote detail — line items editor, version history, send/accept/reject actions |
| `/customer/sales-orders` | Sales order list with fulfilment status |

### 6. Pipeline Dashboard (Workspace Tile)

The customer workspace tile should show:
- **Engagement count** by status (new / contacted / qualified)
- **Pipeline value** — sum of expectedValue for open opportunities, weighted by probability
- **Conversion rate** — engagements converted to opportunities (last 30 days)
- **Deals closing this month** — opportunities with expectedClose in current month
- **Quote acceptance rate** — accepted / (accepted + rejected) last 30 days
- **Deals at risk** — dormant opportunities (>45 days in same stage)

---

## Integration Points

### StorefrontInquiry → Engagement

When a `StorefrontInquiry` is created:
1. Match `customerEmail` against existing `CustomerContact.email`
2. If match found → create Engagement linked to existing contact/account
3. If no match → create CustomerContact (with just email + name from inquiry), then create Engagement

This is **opt-in per storefront** — not all storefronts are sales-oriented (e.g., donations).

### SalesOrder → Finance (EP-FINANCE-001)

When a `SalesOrder` is created:
1. Publish event for finance integration
2. EP-FINANCE-001 picks up the order for invoicing via ERPNext
3. Payment status flows back as order fulfilment status

This integration is **deferred** — the SalesOrder model is self-contained until EP-FINANCE-001 implements the bridge.

---

## Anti-Patterns Deliberately Avoided

| Anti-Pattern | Who Does It | Why It Fails | Our Alternative |
|-------------|-------------|--------------|-----------------|
| Separate Lead table with conversion | Salesforce, SuiteCRM | Data loss, dedup nightmare, non-linear journeys break | Unified contact + Engagement record |
| Seller-centric stage names ("Demo Completed") | Many CRMs | Inflates pipelines, forecasting unreliable | Buyer-centric stages (what buyer agreed to) |
| No stuck-deal detection | Most CRMs | Stale deals rot silently, forecast accuracy collapses | Per-stage aging with auto-dormant flagging |
| Manual-only activity logging | Most CRMs | 79% of data never entered | System auto-logs + manual notes |
| Lead "conversion" destroys original | Salesforce, SuiteCRM | Can't report on lead-to-close journey | Engagement record stays, links to Opportunity |

---

## Out of Scope (Future Epics)

- **Customer portal quote acceptance** — customer sees and accepts quotes via portal
- **Email/calendar auto-capture** — auto-log emails and meetings into activity timeline
- **Lead scoring** — ML-based qualification scoring
- **Sales territories and teams** — assignment rules, team quotas
- **Recurring revenue tracking** — MRR/ARR from subscriptions (bridges to CustomerSubscription from CRM Core)
- **Custom fields** — user-defined fields on engagements, opportunities, quotes
- **Approval workflows** — quote approval chains for high-value deals
- **Document generation** — PDF quote/proposal generation from templates
- **Multi-currency** — quotes and opportunities in multiple currencies
