---
title: Archetype Portal Screen Prototypes
date: 2026-06-06
status: draft — architect-reviewed 2026-06-06 (default-home gap resolved); ready for founder review
owner: Mark Bodman
author: Codex
reviewer: Enterprise Architect persona (Claude) — review folded 2026-06-06
scope: Text mockups and review criteria for archetype-specific main portal and worker-home screens
out_of_scope:
  - Runtime implementation
  - Live portal verification
  - Deployment or self-upgrade validation
related_plans:
  - docs/superpowers/plans/2026-06-06-archetype-acceptance-test-plan.md
  - docs/superpowers/plans/2026-05-17-business-capability-employee-work-taxonomy.md
related_specs:
  - docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md
  - docs/superpowers/specs/2026-06-04-workspace-home-contribution-roster-design.md
  - docs/superpowers/specs/2026-06-05-portal-navigation-archetype-ia-design.md
  - docs/superpowers/specs/2026-06-06-main-portal-workspace-home-redesign-design.md
primary_epics:
  - EP-REDUCTION-GEAR-ARCH
  - EP-BIZ-CAP
---

# Archetype Portal Screen Prototypes

## 1. Purpose

This spec captures low-fidelity text mockups for the archetype-specific DPF portal screens that need critique before implementation. It is intended for another agent, designer, architect, or operator to review for:

- critical content
- form and tone
- layout
- function
- business capability coverage
- employee role fit
- native vs integration-led posture

It does not implement any UI. It makes the target screens concrete enough that Build Studio or another agent can critique the design before writing code.

## 1a. Enterprise Architect Review (2026-06-06)

**Verdict: keep the per-archetype prototype set; close the one gap it leaves open — the default home.** The category prototypes (§7), the worker-facing copy rule (§5.2), the critical-strip row format (§5.3), the contribution-manifest stubs (§5.4), and the all-archetype coverage decisions (§8) are sound and align with the canonical substrate ([vertical-workspace-home](2026-05-24-vertical-workspace-home-design.md), [archetype-aware-workspace](2026-05-31-archetype-aware-workspace-design.md)). They need no structural change.

**The gap:** §7.1 treats the platform/operator home as the default and says only "preserve `PlatformWorkspaceHome`." But that platform-operator composition — a 6×6 Six-Cs *readiness maturity matrix*, a cross-domain tile launchpad, and a firehose calendar mixing customer bookings with platform cron digests and deployment windows — **is what every install lands on today**, because `defaultWorkspaceHomeRegistry` is empty and most archetypes have no registered contribution yet. That default home is *not* a business day-to-day surface; it is internal platform minutia occupying the company's prime screen (the same defect the [IA audit](2026-06-05-portal-navigation-archetype-ia-design.md) named).

**Resolution (folded in):** the default/fallback `/workspace` home is now redesigned in a dedicated sibling spec — [Main Portal Workspace Home Redesign](2026-06-06-main-portal-workspace-home-redesign-design.md). It makes the default home answer "what is the immediate and next-up work for this business?" using the **report-kit** palette, wired to **real loaders** (no fabricated data), with the **full platform schedule moved to an operator admin surface** and replaced by a purposed business "Today & Next" agenda. The Six-Cs readiness matrix relocates to the operator surface, where it is the `software-platform` install's legitimate day-to-day. §7.1 below is updated to reference that redesign rather than implying operator chrome is an acceptable default for ordinary businesses.

This prototype spec (the per-archetype mockups) and the default-home redesign together cover both halves of the main portal: the configured-vertical homes *and* the default home every business sees first.

## 1b. Current Substrate Review (2026-07-18)

**Catalog growth:** the source catalog now contains 95 archetypes across 21 category files in `packages/storefront-templates/src/archetypes`. The original prototype set still gives the right review method, but the all-archetype coverage table in §8 is now a historical baseline for the first 46 archetypes, not a complete roster.

**Workspace-home growth:** `defaultWorkspaceHomeRegistry` now registers seeded contributions from `apps/web/lib/workspace-home/profiles.ts`. The current route (`apps/web/app/(shell)/workspace/page.tsx`) resolves the storefront archetype, loads the operational twin, renders `OperatorCockpit` as the single attention surface, and then chooses among `WorkspaceTwinHero`, `VerticalWorkspaceHome`, or `PlatformWorkspaceHome`. `VerticalWorkspaceHome` is now an identity/context banner over the shared workspace body rather than a separate static queue.

**Review implication:** prototype critique must now cover three layers:

1. Does the catalog map every current archetype to a category, CTA, activation profile, and vocabulary?
2. Does the workspace resolve to the right live mode: exact/category contribution, twin hero, or honest fallback?
3. Do regulated or integration-led archetypes preserve boundaries instead of implying DPF owns core banking, clinical, public-safety/CJIS, payment-rail, payroll, POS, or other vertical execution?

The acceptance vehicle for this current-state review is the updated [Archetype Acceptance Test Plan](../plans/2026-06-06-archetype-acceptance-test-plan.md), which now requires category-sentinel coverage for all 21 current category files.

## 2. Direct Answer: Is Main Portal Screen Configuration Mapped To This Work?

Yes. The main portal and worker-home configuration ability is already architecturally mapped to this work, but the target screens are not fully specified or implemented yet.

### Current Configuration Plumbing

The current source already carries these archetype-controlled inputs:

| Configurable input | Current source/surface | What it can influence |
| --- | --- | --- |
| Active archetype | `StorefrontConfig -> StorefrontArchetype` | The install's business type and semantic archetype. |
| Category | `StorefrontArchetype.category` | Vocabulary, finance setup profile, category-level worker-home fallback, and item suggestions. |
| CTA type | `StorefrontArchetype.ctaType` | Customer action: booking, purchase, inquiry, or donation. |
| Item templates | `StorefrontArchetype.itemTemplates` | Public portal offerings and item-management defaults. |
| Section templates | `StorefrontArchetype.sectionTemplates` | Public portal page sections. |
| Custom vocabulary | `StorefrontArchetype.customVocabulary` | Labels for items, stakeholders, team, inbox, and portal. |
| Activation profile | `StorefrontArchetype.activationProfile` | Required/recommended capabilities, billing profile, customer-scope isolation, and setup prompts. |
| Workspace-home activation summary | `buildWorkspaceHomeActivationSummaries()` | Setup preview for worker-home mode, primary operating question, primitives, required data, and missing-data behavior. |
| Finance setup profile | `financeProfileSlugFromCategory()` | Payment pattern, recurring billing applicability, invoices, currency, tax defaults. |
| Capability toggles | `/storefront/settings/capabilities` | Add-later toggles for recommended capabilities. |
| Public portal admin tabs | `/storefront` | Dashboard, sections, items, team, inbox, settings, with archetype vocabulary. |
| Main worker home resolver | `resolveWorkspaceHomeContribution()` | Exact archetype contribution, category fallback, or platform fallback. |

### Current Gap

The main `/workspace` route now resolves the contribution state and can render a live operational twin, exact/category workspace contribution identity, or shared platform workspace body. The old gap was a missing contribution registry; the current gap is different: not every one of the 21 current categories has a full first-viewport prototype, and the acceptance plan must verify that the composed runtime surface does not hide generic fallbacks behind tailored language.

The gap is not a lack of architectural hooks. The gap is maintaining an up-to-date, reviewable mapping from category/exact archetype to:

- customer CTA and resulting record;
- activation profile and capability posture;
- workspace-home contribution or honest fallback;
- operational twin semantics;
- finance and integration boundary;
- employee role/coworker handoff expectations.

This spec fills the prototype gap for the original categories and defines the review method for later category expansions. The acceptance plan owns the current 95/21 verification matrix.

### Target Configuration Model

The target portal configuration should resolve these values from the chosen archetype and present them in setup before commit:

| Target setting | Derived from | Used by |
| --- | --- | --- |
| `workerHomeMode` | Workspace-home resolver | Main `/workspace` first viewport. |
| `workerHomeContributionId` | Exact or category contribution | Slot/component manifest and setup activation. |
| `primaryOperatingQuestion` | Workspace-home contribution | Setup preview, worker-home page title/subtitle, review criteria. |
| `workerChromeMode` | `WorkspaceHomeResolution.mode` plus role | Global rail and shell language. |
| `customerPortalTemplate` | `sectionTemplates`, `itemTemplates`, `ctaType`, vocabulary | Public/customer portal and `/storefront` admin. |
| `financeProfileSlug` | `financeProfileSlugFromCategory(category)` | Finance setup and accounting/payment readiness. |
| `integrationPostureCards` | Category + activation profile + capability taxonomy | Setup preview, platform tools, capability pages. |
| `employeeRoleLanes` | Category prototype + activation profile | Team setup, work queues, coworker handoffs. |
| `capabilityMarketEnrichment` | Business capability taxonomy and spreadsheet-derived commercial market/product fields | Capability review, integration posture, backlog capture. |

The setup experience should therefore preview five downstream screens:

```text
[Worker home] [Customer portal] [Money setup] [Integrations] [Team/coworkers]
```

The current DPF code can already support the first four inputs in pieces. The prototype work decides the missing screen semantics, especially `workerHomeContributionId`, `employeeRoleLanes`, and `capabilityMarketEnrichment`.

## 3. Design And Research Benchmarks

### Standards And Architecture References

- ServiceNow CSDM treats business services, technical services, applications, and capabilities as relationship-rich data that should be implemented progressively rather than all at once. Adopted for DPF: use clear relationships between business capability, employee work, product surface, integration, and worker-home contribution. Source: https://www.servicenow.com/docs/r/servicenow-platform/common-service-data-model-csdm/csdm-conceptual-model.html
- The Open Group IT4IT uses value streams and digital products to manage digital product delivery at scale. Adopted for DPF: use IT4IT-like structure for the `software-platform` archetype and portfolio/product/backlog surfaces, but do not force software-product vocabulary onto every SMB archetype. Source: https://www.opengroup.org/it4it
- BIAN's Service Landscape organizes banking service domains and business capabilities. Adopted for DPF: when a vertical has a strong external taxonomy such as banking, use it structurally as a vertical capability reference, not as a direct implementation requirement for every small business. Source: https://bian.org/deliverables/bian-standards/bian-service-landscape-5-0/

### Product Benchmarks

- Odoo documents a broad suite across Finance, Sales, Websites, Supply Chain, HR, Marketing, Services, Productivity, and Studio. Adopted for DPF: archetype homes should combine cross-suite work into one role-specific first screen rather than making a small-business user navigate every module. Source: https://www.odoo.com/documentation/latest/applications.html
- ERPNext covers ERP-style business domains including accounting, inventory, CRM, HR, retail, healthcare, and education. Adopted for DPF: archetype-specific screens should lean on operational records and industry modules, but DPF should keep its AI coworker and backlog/governance layer as a differentiator. Source: https://docs.erpnext.com/
- Microsoft Dynamics 365 industry solutions use industry data models, including healthcare data models based on FHIR. Adopted for DPF: regulated or domain-specific verticals should have vertical data-model awareness, but DPF should surface that as posture and setup guidance until the implementation is ready. Source: https://learn.microsoft.com/en-us/dynamics365/industry/
- QuickBooks anchors small-business finance around income, expenses, invoices, bills, payments, bank reconciliation, reports, and tax readiness. Adopted for DPF: every archetype prototype must state whether finance is native DPF, QuickBooks-led, Stripe-led, or hybrid. Source: https://quickbooks.intuit.com/accounting/

## 4. Prototype Method

The prototypes use a category-first, exact-override model:

- Category prototype: one full screen shape per archetype category.
- Exact archetype delta: each archetype lists the content, form, layout, and function that differs from the category prototype.
- Main portal mapping: each prototype declares the public/customer portal shape, worker-home shape, finance/integration posture, and employee/coworker focus.

This matches the existing resolver: exact archetype -> category fallback -> unconfigured platform fallback.

## 5. Common Screen Skeleton

Every worker-home prototype uses the same reviewable skeleton:

```text
Header:
  [Business label] [Archetype/status chip] [Primary setup/integration gap]

Critical strip:
  Exceptions that must be handled before the business day goes sideways.

Primary zone:
  The answer to the worker's first operating question.

Secondary zone:
  Supporting business context: money, customer, inventory, compliance, or capacity.

Briefing zone:
  AI coworker handoffs, employee queues, approvals, and communication exceptions.

Setup/integration rail:
  QuickBooks, Stripe, CRM, payroll, Microsoft 365, marketing, local presence,
  inventory, compliance, or vertical-specific connectors.
```

Every prototype also declares:

```text
Critical content:
Form/tone:
Layout intent:
Primary function:
Employee lanes:
Customer portal posture:
Finance posture:
Integration anchors:
AI coworker fit:
Prototype risks:
```

### 5.1 First-Viewport Layout Rule

Desktop first viewport must show:

1. Header with business label, archetype/status chip, and one setup/integration gap.
2. Critical strip with at least one actionable row, not just count chips.
3. Primary board answering the operating question.
4. Setup/integration rail with the next configuration action and 2-4 integration anchors.

Mobile order must be:

```text
Critical strip
Current/next item
Primary queue
One setup/integration gap
Briefing/coworker handoffs
Secondary analytics and supporting context
```

Secondary cards can move below the fold. The setup gap cannot disappear below the fold while the install is incomplete.

### 5.2 Worker-Facing Copy Rule

The mockup itself uses employee language. Architecture notes can use canonical terms.

| Architecture term | Worker-facing copy |
| --- | --- |
| Billing readiness | Ready to invoice / payment setup |
| Lifecycle review queues | Reviews due / renewals due / follow-up checks |
| Capability toggles | Add-on features / optional business tools |
| Coworker drafts | AI-prepared replies / AI-prepared notes |
| Required canonical data | Missing setup data |
| Required signals | Alerts this screen needs |
| Workspace contribution | Worker home |

### 5.3 Critical Strip Row Format

Each critical strip must include an object, time or urgency, owner, state, and next action:

```text
[Time/urgency] [Object/customer/person] - [problem state] - [owner] - [next action]
```

Examples:

| Prototype | Actionable critical row |
| --- | --- |
| Software Platform | `Now BI-4025EF5F build review - blocked on evidence - build operator - open review packet` |
| Professional Services | `Today Acme renewal - proposal unsent - account manager - send for client review` |
| Trades And Maintenance | `10:30 Johnson repair - confirmation failed - dispatcher - call customer` |
| Healthcare And Wellness | `09:20 Room 2 appointment - intake missing - front desk - collect form` |
| Beauty And Personal Care | `11:00 Emma color service - patch note missing - front desk - confirm before chair` |
| Education And Training | `16:00 Patel tutoring - exam plan behind - instructor - update progress note` |
| Food And Hospitality | `Dinner prep - salmon stock low - kitchen lead - approve supplier run` |
| Retail And Goods | `Order 1048 - picking delayed - store manager - assign fulfillment` |
| Fitness And Recreation | `18:00 yoga class - waitlist full - front desk - confirm room capacity` |
| Nonprofit And Community | `Urgent intake - volunteer cover missing - program lead - assign shift` |
| Pet Services | `14:30 Bailey groom - owner pickup note missing - groomer - send update` |
| HOA And Property Management | `Unit 4B leak - vendor overdue - property manager - escalate repair` |

### 5.4 Contribution Manifest Stub Format

Every category or exact screen must eventually become a workspace-home contribution manifest. The prototype critique should verify these stubs before implementation:

```text
contributionId:
match: category | exact | platform-operator-mode
primaryOperatingQuestion:
slots:
  - slotId: today-now | exceptions-needs-review | coworker-handoffs | custom
    zone: critical-strip | primary | secondary | briefing | setup
    primitiveKey:
    componentKey:
    title:
    dataRefs:
primaryRoutes:
setupActivation:
  requiredCanonicalData:
  requiredSignals:
  missingDataBehavior:
emptyState:
```

Prototype-level stubs:

| Prototype | Match | Primary primitive/component stub | Primary routes/actions | Required data/signals | Empty state |
| --- | --- | --- | --- | --- | --- |
| Software Platform | `platform-operator-mode` | Platform command center, existing `PlatformWorkspaceHome` | `/workspace`, `/ops`, `/build`, `/platform/ai/authority` | Backlog, builds, runtime health, tool evidence | Preserve platform home; no registered vertical contribution until architect approves. |
| Professional Services | category + MSP exact | `case-board` / `customer-callbacks`; MSP adds `health-board` | `/customer`, `/customer/engagements`, `/finance/invoices`, `/storefront/inbox` | Customers, opportunities, work items, invoices, communication attempts | Render client-work empty state with setup link. |
| Trades And Maintenance | category | `decision-queue` / `today-schedule`, `capacity-lanes` / `technician-load` | `/workspace/my-queue`, `/storefront/inbox`, `/customer`, `/finance/purchase-orders` | WorkItem, CalendarEvent, customer/site, communication attempts | Render empty job board with service-request setup. |
| Healthcare And Wellness | category | `appointment-schedule` / `patient-queue`, `capacity-lanes` / `shift-summary` | `/storefront/inbox`, `/customer`, `/compliance/licensing`, `/finance/payments` | Bookings, customer/patient record, provider schedule, reminder attempts | Render empty appointment schedule; do not imply clinical record ownership. |
| Beauty And Personal Care | category | `appointment-schedule` / `today-schedule`, `inventory-watch` / `inventory-alerts` | `/storefront/inbox`, `/storefront/team`, `/storefront/items`, `/finance/payments` | Bookings, providers, services, supplies/payment state | Render empty booking board with services/team setup links. |
| Education And Training | category | `appointment-schedule` / `today-schedule`, `case-board` / `customer-callbacks` | `/storefront/inbox`, `/customer`, `/storefront/items`, `/finance/payments` | Sessions/bookings, learners/accounts, instructors, messages | Render empty lesson/cohort board. |
| Food And Hospitality | category | `service-period-board` / `shift-summary`, `inventory-watch` / `inventory-alerts` | `/storefront/inbox`, `/storefront/items`, `/finance/suppliers`, `/finance/purchase-orders` | Bookings/orders, menu/items, stock, staff schedule | Render empty service period; keep stock setup visible. |
| Retail And Goods | category + wholesale exact | `decision-queue` / `retail-replenishment`, `inventory-watch` / `inventory-alerts` | `/storefront/items`, `/storefront/inbox`, `/finance/purchase-orders`, `/customer` | Products, orders/inquiries, stock, suppliers, customer accounts | Render empty products/orders board; trade exact shows account setup. |
| Fitness And Recreation | category | `appointment-schedule` / `today-schedule`, `case-board` / `customer-callbacks` | `/storefront/inbox`, `/storefront/items`, `/customer`, `/finance/payments` | Classes/bookings, members, instructors, payment attempts | Render empty class/member board. |
| Nonprofit And Community | category + animal-care exact | `case-board` / `customer-callbacks`, `volunteer-program-board` / `shift-summary` | `/storefront/inbox`, `/storefront/items`, `/customer/marketing`, `/finance/reports` | Programs/cases, donations, volunteers, communication attempts | Render empty program board with donation/volunteer setup. |
| Pet Services | category | `appointment-schedule` / `today-schedule`, `case-board` / `customer-callbacks` | `/storefront/inbox`, `/storefront/team`, `/storefront/items`, `/finance/payments` | Pets/owners, bookings, care notes, staff capacity | Render empty animal schedule with service/team setup. |
| HOA And Property Management | category | `case-board` / `customer-callbacks`, `decision-queue` / `unassigned-work` | `/customer`, `/storefront/inbox`, `/finance/invoices`, `/compliance/licensing` | Requests, owners/residents, vendors, notices, finance records | Render empty request board with community portal setup. |

### 5.5 Setup/Integration Rail Content

Every prototype's right rail should show one active setup gap and the integration posture most likely to matter:

| Prototype | Rail content |
| --- | --- |
| Software Platform | `Open review evidence`; anchors: GitHub, OpenAI/Codex, Stripe, QuickBooks, runtime tools. |
| Professional Services | `Connect books or client email`; anchors: QuickBooks, Stripe, HubSpot, Microsoft 365. |
| Trades And Maintenance | `Finish service request and crew setup`; anchors: QuickBooks, Stripe, Microsoft 365/SMS, Google Business Profile. |
| Healthcare And Wellness | `Finish appointment reminders and compliance setup`; anchors: Stripe, QuickBooks, Microsoft 365, EHR/practice system later. |
| Beauty And Personal Care | `Add team availability and services`; anchors: Stripe, QuickBooks, Mailchimp, Google Business Profile. |
| Education And Training | `Add instructors and course/session catalog`; anchors: Stripe, QuickBooks, HubSpot, Microsoft 365. |
| Food And Hospitality | `Add menu/service period and stock vendors`; anchors: Stripe/POS, QuickBooks, Google Business Profile, social channels. |
| Retail And Goods | `Add products, stock, and order handling`; anchors: Stripe/POS, QuickBooks, HubSpot, inventory/ecommerce provider later. |
| Fitness And Recreation | `Add classes, instructors, and membership/payment setup`; anchors: Stripe, QuickBooks, Mailchimp, Google Business Profile. |
| Nonprofit And Community | `Add donation/volunteer/program setup`; anchors: Stripe, QuickBooks, Mailchimp, Microsoft 365. |
| Pet Services | `Add services, staff capacity, and pet intake fields`; anchors: Stripe, QuickBooks, Google Business Profile, communications. |
| HOA And Property Management | `Add request categories, vendors, and assessment/payment setup`; anchors: QuickBooks, Stripe/payment portal, Microsoft 365, property-management provider later. |

### 5.6 Capability And Role Wiring

The current `CAPABILITY_REGISTRY` is activation-profile oriented and does not yet contain every business capability from `EP-BIZ-CAP`. Use registry keys where they exist; otherwise use the business capability taxonomy row rather than inventing keys.

| Prototype | Employee roles | Registry keys where applicable | Business capability focus | Integration posture |
| --- | --- | --- | --- | --- |
| Software Platform | owner/operator, product lead, build operator, support | `project-work`, `lifecycle-review-queues`, `billing-readiness` | portfolio/product/backlog operations, runtime governance | native DPF with selected integrations |
| Professional Services | owner/operator, practitioner, sales/BD, admin, bookkeeper | `customer-accounts`, `project-work`, `billing-readiness`, MSP adds `customer-estate`, `service-agreements`, `remote-support` | client work, pipeline, billing, service delivery | hybrid |
| Trades And Maintenance | dispatcher, technician/crew, service admin, owner, bookkeeper | `customer-accounts`, `customer-sites`, `billing-readiness`, `appointment-checkout` where booking applies | service delivery, dispatch, customer support, procurement | hybrid |
| Healthcare And Wellness | front desk, practitioner, admin, compliance, bookkeeper | `appointment-checkout`, `customer-accounts`, `billing-readiness` | appointments, intake, compliance, follow-up | integration-led for clinical, hybrid for operations |
| Beauty And Personal Care | front desk, stylist/tech/trainer, owner, marketing, bookkeeper | `appointment-checkout`, `point-of-sale`, `billing-readiness` | bookings, capacity, rebooking, supplies | hybrid |
| Education And Training | instructor, admin, enrolment, owner, bookkeeper | `appointment-checkout`, `project-work`, `billing-readiness` | sessions, learner progress, enrolment | hybrid |
| Food And Hospitality | manager, kitchen/production, front-of-house, owner, bookkeeper | `point-of-sale`, `customer-accounts`, `billing-readiness` | service period, orders, stock, purchasing | integration-led for POS, hybrid for operations |
| Retail And Goods | store manager, fulfillment, procurement, sales, bookkeeper | `point-of-sale`, `customer-accounts`, `partner-program`, `billing-readiness` | orders, inventory, procurement, customer/trade accounts | hybrid |
| Fitness And Recreation | front desk, instructor/trainer, owner, marketing, bookkeeper | `appointment-checkout`, `point-of-sale`, `billing-readiness` | classes, memberships, retention | hybrid |
| Nonprofit And Community | program manager, volunteer coordinator, fundraiser, admin, bookkeeper | `customer-accounts`, `billing-readiness` | programs, donors, volunteers, cases | hybrid |
| Pet Services | groomer/carer/walker, front desk, owner, customer support | `appointment-checkout`, `customer-accounts`, `billing-readiness` | animal care, bookings, capacity, owner updates | hybrid |
| HOA And Property Management | property manager, board/admin, vendor coordinator, bookkeeper | `customer-accounts`, `customer-sites`, `billing-readiness` | requests, vendors, assessments, notices | hybrid |

### 5.7 Public Portal CTA Route And Record Mapping

Every archetype has a public customer/storefront shape through `/s/[slug]` and an internal management shape through `/storefront`. The external customer account surface `/portal` remains separate.

| CTA type | Public route shape | Internal record/work surface | Notes for prototype review |
| --- | --- | --- | --- |
| `booking` | `/s/[slug]/book/[itemId]` | `StorefrontBooking`, visible in `/storefront/inbox` | Must show date/time, provider/resource, customer, service, confirmation state. |
| `purchase` | `/s/[slug]/order/[itemId]` then checkout/confirmation | `StorefrontOrder`, visible in `/storefront/inbox` | Must show item, quantity, price/payment state, pickup/shipping if relevant. |
| `inquiry` | `/s/[slug]/inquire` or `/s/[slug]/inquire/[itemId]` | `StorefrontInquiry`, visible in `/storefront/inbox` | Must show request, customer, desired outcome, owner, next response. |
| `donation` | `/s/[slug]/donate` | `StorefrontDonation`, visible in `/storefront/inbox` | Must show donor/supporter, amount/campaign, acknowledgement status. |
| `rental` | currently `/s/[slug]/inquire/[itemId]` with reserve/rental labels | `StorefrontInquiry`, plus rental/unit admin surfaces where implemented | Must make reservation dates, asset/unit, deposit/rate posture, pickup/return or move-in expectations clear. Do not imply direct rental checkout until the rental transaction substrate exists. |

Review rule: if the prototype's customer action does not match the archetype's `ctaType`, mark the prototype `Fail` unless the exact archetype intentionally overrides the item CTA in its item template.

## 6. Configuration Preview Screen

The setup flow needs a reviewable preview that connects all downstream screens before the operator commits the archetype.

```text
Business setup: Choose your business type

[Search archetypes.....................................]

Selected: Wholesale Distribution
Category: Retail and goods
Customer action: Inquiry / trade account

Activation preview
+----------------------------------------------------------+
| Worker home: Trade operations board                      |
| The worker arrives asking: What orders, stock, and       |
| customer account requests need attention today?          |
|                                                          |
| Required data: customers, products, inventory, orders    |
| Optional: QuickBooks, Stripe, HubSpot, Microsoft 365     |
|                                                          |
| Capabilities: customer accounts, inventory, purchase,    |
| billing readiness, lifecycle review queues               |
+----------------------------------------------------------+

Screens this will configure
[Worker home] [Customer portal] [Money setup] [Integrations] [Team/coworkers]

Next step:
  Configure public portal and finance profile
```

Review goal: the operator should understand what will change in the main worker home, public portal, finance profile, capability toggles, and integrations before saving.

## 7. Category Prototypes

### 7.1 Software Platform

Representative archetype: `software-platform`

Primary operating question: "What needs to ship, recover, or be governed today?"

Architecture posture: `PlatformWorkspaceHome` is the **platform-operator mode** and the legitimate day-to-day home for the `software-platform` (DPF-on-DPF) install only. It is **not** the acceptable default for ordinary businesses. The composition described here (readiness matrix, command center, full platform schedule) is the *operator* surface; ordinary installs that have no registered vertical contribution get the redesigned business default home instead — see [Main Portal Workspace Home Redesign](2026-06-06-main-portal-workspace-home-redesign-design.md), which moves the 6×6 readiness matrix and the full platform/cron schedule here (to the operator surface) and gives the default home a business "Today & Next" agenda + work queue wired to real data with report-kit. This prototype is an operator target screen, not evidence that every business archetype should inherit platform chrome.

```text
Open Digital Product Factory - Platform Operator Home

Critical strip
[Failed checks 2] [Open incidents 1] [Blocked builds 3] [Unreviewed AI actions 5]

Primary zone
+---------------------------+ +---------------------------+
| Delivery board            | | Runtime health            |
| Ready to review: 4        | | Main portal: healthy      |
| In build: 3               | | MCP: degraded             |
| Waiting on human: 2       | | Local CI lease: busy      |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Roadmap and backlog       | | Product/customer signals  |
| EPs with open items       | | Customer feedback         |
| Next recommended work     | | Storefront inquiries      |
+---------------------------+ +---------------------------+

Briefing zone
[Build Studio handoffs] [Governance approvals] [AI coworker capability gaps]
```

Critical content: releases, builds, self-upgrade health, backlog, incidents, AI authority, product/customer signals.

Form/tone: platform-operator language is acceptable here. This is the one archetype where Build Studio, backlog, product, and runtime vocabulary belongs in the first viewport.

Layout intent: command center plus delivery health. Keep customer/operator data visible but secondary.

Primary function: help the platform operator decide what to ship, unblock, or govern next.

Employee lanes: owner/operator, product lead, build/release operator, platform admin, support.

Customer portal posture: public product inquiry and customer portal remain separate from operator home.

Finance posture: hybrid. Stripe and QuickBooks matter for platform billing/accounting but should not dominate first viewport.

Integration anchors: GitHub, OpenAI/Codex, Microsoft 365, Stripe, QuickBooks, HubSpot, Mailchimp, monitoring/runtime connectors.

AI coworker fit: portfolio advisor, build specialist, platform engineer, support analyst, finance controller.

Prototype risks: if this screen becomes the default for non-platform archetypes, every SMB vertical will feel like internal DPF administration.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `software-platform` | Keep platform/operator home. Do not use this as the generic worker-home fallback for ordinary businesses once category contributions exist. |

### 7.2 Professional Services

Representative archetypes: `it-managed-services`, `accounting`, `legal-services`, `consulting`, `marketing-agency`

Primary operating question: "Which clients, engagements, and deadlines need attention today?"

```text
Professional Services - Client Work Home

Critical strip
[Due today 6] [Client risks 2] [Unsent proposals 3] [Invoice holds 1]

Primary zone
+---------------------------+ +---------------------------+
| Client work board         | | Capacity by role          |
| Matters/projects          | | Partner/manager load      |
| Next client action        | | Staff availability        |
| Due dates                 | | Overbooked work           |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Pipeline and proposals    | | Billing readiness         |
| Leads, quotes, renewals   | | WIP, retainers, invoices  |
+---------------------------+ +---------------------------+

Briefing zone
[Client follow-ups] [Coworker drafts] [Contract/accountant review] [Email failures]
```

Critical content: clients, matters/projects, deadlines, proposals, billing readiness, capacity, follow-ups.

Form/tone: client-service language. Avoid "product backlog" unless the firm is delivering software/product work.

Layout intent: case-board-led for legal/accounting; project-deliverable-led for consulting/marketing; health-board-led for MSP.

Primary function: make client work, deadlines, proposals, and billing visible in one worker screen.

Employee lanes: owner/operator, account manager, consultant, practitioner, sales/BD, bookkeeper/accountant, support/admin.

Customer portal posture: client portal for inquiries, onboarding forms, documents, and project/status requests.

Finance posture: hybrid. QuickBooks for accounting, Stripe for payments, DPF for client work and billing readiness.

Integration anchors: QuickBooks, Stripe, HubSpot, Microsoft 365, Mailchimp, Google Business Profile, service desk/RMM for MSP.

AI coworker fit: client engagement assistant, sales assistant, bookkeeper/accountant, service coordinator, security/compliance helper for MSP.

Prototype risks: MSP is materially different from non-MSP professional services and should keep exact-override treatment.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `it-managed-services` | Replace generic client work board with customer estate health, open tickets, SLA risk, device/security posture, recurring agreements, and remote-support handoffs. |
| `accounting` | Emphasize client deadlines, books/tax/close work, document requests, accountant collaboration, and QuickBooks posture. |
| `legal-services` | Emphasize matters, deadlines, document review, conflict checks, retainers, and client communications. |
| `consulting` | Emphasize engagements, deliverables, milestones, workshops, account growth, and proposal pipeline. |
| `marketing-agency` | Emphasize campaigns, approvals, content calendar, lead sources, client reporting, Mailchimp/HubSpot/Google posture. |

### 7.3 Trades And Maintenance

Representative archetypes: `plumber`, `electrician`, `facilities-maintenance`, `cleaning-service`, `landscaping`

Primary operating question: "What is on the board today, who is blocked, and who needs an update?"

```text
Trades and Maintenance - Dispatch Home

Critical strip
[Emergency jobs 2] [Unassigned 4] [Parts blocked 3] [Customer update failed 1]

Primary zone
+---------------------------+ +---------------------------+
| Today's job board         | | Crew load                 |
| Job, site, window, status | | Technician/crew capacity  |
| Next stop / late risk     | | Overloaded routes         |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Site map / routes         | | Parts and purchase needs  |
| Open sites, ETA, distance | | Truck stock, PO gaps      |
+---------------------------+ +---------------------------+

Briefing zone
[Dispatcher approvals] [Customer callbacks] [Quote follow-ups] [Safety/compliance gaps]
```

Critical content: jobs, sites, crew, emergency priority, parts, ETA/customer communications, quotes.

Form/tone: operational and plain. Use "jobs", "sites", "crew", "service calls", not platform language.

Layout intent: dispatch-first. Map and parts are supporting unless the exact archetype makes them primary.

Primary function: keep service work moving and reduce missed appointments or unhandled emergencies.

Employee lanes: owner/operator, dispatcher, technician/crew, service admin, bookkeeper, customer support.

Customer portal posture: service request portal with quote/request forms and status updates.

Finance posture: hybrid. DPF can own jobs, quotes, and service requests; QuickBooks/Stripe own accounting/payments until maturity increases.

Integration anchors: QuickBooks, Stripe, Microsoft 365, Google Business Profile, communications/SMS, field-service/service-desk providers later.

AI coworker fit: dispatcher/service coordinator, sales estimator, customer support, bookkeeper, procurement assistant.

Prototype risks: cleaning and landscaping may need route density over parts; electrician may need permits and safety; facilities maintenance may need asset/site health.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `plumber` | Put emergency jobs and customer ETA updates in the critical strip; parts inventory remains prominent. |
| `electrician` | Add permits, safety/compliance, certifications, and inspection reminders. |
| `facilities-maintenance` | Add site/asset health board and recurring planned maintenance. |
| `cleaning-service` | Emphasize route density, crew assignments, recurring contracts, and supply checklists. |
| `landscaping` | Add weather risk, route planning, seasonal service windows, and equipment readiness. |

### 7.4 Healthcare And Wellness

Representative archetypes: `dental-practice`, `physiotherapy`, `counselling`, `optician`, `veterinary-clinic`

Primary operating question: "Who is coming in today, what is missing before the visit, and what needs follow-up?"

```text
Healthcare and Wellness - Practice Home

Critical strip
[Missing forms 4] [No-show risk 2] [Lab/result wait 3] [Urgent follow-up 1]

Primary zone
+---------------------------+ +---------------------------+
| Today's appointments      | | Provider/room capacity    |
| Patient, time, provider   | | Rooms/chairs/practitioners|
| Visit prep status         | | Gaps and overbooking      |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Care/case follow-ups      | | Billing and claims/admin  |
| Plans, recalls, tasks     | | Payments, invoices, gaps  |
+---------------------------+ +---------------------------+

Briefing zone
[Front desk handoffs] [Patient reminders] [Compliance/licensing alerts] [Coworker notes]
```

Critical content: appointments, patient/customer preparation, room/provider capacity, reminders, compliance/licensing, billing readiness.

Form/tone: careful, privacy-aware, and operational. If PHI/EHR depth is not implemented, the screen must not imply clinical system-of-record ownership.

Layout intent: appointment schedule plus readiness strip. Case-board becomes stronger for multi-visit care.

Primary function: keep the day running while surfacing intake, reminder, and follow-up gaps.

Employee lanes: owner/operator, front desk/admin, practitioner, customer support, bookkeeper, compliance/admin.

Customer portal posture: patient/client portal for booking, intake, reminders, and communication. EHR/clinical record remains external unless implemented.

Finance posture: hybrid. DPF can support service billing and payments; regulated claims/EHR/banking are integration-led.

Integration anchors: QuickBooks, Stripe, Microsoft 365, Google Business Profile, communications, EHR/practice-management systems later.

AI coworker fit: front-desk assistant, scheduler, customer support, bookkeeper, compliance/licensing helper.

Prototype risks: healthcare screens must be explicit about what DPF does not own yet.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `dental-practice` | Add chair/room schedule, hygiene recalls, treatment plan follow-ups, payment estimate gaps. |
| `physiotherapy` | Add care-plan progress, multi-visit packages, exercise-plan follow-ups. |
| `counselling` | Use risk-sensitive tone, protected handoffs, session continuity, and minimal public detail. |
| `optician` | Add lab order status, eyewear/product pickup, retail replenishment. |
| `veterinary-clinic` | Replace patient language with animal/pet owner where appropriate; add species, boarding overlap, vaccination reminders. |

### 7.5 Beauty And Personal Care

Representative archetypes: `hair-salon`, `barber-shop`, `nail-salon`, `beauty-spa`, `personal-trainer`

Primary operating question: "Who is next, who is waiting, and what do we need to deliver today's services?"

```text
Beauty and Personal Care - Booking Home

Critical strip
[Late arrivals 2] [Walk-ins waiting 4] [Supplies low 3] [Rebooking gaps 5]

Primary zone
+---------------------------+ +---------------------------+
| Appointment board         | | Staff/station capacity    |
| Client, service, stylist  | | Chair/room/tech load      |
| Next and late risk        | | Open slots                |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Client follow-ups         | | Products and supplies     |
| Rebooking, reminders      | | Color, tools, retail      |
+---------------------------+ +---------------------------+

Briefing zone
[Front desk handoffs] [Marketing offers] [Payment holds] [Review requests]
```

Critical content: bookings, staff capacity, stations/rooms, client communication, supplies, rebooking, retail add-ons.

Form/tone: warm, concise, client-service oriented.

Layout intent: schedule-first with supply and rebooking support.

Primary function: improve daily service throughput and client follow-up without making staff manage back-office modules.

Employee lanes: owner/operator, front desk, stylist/technician/trainer, marketing, bookkeeper.

Customer portal posture: booking portal with services, packages, intake notes, and rebooking.

Finance posture: Stripe-led for checkout/payments; QuickBooks-led for books; DPF hybrid for bookings, packages, and retail readiness.

Integration anchors: Stripe, QuickBooks, Mailchimp, Google Business Profile, Facebook/Instagram, Microsoft 365/communications.

AI coworker fit: client engagement assistant, scheduler, marketing assistant, inventory assistant, bookkeeper.

Prototype risks: personal training behaves more like one-to-one coaching than a chair/station business.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `hair-salon` | Emphasize stylist/chair schedule, color inventory, rebooking, retail products. |
| `barber-shop` | Shift critical strip toward walk-ins, queue, chair turnover, and memberships/packages. |
| `nail-salon` | Add technician/station supply readiness and service duration balancing. |
| `beauty-spa` | Replace chair capacity with room/equipment capacity; add intake/consent reminders. |
| `personal-trainer` | Emphasize client programs, session packages, progress follow-up, and retention cases. |

### 7.6 Education And Training

Representative archetypes: `tutoring`, `music-school`, `corporate-training`, `driving-school`

Primary operating question: "Which learners or cohorts need attention, and what sessions or outcomes are at risk?"

```text
Education and Training - Learning Operations Home

Critical strip
[Session prep gaps 3] [Learners behind 5] [Instructor conflict 1] [Parent/client reply needed 4]

Primary zone
+---------------------------+ +---------------------------+
| Today's lessons/cohorts   | | Instructor capacity       |
| Learner, instructor, time | | Room/car/coach load       |
| Prep and attendance       | | Conflicts                 |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Progress and outcomes     | | Enrolment pipeline        |
| Milestones, exams, risks  | | Leads, trials, packages   |
+---------------------------+ +---------------------------+

Briefing zone
[Parent/client updates] [Certification approvals] [Payment/package gaps] [Coworker drafts]
```

Critical content: sessions, learners/cohorts, instructors, progress, communication, enrolment, packages.

Form/tone: learner-focused, progress-aware, not school-district heavy unless exact archetype needs it.

Layout intent: schedule plus progress/case board.

Primary function: connect daily sessions to learner/customer outcomes and follow-up work.

Employee lanes: owner/operator, instructor, admin, sales/enrolment, marketing, bookkeeper.

Customer portal posture: academy portal for booking, courses, enrolment, documents, and parent/client communication.

Finance posture: Stripe-led for packages/enrolment payments; QuickBooks-led for accounting; DPF hybrid for sessions and learner progress.

Integration anchors: Stripe, QuickBooks, HubSpot, Mailchimp, Google Business Profile, Microsoft 365.

AI coworker fit: enrolment assistant, scheduler, instructor-support assistant, marketing assistant, bookkeeper.

Prototype risks: driving school needs route/car capacity; corporate training needs cohort/account delivery rather than individual learner focus.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `tutoring` | Emphasize one-to-one sessions, learner progress, parent updates, exam prep. |
| `music-school` | Add instrument/room scheduling, recital/service-period board, lesson packages. |
| `corporate-training` | Emphasize cohorts, employer accounts, certification completion, trainer utilization. |
| `driving-school` | Add car/instructor capacity, road-test readiness, route/location constraints. |

### 7.7 Food And Hospitality

Representative archetypes: `restaurant`, `bakery`, `catering`

Primary operating question: "What service period, prep, order, or guest issue needs attention now?"

```text
Food and Hospitality - Service Period Home

Critical strip
[Prep behind 3] [Reservation issue 2] [Allergen flag 1] [Stock low 4]

Primary zone
+---------------------------+ +---------------------------+
| Service period board      | | Staff/station capacity    |
| Lunch/dinner/event status | | Kitchen/FOH load          |
| Prep, orders, guests      | | Coverage gaps             |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Orders and bookings       | | Stock and purchasing      |
| Reservations, catering    | | Ingredients, vendor gaps  |
+---------------------------+ +---------------------------+

Briefing zone
[Guest replies] [Vendor follow-up] [Shift notes] [Review/social follow-up]
```

Critical content: service periods, reservations/orders, prep, staff, ingredients, allergens, vendor/purchase needs.

Form/tone: fast operational language. The screen should support repeated glance use.

Layout intent: service-period board first, inventory and booking/order support second.

Primary function: keep the current service window and prep work under control.

Employee lanes: owner/operator, manager, kitchen/production, front-of-house, events/catering coordinator, bookkeeper.

Customer portal posture: venue portal for menus, bookings, inquiries, orders, or event requests depending on archetype.

Finance posture: Stripe/POS-led for payments; QuickBooks-led for accounting; DPF hybrid for service operations and purchasing posture.

Integration anchors: Stripe, QuickBooks, Google Business Profile, social channels, reservations/POS later, Microsoft 365.

AI coworker fit: venue manager, booking assistant, procurement helper, marketing assistant, bookkeeper.

Prototype risks: restaurant, bakery, and catering have very different service periods, so exact deltas matter.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `restaurant` | Emphasize reservations, service windows, table/guest issues, allergen flags. |
| `bakery` | Replace reservations with bake schedule, wholesale/retail orders, production batches. |
| `catering` | Emphasize event pipeline, proposal/quote status, delivery logistics, staffing by event. |

### 7.8 Retail And Goods

Representative archetypes: `retail-goods`, `artisan-goods`, `florist`, `wholesale-distribution`

Primary operating question: "What is selling, what is out, and what needs to ship or be approved?"

```text
Retail and Goods - Commerce Operations Home

Critical strip
[Stock-out risk 5] [Orders delayed 3] [Return issue 2] [Trade account request 4]

Primary zone
+---------------------------+ +---------------------------+
| Orders and fulfillment    | | Inventory watch           |
| New, picking, pickup      | | SKU, threshold, vendor    |
| Returns and exceptions    | | Reorder status            |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Customer/account pipeline | | Purchasing and vendors    |
| Leads, trade accounts     | | POs, bills, receipts      |
+---------------------------+ +---------------------------+

Briefing zone
[Manager approvals] [Customer updates] [Supplier follow-up] [Marketing/product recommendations]
```

Critical content: orders, products/SKUs, inventory, fulfillment, returns, customers/accounts, suppliers, purchase orders.

Form/tone: goods and operations language. Avoid service-only terminology.

Layout intent: orders and inventory side by side.

Primary function: connect customer demand, stock, fulfillment, purchasing, and money.

Employee lanes: owner/operator, store manager, fulfillment/ops, procurement/inventory admin, sales/BD, marketing, bookkeeper.

Customer portal posture: storefront for products or trade inquiries, with exact CTA differences for B2C vs B2B.

Finance posture: hybrid. QuickBooks for books, Stripe/POS for payments, DPF for inventory/procurement context until deeper system-of-record gates are met.

Integration anchors: QuickBooks, Stripe, HubSpot, Mailchimp, Google Business Profile, inventory/POS/ecommerce providers later.

AI coworker fit: inventory/procurement assistant, sales assistant, marketing assistant, bookkeeper, customer support.

Prototype risks: wholesale distribution is B2B and inquiry-led; it should not look like a consumer product shop.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `retail-goods` | Default B2C products, orders, pickup/shipping, returns, inventory. |
| `artisan-goods` | Add custom commissions, production queue, workshops, bespoke-order case board. |
| `florist` | Add perishables, delivery routes, event/wedding inquiries, sympathy order sensitivity. |
| `wholesale-distribution` | Replace consumer checkout with trade accounts, case/pallet pricing, stockist/distributor pipeline, credit terms, high-volume quote workflow. |

### 7.9 Fitness And Recreation

Representative archetypes: `gym`, `yoga-studio`, `dance-studio`

Primary operating question: "Who is coming in, what is at capacity, and which members need attention?"

```text
Fitness and Recreation - Member Operations Home

Critical strip
[Class waitlist 3] [Instructor conflict 1] [Retention risk 8] [Payment failed 4]

Primary zone
+---------------------------+ +---------------------------+
| Today's classes/sessions  | | Capacity and coverage     |
| Class, instructor, room   | | Room, instructor, limit   |
| Attendance and waitlist   | | Peak load                 |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Member cases              | | Membership and payments   |
| Retention, goals, outreach| | Packages, failed payments |
+---------------------------+ +---------------------------+

Briefing zone
[Front desk handoffs] [Trainer notes] [Campaign suggestions] [Renewal reminders]
```

Critical content: classes/sessions, instructors, rooms, member capacity, waitlists, retention, memberships/payments.

Form/tone: member-first and energetic, without marketing-page bloat.

Layout intent: class schedule plus retention/member cases.

Primary function: keep daily programming, capacity, and member engagement healthy.

Employee lanes: owner/operator, front desk, instructor/trainer, marketing, bookkeeper.

Customer portal posture: member portal for classes, memberships, passes, bookings, and renewals.

Finance posture: Stripe-led for memberships/packages; QuickBooks for accounting; DPF hybrid for member operations.

Integration anchors: Stripe, QuickBooks, Mailchimp, Google Business Profile, social channels, Microsoft 365.

AI coworker fit: member engagement assistant, scheduler, marketing assistant, bookkeeper.

Prototype risks: dance studios need event/recital cycles; gyms need membership churn; yoga studios need class waitlists and package sales.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `gym` | Emphasize membership churn, capacity peaks, trainer sessions, failed payments. |
| `yoga-studio` | Emphasize class waitlists, instructor schedule, class packs, retreats/workshops. |
| `dance-studio` | Add recital/service-period board, class levels, rehearsals, family billing. |

### 7.10 Nonprofit And Community

Representative archetypes: `charity`, `community-shelter`, `animal-shelter`, `pet-rescue`, `sports-club`

Primary operating question: "Which programs, people, donors, or volunteers need attention today?"

```text
Nonprofit and Community - Program Home

Critical strip
[Urgent cases 3] [Volunteer gap 5] [Donation follow-up 7] [Program capacity risk 2]

Primary zone
+---------------------------+ +---------------------------+
| Program/case board        | | Volunteer and staff cover |
| People, cases, programs   | | Shifts, roles, gaps       |
| Urgency and next action   | | Training/compliance       |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Donor/supporter pipeline  | | Campaigns and outreach    |
| Gifts, pledges, thanks    | | Appeals, events, sponsors |
+---------------------------+ +---------------------------+

Briefing zone
[Volunteer handoffs] [Donor replies] [Grant/admin tasks] [Safeguarding/compliance gaps]
```

Critical content: programs, cases/clients, volunteers, donations, campaigns, outreach, compliance.

Form/tone: mission-aware and respectful. Avoid sales-heavy wording for vulnerable populations.

Layout intent: program/case board plus volunteer coverage.

Primary function: coordinate mission delivery, supporter engagement, and staffing gaps.

Employee lanes: owner/operator/executive director, program manager, volunteer coordinator, fundraiser/marketing, admin/bookkeeper, support.

Customer portal posture: supporter hub for donations, volunteer sign-up, events, and inquiries; animal-focused variants need adoption/sponsor language.

Finance posture: hybrid. QuickBooks/accounting for books, Stripe/donation payments, DPF for program/donor/volunteer operations.

Integration anchors: Stripe, QuickBooks, Mailchimp, Google Business Profile, Microsoft 365, social channels, donor/grant systems later.

AI coworker fit: community manager, volunteer coordinator, donor/fundraising assistant, case support assistant, bookkeeper.

Prototype risks: sports club is membership/purchase-heavy; animal rescue shares patterns with pet services.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `charity` | Emphasize donor pipeline, appeals, campaigns, gift acknowledgements, corporate giving. |
| `community-shelter` | Emphasize urgent cases, bed/program capacity, volunteer gaps, supply donations. |
| `animal-shelter` | Emphasize animals, foster/adoption, shelter capacity, supplies, volunteer shifts. |
| `pet-rescue` | Emphasize rescue cases, foster homes, adoption pipeline, animal-care handoffs. |
| `sports-club` | Emphasize memberships, fixtures/events, family billing, volunteer coaches, ticketing. |

### 7.11 Pet Services

Representative archetypes: `pet-grooming`, `pet-boarding`, `dog-walking`

Primary operating question: "Which animals are coming in or out today, and who needs care or owner updates?"

```text
Pet Services - Animal Care Home

Critical strip
[Owner update needed 4] [Care note missing 2] [Capacity full 1] [Route conflict 3]

Primary zone
+---------------------------+ +---------------------------+
| Animal schedule           | | Staff/capacity lanes      |
| Pet, owner, service, time | | Groomer/carer/walker load |
| Prep, pickup, care notes  | | Room/kennel/route limits  |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Care/case notes           | | Supplies and payments     |
| Preferences, meds, risks  | | Food, products, invoices  |
+---------------------------+ +---------------------------+

Briefing zone
[Owner messages] [Care handoffs] [Rebooking reminders] [Incident/compliance notes]
```

Critical content: animals, owners, bookings, care notes, capacity, staff, owner communications, supplies.

Form/tone: pet-owner friendly, operational, and trust-building.

Layout intent: animal schedule first, capacity and care notes close beside it.

Primary function: coordinate appointments, care capacity, and owner communication.

Employee lanes: owner/operator, groomer/carer/walker, front desk, customer support, bookkeeper.

Customer portal posture: booking portal for pet owners, with pet profile/intake details.

Finance posture: Stripe-led for appointment/package payments; QuickBooks for books; DPF hybrid for scheduling/care operations.

Integration anchors: Stripe, QuickBooks, Google Business Profile, Mailchimp, communications/SMS, Microsoft 365.

AI coworker fit: booking assistant, care coordinator, customer support, marketing assistant, bookkeeper.

Prototype risks: dog walking needs route-map prominence; pet boarding needs occupancy/care capacity over appointment slots.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `pet-grooming` | Emphasize grooming appointments, pet prep notes, owner pickup, rebooking. |
| `pet-boarding` | Emphasize occupancy, kennel/room capacity, care schedule, feeding/medication notes. |
| `dog-walking` | Emphasize routes, walker capacity, owner updates, recurring schedule. |

### 7.12 HOA And Property Management

Representative archetypes: `property-management-company`, `homeowners-association`, `condo-association`

Primary operating question: "What resident, owner, board, vendor, or property issue needs action today?"

```text
HOA and Property Management - Community Operations Home

Critical strip
[Urgent requests 4] [Board approvals 3] [Vendor overdue 2] [Owner notice failed 1]

Primary zone
+---------------------------+ +---------------------------+
| Requests and cases        | | Properties and vendors    |
| Owner/resident, issue     | | Unit/site, vendor status  |
| Violation/maintenance     | | Work order progress       |
+---------------------------+ +---------------------------+

Secondary zone
+---------------------------+ +---------------------------+
| Board and compliance      | | Money and assessments     |
| Approvals, meetings, docs | | Dues, invoices, arrears   |
+---------------------------+ +---------------------------+

Briefing zone
[Board handoffs] [Vendor follow-up] [Owner communications] [Compliance/licensing gaps]
```

Critical content: owner/resident requests, violations, vendors, board approvals, properties/units, notices, dues/assessments.

Form/tone: calm, accountable, community-service oriented.

Layout intent: case/request board plus vendor/property status.

Primary function: coordinate community requests, vendors, board work, and money.

Employee lanes: owner/operator/property manager, board/admin, vendor coordinator, bookkeeper, customer/resident support.

Customer portal posture: community portal for requests, documents, notices, assessments, and owner/resident communication.

Finance posture: QuickBooks/accounting-led for books; DPF hybrid for requests, vendors, notices, board tasks, and assessment readiness.

Integration anchors: QuickBooks, Stripe/payment portal, Microsoft 365, communications, Google Business Profile where relevant, property-management systems later.

AI coworker fit: community manager, vendor coordinator, support assistant, bookkeeper, compliance helper.

Prototype risks: property-management-company is tenant/lease/vendor heavy; HOA/condo are board/owner/community heavy.

Exact archetype deltas:

| Archetype | Delta |
| --- | --- |
| `property-management-company` | Add leases, tenants, rent/arrears, move-in/out, vendor work orders. |
| `homeowners-association` | Emphasize homeowners, violations, dues, board approvals, community notices. |
| `condo-association` | Emphasize unit-level issues, common-area maintenance, board packets, owner communications. |

## 8. All-Archetype Coverage And Exact-Screen Decisions

Decision values:

- `exact now`: needs its own prototype before implementation critique is complete.
- `delta only`: category prototype is acceptable if the listed delta is reviewed.
- `category fallback ok`: category prototype is enough for the first build slice.

| Category | Archetype | CTA | Decision | Reason |
| --- | --- | --- | --- | --- |
| `software-platform` | `software-platform` | inquiry | exact now | Platform operator mode is unique and must not leak to SMB worker homes. |
| `professional-services` | `it-managed-services` | inquiry | exact now | MSP estate health, SLAs, security posture, and recurring agreements diverge from generic client work. |
| `professional-services` | `accounting` | inquiry | delta only | Client deadline and QuickBooks/accountant focus can start from professional-services case board. |
| `professional-services` | `consulting` | inquiry | category fallback ok | Engagement/deliverable work fits category board initially. |
| `professional-services` | `legal-services` | inquiry | delta only | Matter/deadline/retainer language needs review but layout can reuse category board. |
| `professional-services` | `marketing-agency` | inquiry | delta only | Campaign approvals and client reporting need stronger copy, but layout can reuse project work. |
| `trades-maintenance` | `cleaning-service` | inquiry | delta only | Route density and recurring contracts differ; category dispatch still works. |
| `trades-maintenance` | `electrician` | inquiry | delta only | Permits, safety, and certification rows need review. |
| `trades-maintenance` | `facilities-maintenance` | inquiry | delta only | Asset/site health should be stronger than generic trades. |
| `trades-maintenance` | `landscaping` | inquiry | delta only | Weather and seasonal service windows need review. |
| `trades-maintenance` | `plumber` | inquiry | category fallback ok | Emergency jobs and parts fit category dispatch board. |
| `healthcare-wellness` | `counselling` | booking | exact now | Risk-sensitive tone, privacy, and session continuity require separate review. |
| `healthcare-wellness` | `dental-practice` | booking | category fallback ok | Appointment/provider/room board fits first slice. |
| `healthcare-wellness` | `optician` | booking | delta only | Retail/lab-status hybrid needs reviewed delta. |
| `healthcare-wellness` | `physiotherapy` | booking | delta only | Multi-visit progress cases need reviewed delta. |
| `healthcare-wellness` | `veterinary-clinic` | booking | exact now | Animal/pet-owner language and boarding/medical overlap diverge enough for exact review. |
| `beauty-personal-care` | `barber-shop` | booking | delta only | Walk-in queue can be a reviewed delta. |
| `beauty-personal-care` | `beauty-spa` | booking | delta only | Room/equipment and intake requirements need reviewed delta. |
| `beauty-personal-care` | `hair-salon` | booking | category fallback ok | Chair/stylist schedule fits category prototype. |
| `beauty-personal-care` | `nail-salon` | booking | category fallback ok | Technician/station capacity fits category prototype. |
| `beauty-personal-care` | `personal-trainer` | booking | exact now | One-to-one programs and retention/case work differ from salon chair/station model. |
| `education-training` | `corporate-training` | inquiry | exact now | Employer accounts, cohorts, certifications, and trainer utilization diverge from tutoring. |
| `education-training` | `driving-school` | purchase | exact now | Car/instructor/road-test routing and purchase+booking mix need exact review. |
| `education-training` | `music-school` | booking | delta only | Recital/event cycle needs reviewed delta. |
| `education-training` | `tutoring` | booking | category fallback ok | Learner/session/progress board fits category prototype. |
| `food-hospitality` | `bakery` | purchase | delta only | Production/bake schedule needs reviewed delta. |
| `food-hospitality` | `catering` | inquiry | exact now | Event pipeline, quoting, delivery, and staffing diverge from restaurant service period. |
| `food-hospitality` | `restaurant` | booking | category fallback ok | Service period and reservation board fits category prototype. |
| `retail-goods` | `artisan-goods` | purchase | delta only | Bespoke commissions and production queue need reviewed delta. |
| `retail-goods` | `florist` | purchase | delta only | Perishables, delivery, and event/sympathy sensitivity need reviewed delta. |
| `retail-goods` | `retail-goods` | purchase | category fallback ok | Orders/inventory/fulfillment board fits category prototype. |
| `retail-goods` | `wholesale-distribution` | inquiry | exact now | B2B trade accounts, pallet/case pricing, credit terms, and distributor pipeline diverge from retail. |
| `fitness-recreation` | `dance-studio` | purchase | delta only | Recital/service-period cycle needs reviewed delta. |
| `fitness-recreation` | `gym` | purchase | category fallback ok | Classes/memberships/retention board fits category prototype. |
| `fitness-recreation` | `yoga-studio` | purchase | category fallback ok | Class waitlist and packages fit category prototype. |
| `nonprofit-community` | `animal-shelter` | donation | exact now | Animal-care, adoption/foster, and shelter capacity diverge from general nonprofit. |
| `nonprofit-community` | `charity` | donation | category fallback ok | Donations/programs/volunteers fit category prototype. |
| `nonprofit-community` | `community-shelter` | donation | delta only | Urgent service and vulnerable-client tone need reviewed delta. |
| `nonprofit-community` | `pet-rescue` | donation | exact now | Rescue/foster/adoption overlaps pet care and needs exact review. |
| `nonprofit-community` | `sports-club` | purchase | exact now | Membership/ticketing/fixture model diverges from donation-led nonprofit. |
| `pet-services` | `dog-walking` | booking | exact now | Route map and recurring walker capacity need exact layout. |
| `pet-services` | `pet-boarding` | booking | exact now | Occupancy, care schedule, feeding/medication notes need exact layout. |
| `pet-services` | `pet-grooming` | booking | category fallback ok | Booking/care-note board fits category prototype. |
| `hoa-property-management` | `condo-association` | inquiry | delta only | Unit/common-area focus needs reviewed delta. |
| `hoa-property-management` | `homeowners-association` | inquiry | category fallback ok | Requests/violations/board approvals fit category prototype. |
| `hoa-property-management` | `property-management-company` | inquiry | exact now | Leases, tenants, rent, move-in/out, and vendor work orders diverge from HOA board model. |

Exact-now backlog follow-up group:

```text
software-platform
it-managed-services
wholesale-distribution
counselling
veterinary-clinic
catering
dog-walking
pet-boarding
property-management-company
corporate-training
driving-school
personal-trainer
sports-club
animal-shelter
pet-rescue
```

### 8.1 Current Catalog Expansion Ledger (2026-07-18)

The §8 table above is retained as the historical exact-screen decision record for the original prototype set. Current source has expanded to 95 archetypes across 21 category files, so reviewers must also cover the categories below. These rows are category-level verification requirements, not full text mockups; when a sentinel fails, create or update the exact prototype/backlog item instead of silently broadening the old category fallback.

| Category | Source count | Sentinel archetype(s) | Workspace profile to verify | Extra review focus |
| --- | ---: | --- | --- | --- |
| `asset-rental` | 3 | `equipment-rental`, `self-storage` | `home-property-governance` | Reservation-and-return, fleet/unit occupancy, rental agreements, deposit/recurring billing, and return/inspection lifecycle. |
| `automotive-services` | 6 | `mobile-mechanic`, `roadside-assistance` | `home-field-mobility` | Route/vehicle/customer-site urgency, technician capacity, mobile customer communication, and field dispatch. |
| `banking-financial-services` | 3 | `community-bank`, `credit-union` | `home-banking-financial-services` | Engagement layer only: applications, member/customer follow-up, disclosures, loan calculator, BIAN vocabulary, and no implied core banking/KYC/payment-rail execution. |
| `live-events-venues` | 3 | `event-venue`, `tour-promoter` | `home-live-events-venues` | Show-day schedule, on-sale moments, guest communication, ticketing/capacity posture, and staff/production handoffs. |
| `media-production` | 3 | `film-video-production`, `post-production-studio` | `home-media-production` | Shoots, sessions, deliverables, client approvals, crew/vendor handoffs, and production-equipment rental adjacency. |
| `moving-and-logistics` | 4 | `moving-company`, `courier-delivery` | `home-field-mobility` | Routes, crew/vehicle capacity, pickup/drop-off commitments, customer ETA updates, and logistics exceptions. |
| `public-sector` | 3 | `small-town-municipality`, `municipal-utility`, `law-enforcement-agency` | `home-civic-public-sector` | Resident/ratepayer language, statutory fees, public records/permits, no-CJI law-enforcement boundary, and public-body governance. |
| `real-estate-construction` | 2 | `new-home-builder`, `custom-home-builder` | `home-property-governance` | Project/property pipeline, site/vendor work, buyer/client communication, draws/change orders, and construction-stage visibility. |
| `security-services` | 2 | `guard-patrol`, `alarm-cctv-install` | `home-field-mobility` | Patrol/install scheduling, incident-sensitive wording, customer site coverage, and compliance/security posture without overclaiming surveillance operations. |

The current catalog also added leaves inside original categories, including `medical-practice`, `mobile-beauty`, `mobile-pet-grooming`, `mobile-vet`, `cooperative`, `agricultural-cooperative`, `waste-management`, `fractional-cxo`, and HVAC/roofing/painting/pest/waste/solar trades. These should be tested as exact deltas when their category sentinel finds a material mismatch in vocabulary, CTA, scheduling pattern, finance posture, or workspace-home contribution.

### 8.2 Current Runtime Feature Verification Targets

Every category sentinel in the acceptance plan must explicitly verify these now-shipped archetype-oriented features:

| Feature | Source surface | What review must prove |
| --- | --- | --- |
| Source catalog integrity | `packages/storefront-templates/src/archetypes/*` | Archetype id, category, CTA, items, sections, vocabulary, scheduling defaults, and activation profile are coherent and seedable. |
| Setup activation summary | `ArchetypeActivationSummary` and `/storefront/setup` | Required/recommended capability counts, billing/payment pattern, isolation posture, worker-home label, operating question, top concerns, and primitive widgets are understandable before save. |
| Workspace resolution | `resolveWorkspaceHomeContribution()` and `/workspace` | Exact beats category; category beats unconfigured; fallback is honest. |
| Operational twin | `WorkspaceTwinHero` | The twin is archetype-relevant, visually dominant only when meaningful, and does not hide the real workspace body or cockpit. |
| Single attention surface | `OperatorCockpit` | One "what needs you now" count/ranking; no contradictory static queues from vertical banners or command-center posture. |
| Vertical identity banner | `VerticalWorkspaceHome` | Names the archetype workspace, explains what it watches, and defers live decisions to the cockpit. |
| Customer CTA routing | public `/s/[slug]/*` and `/storefront/inbox` | Booking, inquiry, purchase/order, donation, rental/reservation, application, report/request, and contact flows create or surface the correct management record. |
| Finance posture | `/finance` and `/finance/settings/setup` | Native, integration-led, hybrid, prepared-not-prescribed, or not-applicable posture is explicit for the category. |
| Integration posture | `/platform/tools/integrations` and capability views | QuickBooks, Stripe, HubSpot/CRM, ADP/payroll, Microsoft 365, Mailchimp, Google Business Profile, social/communications, and vertical systems appear only where relevant. |
| Capability and backlog capture | capability views, `/admin/backlog`, product backlog routes | Missing archetype work can be captured with archetype, category, employee role, capability, surface, integration anchor, and posture. |

## 9. Backlog Mapping

This spec should not create a new replacement epic. It maps to existing work:

| Work area | Existing owner |
| --- | --- |
| Workspace-home resolver, primitive registry, contribution sequencing | `EP-REDUCTION-GEAR-ARCH` |
| Archetype-driven setup activation orchestrator | `BI-B14D6CF6` |
| Worker-mode shell/chrome switch | `BI-8D9CA348` |
| Business capability and employee-work taxonomy | `EP-BIZ-CAP` |
| Integration/provider parity and benchmarks | `EP-INT-2E7C1A` |
| Archetype model/setup unification | `EP-ARCH-8D4F2A` |
| QuickBooks parity | `EP-INT-2E7C1A` |

Known category or exact workspace-home backlog anchors:

| Prototype category | Backlog anchor |
| --- | --- |
| Software Platform | `BI-02845133` plus platform/operator shell work |
| Professional Services | `BI-FA3294E0` for non-MSP, `BI-FE002675` for MSP |
| Trades And Maintenance | `BI-1F7731E5` for non-HVAC trades, `BI-CE6AF925` for HVAC proving install |
| Healthcare And Wellness | `BI-FE74CD4A` |
| Beauty And Personal Care | `BI-25AFC2BC` |
| Education And Training | `BI-CB8EE2D0` |
| Food And Hospitality | `BI-336FC845` |
| Retail And Goods | `BI-ED0153CA` |
| Fitness And Recreation | `BI-204CE2D6` |
| Nonprofit And Community | `BI-EF03E915` |
| Pet Services | `BI-43A682A2` |
| HOA And Property Management | `BI-96A3C7A9` |
| Asset Rental | reuse property-governance and rental-fleet backlog anchors; create exact items when rental lifecycle UX is missing |
| Automotive / Logistics / Security field mobility | reuse field-mobility workspace anchors; create exact items when routing, vehicle, patrol, or dispatch semantics are wrong |
| Banking / Financial Services | banking archetype and regulated-boundary backlog anchors; create exact items for BIAN/disclosure/core-banking boundary gaps |
| Public Sector | civic/public-sector backlog anchors; create exact items for resident/ratepayer/no-CJI/statutory-fee gaps |
| Media Production / Live Events | production/show-day workspace anchors; create exact items for shoot, approval, ticketing, capacity, or venue gaps |

Likely backlog items to create or update after review:

1. Archetype prototype review: critique category-level worker-home mockups for critical content, form, layout, and function.
2. Main portal setup preview: show worker home, customer portal, finance, integrations, team/coworker impact before archetype commit.
3. Workspace-home contribution manifests: category-level contributions for every current category that lacks a trustworthy runtime contribution or honest fallback.
4. Exact archetype prototypes: MSP, wholesale distribution, counselling, veterinary clinic, catering, dog walking, property management, software platform operator, banking/credit-union, municipal utility, equipment rental/self-storage, field-mobility, media production, and live-events sentinels.
5. Business capability UX: expose commercial market/product references inside capability review and setup preview.

## 10. Review Prompt For Another Agent

Use this prompt to critique the spec:

```text
Review docs/superpowers/specs/2026-06-06-archetype-portal-screen-prototypes-design.md.

Do not implement code.

Critique the prototype set for:
1. Critical content: does each first viewport include the facts a real employee needs?
2. Form and tone: does the language fit the archetype and avoid platform jargon?
3. Layout: does the hierarchy make sense across critical strip, primary zone, secondary zone, briefing zone, and setup/integration rail?
4. Function: are the actions tied to current DPF surfaces, canonical records, or clearly named integration anchors?
5. Coverage: do all 95 current source archetypes across 21 category files have enough category-sentinel or exact-prototype coverage, and which need exact screens rather than category fallback?
6. Architecture: does the proposal fit StorefrontConfig -> StorefrontArchetype, workspace-home contributions, operational twin, capability taxonomy, and integration posture?
7. Boundary posture: do regulated or integration-led archetypes avoid implying DPF owns core banking, clinical, public-safety/CJIS, payment-rail, payroll, POS, or other vertical execution before the platform has that governed substrate?

Return findings ordered by severity with file/section references. Prefer concrete changes to vague opinions.
```

## 11. Acceptance Criteria

The prototype spec is acceptable when:

- Every current archetype is mapped to a category prototype and exact delta.
- The current 95/21 source catalog is reconciled against this spec and the acceptance plan before a reviewer signs off coverage.
- The main portal screen configuration path is explicitly mapped to setup, public portal, finance, capabilities, integrations, and worker-home contribution mechanics.
- The current `/workspace` composition is explicitly covered: `WorkspaceTwinHero`, `OperatorCockpit`, `VerticalWorkspaceHome`, `PlatformWorkspaceHome`, exact/category contribution resolution, and honest fallback behavior.
- Reviewers can evaluate critical content, form, layout, and function without running the portal.
- The spec does not imply that DPF owns regulated finance, payroll, clinical, banking, or payment execution before integration-led maturity gates are met.
- Category prototypes are small enough to become backlog slices rather than a giant replacement project.
- Commercial market/product references are called out as required UX context, not buried only in spreadsheet-derived seed data.
