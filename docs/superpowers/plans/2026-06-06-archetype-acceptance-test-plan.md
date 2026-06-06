# Archetype Acceptance Test Plan

> **For agentic workers:** REQUIRED: Use `superpowers:executing-plans` when running this plan end-to-end. This plan is a product-behavior walkthrough, not a build-system verification plan. Use the already-available sandbox/main build selected by the operator; do not turn failed access into a self-upgrade or deployment investigation unless the task is explicitly rescoped.

**Goal:** Confirm that selecting a business archetype produces a coherent DPF experience across setup, business capabilities, employee work, customer/storefront flows, finance, integrations, AI coworkers, and portfolio/product/backlog surfaces.

**Architecture:** Exercise a representative archetype coverage set rather than every vertical exhaustively. Each walkthrough follows the same surface checklist so repeated failures become cross-cutting backlog items instead of many duplicate vertical bugs.

**Tech Stack:** DPF portal, `StorefrontConfig -> StorefrontArchetype`, business capability perspectives, workspace home resolver, storefront templates, finance setup, integration catalog, AI coworker registry, live backlog.

---

## Scope

This plan answers: "Does the archetype-driven experience work well enough across the main different parts?"

It intentionally separates product UX confidence from build/deploy validation. If the app is already available, test the product. If the app cannot be reached or the selected install is stale, record that as an environment blocker and stop the walkthrough; do not spend this test pass debugging the build pipeline.

## Baseline To Reconcile

Before execution, reconcile the live install inventory with this baseline:

- Live archetype inventory observed on 2026-06-06: 46 storefront archetypes across 12 categories.
- Business capability seed observed on 2026-06-06: 28 active generic capability rows, with archetype-specific behavior layered through perspectives/provenance.
- Known roster drift to watch: `wholesale-distribution` exists in live data and should be included in retail/goods coverage.
- Existing related work: business capability and employee work taxonomy, workspace-home contribution roster, vertical workspace-home substrate, portal navigation archetype IA, QuickBooks parity, integration benchmark work.

If the live count differs, update the evidence notes before judging coverage.

## Representative Coverage Set

Run this first batch before trying to cover every archetype:

| Archetype | Category | Why It Is In The Batch |
| --- | --- | --- |
| `software-platform` | `software-platform` | Platform/operator behavior, portfolio/product surfaces, AI coworker coordination, and intentional platform fallback. |
| `it-managed-services` | `professional-services` | Rich professional-services setup, service delivery, customer support, security/compliance, Microsoft 365-style integration anchors. |
| `hair-salon` or `beauty-spa` | `beauty-personal-care` | Appointment/service business, employee scheduling, customer intake, local marketing. |
| `wholesale-distribution` | `retail-goods` | Goods, B2B customers, inventory/procurement, and the newer archetype that exposed roster drift. |
| `plumber` or `electrician` | `trades-maintenance` | Field-service workflow, dispatch-style work, estimates, jobs, customer requests. |
| `restaurant` | `food-hospitality` | Food/hospitality vocabulary, menu/offer structure, customer-facing portal language. |
| `dental-practice` | `healthcare-wellness` | Healthcare-style service delivery, intake, compliance posture, patient/customer wording. |
| `property-management-company` | `hoa-property-management` | Owners/tenants, requests, property obligations, recurring work. |
| `charity` or `animal-shelter` | `nonprofit-community` | Donation, volunteer, community-service, and support vocabulary. |
| `tutoring` | `education-training` | Sessions, scheduling, students/customers, learning-service workflow. |
| `gym` or `yoga-studio` | `fitness-recreation` | Membership/service hybrid and recurring customer engagement. |
| `pet-grooming` or `pet-boarding` | `pet-services` | Appointment plus pet/asset-style customer-subject workflows. |

This set covers platform, professional service, appointment service, goods/inventory, field service, food, healthcare, property, nonprofit, education, fitness, and pet service operating models.

## Per-Archetype Walkthrough

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
- Confirm the workspace reflects the employees who would actually use the business: owner/operator, bookkeeper/accountant, sales/business development, marketing, operations/service delivery, customer support, HR/payroll/admin, inventory/procurement, and IT/security/compliance where relevant.
- Confirm the first screen gives useful work cues for that archetype rather than platform administration noise.
- Confirm missing vertical workspace-home contributions are honest fallbacks, not misleading tailored promises.
- Fail if worker-facing UX still reads like platform operator tooling for ordinary business employees.

### 4. Customer / Storefront / Portal

- Open the internal storefront management surface and the public customer/storefront surface.
- Confirm labels, calls to action, sections, item templates, and forms match the archetype.
- Exercise the natural customer action for the archetype: book, inquire, order, donate, request service, register, or contact.
- Confirm resulting inbox/order/booking/donation records appear in the management surface where applicable.
- Fail if the CTA type is wrong, customer copy is generic in a confusing way, or the action does not route back into the business workspace.

### 5. Finance

- Open finance setup and finance work surfaces.
- Confirm finance posture fits the archetype:
  - invoices and customers for service businesses
  - bills, vendors, and expenses for operators
  - purchasing, stock, and assets for goods businesses
  - donations or grants for nonprofits where relevant
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
Install/build used:
Setup result:
Capability result:
Employee/work result:
Customer/storefront result:
Finance result:
Integration result:
AI coworker result:
Portfolio/product/backlog result:
UX/performance issues:
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

- All 12 representative archetypes have been walked.
- No business capability page is empty.
- At least one service, goods, nonprofit, property, platform, healthcare, food, education, fitness, and pet-service archetype has passed or has a clear backlog item.
- At least one each of inquiry, booking, order/purchase, and donation-style customer actions has been exercised where applicable.
- QuickBooks, Stripe, CRM, payroll, communications, marketing, and local-presence integration posture is visible where expected.
- Employee work views are understandable for real business roles.
- Platform/product vocabulary does not leak into every vertical.
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

6. **Archetype inventory reconciliation for `wholesale-distribution` and roster docs**
   - Type: `product`
   - Work type: `doc`
   - Scope: Reconcile live archetype count and retail/goods roster references so planning docs, acceptance plans, and live data agree.

## Recommended Execution Order

1. `software-platform`
2. `it-managed-services`
3. `hair-salon` or `beauty-spa`
4. `wholesale-distribution`
5. `plumber` or `electrician`
6. `restaurant`
7. `dental-practice`
8. `property-management-company`
9. `charity` or `animal-shelter`
10. `tutoring`
11. `gym` or `yoga-studio`
12. `pet-grooming` or `pet-boarding`

This order starts with platform/operator behavior, then tests the richest known profile, then covers appointment service, goods/inventory, field service, and the remaining category families.
