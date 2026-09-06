# Archetype Acceptance Test Plan

> **For agentic workers:** REQUIRED: Use `superpowers:executing-plans` when running this plan end-to-end. This plan is a product-behavior walkthrough, not a build-system verification plan. Use the already-available sandbox/main build selected by the operator; do not turn failed access into a self-upgrade or deployment investigation unless the task is explicitly rescoped.

> **Tied to the portal-redesign effort (2026-06-06).** This plan is the founder's clean-install acceptance vehicle for the main-portal redesign. Its **§3 "Employee Work View"** is the direct acceptance test for the [Main Portal Workspace Home Redesign](../specs/2026-06-06-main-portal-workspace-home-redesign-design.md) and the [Archetype Portal Screen Prototypes](../specs/2026-06-06-archetype-portal-screen-prototypes-design.md): §3's fail condition ("worker-facing UX still reads like platform operator tooling") is exactly the default-home defect the redesign removes. All three docs ship together on the same branch / PR under `EP-REDUCTION-GEAR-ARCH` so the test plan is not lost from the design it validates.

**Goal:** Confirm that selecting a business archetype produces a coherent DPF experience across setup, business capabilities, employee work, customer/storefront flows, finance, integrations, AI coworkers, and portfolio/product/backlog surfaces.

**Architecture:** Exercise a source-reconciled representative archetype coverage set rather than every vertical exhaustively. Each walkthrough follows the same surface checklist so repeated failures become cross-cutting backlog items instead of many duplicate vertical bugs. The current catalog is large enough that "representative" now means: cover every archetype category at least once, then deepen exact-archetype testing only where the category fallback can hide materially different work.

**Tech Stack:** DPF portal, `StorefrontConfig -> StorefrontArchetype`, business capability perspectives, workspace home resolver, storefront templates, finance setup, integration catalog, AI coworker registry, live backlog.

---

## Scope

This plan answers: "Does the archetype-driven experience work well enough across the main different parts?"

It intentionally separates product UX confidence from build/deploy validation. If the app is already available, test the product. If the app cannot be reached or the selected install is stale, record that as an environment blocker and stop the walkthrough; do not spend this test pass debugging the build pipeline.

## Baseline To Reconcile

Before execution, reconcile the source catalog, seed projection, and live install inventory with this baseline:

- Source catalog observed on 2026-07-18: 95 storefront archetypes across 21 category files in `packages/storefront-templates/src/archetypes`.
- The old 2026-06-06 baseline of 46 archetypes across 12 categories is stale. Do not use it to judge coverage completeness.
- Business capability seed observed on 2026-06-06: 28 active generic capability rows, with archetype-specific behavior layered through activation profiles, perspectives, portfolios, and provenance. Re-query live state before execution; this number is a historical baseline only.
- Workspace-home substrate now includes default contribution profiles in `apps/web/lib/workspace-home/profiles.ts`, including exact or category coverage for medical/dental care, trades, professional services, media production, live events, retail, food, healthcare, appointment services, MSP, fractional CXO, software platform, nonprofit, property/asset rental/construction, public sector, banking/financial services, field mobility, and waste-management-style operations.
- Main `/workspace` now routes through `WorkspaceTwinHero`, `OperatorCockpit`, `VerticalWorkspaceHome`, and `PlatformWorkspaceHome` depending on available archetype/twin/contribution state. The walkthrough must verify this composed first viewport, not only the older `PlatformWorkspaceHome` fallback.

If source, seed, and live counts differ, record all three counts in the evidence notes before judging coverage.

## Representative Coverage Set

Run this first batch before trying to cover every archetype. The batch is split into mandatory core coverage and expansion sentinels for categories added after the original 46-archetype baseline.

| Archetype | Category | Tier | Why It Is In The Batch |
| --- | --- | --- | --- |
| `software-platform` | `software-platform` | Core | Platform/operator behavior, portfolio/product surfaces, AI coworker coordination, and intentional platform posture. |
| `it-managed-services` | `professional-services` | Core | Rich professional-services setup, service delivery, customer support, security/compliance, Microsoft 365-style integration anchors, and exact MSP workspace-home resolution. |
| `hair-salon` or `beauty-spa` | `beauty-personal-care` | Core | Appointment/service business, employee scheduling, customer intake, local marketing. |
| `wholesale-distribution` | `retail-goods` | Core | Goods, B2B customers, inventory/procurement, trade accounts, and the archetype that exposed roster drift. |
| `plumber` or `electrician` | `trades-maintenance` | Core | Field-service workflow, dispatch-style work, estimates, jobs, customer requests. |
| `restaurant` | `food-hospitality` | Core | Food/hospitality vocabulary, menu/offer structure, customer-facing portal language. |
| `dental-practice` or `medical-practice` | `healthcare-wellness` | Core | Healthcare-style service delivery, intake, compliance posture, patient/customer wording, and exact medical/dental home resolution. |
| `property-management-company` | `hoa-property-management` | Core | Owners/tenants, requests, property obligations, recurring work. |
| `charity` or `animal-shelter` | `nonprofit-community` | Core | Donation, volunteer, community-service, animal-care, and support vocabulary. |
| `tutoring` | `education-training` | Core | Sessions, scheduling, students/customers, learning-service workflow. |
| `gym` or `yoga-studio` | `fitness-recreation` | Core | Membership/service hybrid and recurring customer engagement. |
| `pet-grooming` or `pet-boarding` | `pet-services` | Core | Appointment plus pet/asset-style customer-subject workflows. |
| `community-bank` or `credit-union` | `banking-financial-services` | Expansion | Regulated engagement-layer services, member/customer vocabulary, disclosures, calculator/disclosure sections, and fail-closed non-core-banking posture. |
| `small-town-municipality` or `municipal-utility` | `public-sector` | Expansion | Resident/ratepayer services, statutory-fee posture, public-body vocabulary, and civic service requests. |
| `equipment-rental` or `self-storage` | `asset-rental` | Expansion | Reservation-and-return lifecycle, fleet/unit occupancy, rental agreements, and usage/subscription finance. |
| `new-home-builder` or `custom-home-builder` | `real-estate-construction` | Expansion | Project/property pipeline, buyer/client handoffs, vendor/site work, and property-governance workspace fallback. |
| `mobile-mechanic` or `roadside-assistance` | `automotive-services` | Expansion | Mobile field operations, vehicle/customer site routing, urgent dispatch, and field-mobility workspace fallback. |
| `moving-company` or `courier-delivery` | `moving-and-logistics` | Expansion | Route/capacity, crews/vehicles, fulfillment and customer communication exceptions. |
| `guard-patrol` or `alarm-cctv-install` | `security-services` | Expansion | Patrol/install field workflow, compliance-sensitive customer promises, and field-mobility fallback. |
| `film-video-production` or `post-production-studio` | `media-production` | Expansion | Production pipeline, shoot/session/deliverable approvals, client handoffs, and media workspace contribution. |
| `event-venue` or `tour-promoter` | `live-events-venues` | Expansion | Show-day operations, booking/ticketing/on-sale moments, capacity and guest communication. |

This set covers all 21 current category files while still avoiding a 95-archetype exhaustive pass.

## Per-Archetype Walkthrough

**2026-09-06 research increment (BI-4CCE50E0):** select Restaurant plus Pet Rescue
as the first complementary rehearsal pair for the
[Astra applicability review](../research/2026-09-06-astra-business-verification-review.md).
This pair proves only its exercised scope; the representative matrix below remains
the broader coverage plan. Use the [operating-model audit](../../architecture/archetype-operating-model-audit.md)
for normal/bad/periodic days and its outcome-evidence contract for each step. Preserve
coverage and operability as separate measures; cosmetic completion cannot substitute
for a day that workers can actually perform.

Before scoring, specify expected state independently of the output. For the public
CTA, prove the correct operational record and role handoff, then reload and inspect
the result. Include a duplicate submission, failed/late response, unavailable
resource, private fact and a missing policy source. Use disposable fixtures in the
governed nonproduction environment; keep external sends/payments in test sinks.
Record first-pass failures and all inconclusive/unrun steps with denominators.
These are planned checks; this documentation pass records no product test results.

Use the same sequence for each archetype.

### 1. Setup Selection

- Select the archetype in setup or reset the configured archetype through the available admin path.
- Confirm the selected archetype persists after saving, navigating away, and returning.
- Confirm `StorefrontConfig` is the source of truth for the selected archetype, not a stale `Organization.industry` or generic business context field.
- Confirm business context language, setup summary, and next steps reflect the selected business type.
- Fail if setup reverts, persists the wrong archetype, or claims a tailored experience where only a generic fallback is available.

### 2. Business Capabilities

- Open the business capability/taxonomy surface, currently surfaced through portfolio architecture and related capability views.
- Confirm the capability page is not empty.
- Confirm the capability tree covers day-to-day work: setup, finance, revenue/customer growth, customer operations/support, people/admin, work communications, compliance/risk, portfolio/product, and inventory/procurement/assets where relevant.
- Confirm commercial market/product references from the spreadsheet/taxonomy seed are visible or traceable in UX where they matter, especially for integrations and buy-vs-build posture.
- Confirm the capability perspective/provenance reflects the selected archetype or clearly reports that only the generic baseline is active.
- Fail if capabilities are blank, only technical, disconnected from the selected business model, or hide the market/product context needed for integration planning.

### 3. Employee Work View

- Open the main workspace and any role/work queue views.
- Record the resolved workspace-home mode: unconfigured fallback, category contribution, exact contribution, or operational twin.
- Confirm the `OperatorCockpit` is the single "what needs you now" surface; no second panel should contradict its count or attention ranking.
- When `WorkspaceTwinHero` renders, confirm the twin is archetype-relevant and the cockpit is folded into it without hiding the platform/body fallback.
- When `VerticalWorkspaceHome` renders, confirm it is an identity/context banner over the shared workspace body, not a second static action queue.
- Confirm the workspace reflects the employees who would actually use the business: owner/operator, bookkeeper/accountant, sales/business development, marketing, operations/service delivery, customer support, HR/payroll/admin, inventory/procurement, and IT/security/compliance where relevant.
- Confirm the first screen gives useful work cues for that archetype rather than platform administration noise.
- Confirm missing vertical workspace-home contributions are honest fallbacks, not misleading tailored promises.
- Fail if worker-facing UX still reads like platform operator tooling for ordinary business employees, if the twin is visually dominant but semantically generic, or if multiple attention surfaces disagree.

### 4. Customer / Storefront / Portal

- Open the internal storefront management surface and the public customer/storefront surface.
- Confirm labels, calls to action, sections, item templates, and forms match the archetype.
- Exercise the natural customer action for the archetype: book, inquire, order, donate, request service, register, reserve/rent, apply, report, or contact.
- Confirm resulting inbox/order/booking/donation records appear in the management surface where applicable.
- For `rental` CTAs, confirm the current flow is an honest reserve/request inquiry unless a dedicated rental transaction substrate is present.
- For regulated or civic archetypes, confirm disclaimers, statutory wording, eligibility gates, or no-CJI/no-core-banking posture appear where the source archetype declares them.
- Fail if the CTA type is wrong, customer copy is generic in a confusing way, the action does not route back into the business workspace, or the portal implies DPF executes regulated work that should stay integration-led.

### 5. Finance

- Open finance setup and finance work surfaces.
- Confirm finance posture fits the archetype:
  - invoices and customers for service businesses
  - bills, vendors, and expenses for operators
  - purchasing, stock, and assets for goods businesses
  - donations or grants for nonprofits where relevant
  - rental deposits, recurring unit billing, and asset lifecycle for rental businesses
  - statutory fees, levies, utility billing, or prepared-not-prescribed posture for civic/public bodies
  - application/fee posture for banking and financial services without implying core banking, KYC/AML, or payment-rail execution
  - reporting, close, and reconciliation posture for QuickBooks parity
- Confirm QuickBooks and Stripe are presented as integration anchors where appropriate.
- Confirm the posture is clear: native DPF, integration-led, hybrid, eventual replacement, or not applicable yet.
- Fail if finance setup is missing, misleading, or treats materially different business models as identical.

### 6. Integrations

- Check whether relevant integration anchors appear for the archetype:
  - QuickBooks
  - Stripe
  - HubSpot or CRM
  - ADP/payroll
  - Microsoft 365 or communications
  - Mailchimp
  - Google Business Profile
  - social and communications channels
  - vertical systems where DPF should stay integration-led, such as core banking, EHR/practice systems, POS, property-management systems, RMS/CJIS-adjacent systems, ticketing, route/dispatch, or rental/fleet systems
- Confirm each visible integration has an understandable role in the business workflow.
- Confirm missing integrations are framed as gaps or future work rather than silent omissions.
- Fail if expected integrations are absent from the taxonomy/UX for an archetype where they are central to the business.

### 7. AI Coworkers

- Confirm relevant coworkers are suggested or implied by the work:
  - bookkeeper/accountant
  - sales assistant
  - marketing assistant
  - service coordinator
  - customer support
  - setup/business analyst
  - compliance/security helper
  - procurement/inventory helper where relevant
- Confirm coworker handoffs map to real employee jobs instead of generic agent chatter.
- Note missing coworkers as backlog candidates.
- Fail if coworker support is generic and disconnected from the selected business model.

### 8. Portfolio / Product / Backlog Surface

- Confirm portfolio/product language works for `software-platform`.
- Confirm non-software archetypes are framed around business capabilities and employee work, not forced into software product-management vocabulary.
- Confirm backlog item naming and body templates can carry archetype, employee role, business capability, DPF surface, integration anchor, and posture.
- Fail if every business is forced into platform/product vocabulary or if missing capability work cannot be captured as small backlog slices.

### 9. UX And Performance Smoke

- Check desktop and mobile-width layouts for obvious overlap, clipped text, unreadable cards, and confusing navigation.
- Check that page headings, tabs, actions, and empty states are business-appropriate.
- Confirm the test path does not require the user to understand internal architecture terms.
- Fail if the main workflow is visually broken, unreadable, or too jargon-heavy for the target employee.

## Pass / Warn / Fail Rules

Use consistent verdicts:

- `Pass`: the archetype produces coherent setup, useful capabilities, sensible customer flow, and relevant integration/work context.
- `Warn`: the archetype works but relies on generic fallback, thin copy, missing exact workspace-home contribution, or incomplete integration depth.
- `Fail`: empty capabilities, wrong archetype persistence, broken setup, wrong CTA, misleading tailored claims, missing central integration anchors, or platform/admin vocabulary leaking into worker UX.
- `Blocked`: app unavailable, auth/setup unavailable, database unavailable, or environment/build state prevents the walkthrough.

## Evidence Template

Capture one record per archetype:

```text
Archetype:
Category:
Why tested:
Catalog source count/category reconciled:
Install/build used:
Setup result:
Workspace resolution/twin result:
Capability result:
Employee/work result:
Customer/storefront result:
Finance result:
Integration result:
AI coworker result:
Portfolio/product/backlog result:
UX/performance issues:
Screens/routes exercised:
Verdict: Pass / Warn / Fail / Blocked
Follow-up backlog item:
```

## Cross-Cutting Failure Rules

- If the first archetype in a category cannot be selected or persisted, stop that category and file one category setup blocker.
- If the same problem appears across three or more categories, file one cross-cutting backlog item instead of one item per archetype.
- If only vocabulary or copy is weak but the workflow functions, mark `Warn` and group the issue into a content/taxonomy improvement item.
- If capabilities are empty anywhere, mark `Fail`; empty capability UX breaks the core purpose of this work.
- If an archetype has no exact vertical workspace-home contribution, do not fail automatically. Fail only if the UI claims exact tailoring or the fallback is unusable.

## Done-Enough Criteria

The product is ready for broader testing when:

- All 21 representative category sentinels have been walked, or a blocked sentinel has a named environment/product blocker.
- Source, seed, and live archetype counts have been reconciled and any drift has a follow-up item.
- No business capability page is empty.
- At least one service, goods, nonprofit, property, platform, healthcare, food, education, fitness, pet-service, banking/financial, civic/public-sector, rental, field-mobility, media/production, and live-events archetype has passed or has a clear backlog item.
- At least one each of inquiry, booking, order/purchase, donation, rental/reservation, application, and report/request-style customer actions has been exercised where applicable.
- QuickBooks, Stripe, CRM, payroll, communications, marketing, and local-presence integration posture is visible where expected.
- Employee work views are understandable for real business roles.
- Platform/product vocabulary does not leak into every vertical.
- `OperatorCockpit`, `WorkspaceTwinHero`, `VerticalWorkspaceHome`, and `PlatformWorkspaceHome` behavior has been observed at least once across the batch, or the evidence explains why a mode did not render.
- No open P0/P1 failures remain; P2/P3 issues have backlog items.

## Likely Backlog Batch

Check for duplicates before creating any items. The first likely batch from this plan is:

1. **Archetype QA: acceptance matrix and walkthrough harness for live business archetypes**
   - Type: `product`
   - Work type: `tool`
   - Scope: Provide a reusable matrix/harness that tracks category, archetype, employee roles, customer CTA, finance posture, integration anchors, workspace-home mode, and verdict.

2. **Business capability UX: expose commercial market/product references from taxonomy seed**
   - Type: `product`
   - Work type: `feature`
   - Scope: Show the common commercial products and market anchors that are already present in the source spreadsheet/taxonomy data, tied to capabilities and integration posture.

3. **Business capability perspectives: fill high-value archetype-specific gaps**
   - Type: `product`
   - Work type: `feature`
   - Scope: Add or refine perspectives for the representative archetype batch, starting with `it-managed-services`, `wholesale-distribution`, `hair-salon`, `plumber/electrician`, and `dental-practice`.

4. **Employee work taxonomy: category-level role and queue expectations**
   - Type: `product`
   - Work type: `feature`
   - Scope: Define expected employee roles, work queues, coworker handoffs, and first-screen cues for each archetype category.

5. **Integration posture cards by archetype category**
   - Type: `product`
   - Work type: `feature`
   - Scope: For each category, declare whether QuickBooks, Stripe, CRM, payroll, communications, marketing, local presence, inventory/procurement, and compliance tools are native DPF, integration-led, hybrid, eventual replacement, or not applicable.

6. **Archetype inventory reconciliation for 95/21 catalog growth and roster docs**
   - Type: `product`
   - Work type: `doc`
   - Scope: Reconcile source, seed, and live archetype count/category references so planning docs, acceptance plans, and live data agree.

## Recommended Execution Order

1. `software-platform`
2. `it-managed-services`
3. `medical-practice` or `dental-practice`
4. `wholesale-distribution`
5. `plumber` or `electrician`
6. `hair-salon` or `beauty-spa`
7. `restaurant`
8. `property-management-company`
9. `charity` or `animal-shelter`
10. `tutoring`
11. `gym` or `yoga-studio`
12. `pet-grooming` or `pet-boarding`
13. `community-bank` or `credit-union`
14. `small-town-municipality` or `municipal-utility`
15. `equipment-rental` or `self-storage`
16. `new-home-builder` or `custom-home-builder`
17. `mobile-mechanic` or `roadside-assistance`
18. `moving-company` or `courier-delivery`
19. `guard-patrol` or `alarm-cctv-install`
20. `film-video-production` or `post-production-studio`
21. `event-venue` or `tour-promoter`

This order starts with platform/operator behavior, exact high-value workspace homes, and broad operational models, then covers the newer regulated, civic, rental, field-mobility, production, and event categories added after the original baseline.
