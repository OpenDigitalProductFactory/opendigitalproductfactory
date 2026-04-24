# Tax Remittance Readiness, Automation, and Jurisdiction Intelligence Design

**Date:** 2026-04-23  
**Status:** Draft  
**Author:** OpenAI Codex with user direction  
**Recommended Epic:** `Tax Remittance Readiness, Automation, and Jurisdiction Intelligence`

## 1. Problem Statement

DPF has broad finance primitives today, but it does not yet have a tax remittance capability.

The current platform can store tax amounts on invoices, bills, purchase orders, and recurring schedules, and it exposes a VAT summary report. That is not enough for real-world remittance operations. Businesses need help determining where they owe indirect tax, what authorities they remit to, how often they file, what evidence they need, and how to stay ahead of due dates.

This is especially important for service businesses and MSP-style recurring billing environments, where:

- services may be delivered across multiple locations and jurisdictions
- recurring invoices create repeated tax events
- the business may already have registrations in place, or may be setting up for the first time
- humans expect the finance coworker to guide setup and keep the business operationally current

The platform should not attempt to become a full global tax engine in phase 1. It should become tax-remittance-ready: able to guide setup, track registrations and periods, prepare filing-ready outputs, maintain evidence, and integrate cleanly with accounting or specialist tax systems.

## 2. Live Backlog Context

Per repo guardrails, live backlog state was checked first against the runtime PostgreSQL database during this design session.

Observed live state:

- open epics exist for site/location and integration-lab work
- no live epic exists for `tax` or `remittance`
- no live backlog items exist for a tax remittance feature

Implication:

- this is genuinely new platform work, not a partially completed active epic
- a new dedicated epic should be created rather than folding this into the MSP archetype or general finance setup

## 3. Current Repo Posture

Current DPF codebase state:

- finance routes exist for invoices, bills, recurring billing, banking, close, reports, and settings
- finance settings currently expose currency and dunning, not tax remittance
- the Prisma schema includes transaction-level fields such as `taxRate`, `taxAmount`, and `vatAmount`
- the only shipped tax-adjacent reporting surface is `VAT Summary`

Not present today:

- jurisdiction reference data
- organization tax setup or registration models
- remittance schedules or obligation periods
- filing readiness workflow
- tax evidence/artifact records
- tax-specific coworker setup flow
- tax remittance settings route

This means the feature should be treated as net-new implementation built on top of existing finance primitives.

## 4. Research & Benchmarking

This design uses current public and primary sources where possible.

### 4.1 Official Public Authority Sources

These sources support the bootstrap-seed-plus-live-verification approach:

- Federation of Tax Administrators maintains a state-by-state electronic filing directory with official links to state tax agencies and filing/payment entry points: [FTA Electronic Filing Information](https://taxadmin.org/electronic-filing-information/)
- The European Commission publishes EU VAT framework guidance and country-specific VAT authority pages: [EU VAT](https://taxation-customs.ec.europa.eu/taxation/vat_en), [Country-specific information on VAT](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/vat-rates/country-specific-information-vat_en)
- HMRC publishes VAT return and payment cadence guidance: [Sending a VAT Return](https://www.gov.uk/submit-vat-return)
- Denmark publishes explicit VAT cadence and deadline guidance by business profile: [SKAT VAT deadlines](https://skat.dk/en-us/businesses/vat/deadlines-filing-vat-returns-and-paying-vat)
- Norway publishes VAT registration and payment/submission rules, including standard and annual regimes: [Skatteetaten VAT](https://www.skatteetaten.no/en/business-and-organisation/vat-and-duties/vat/), [Paying VAT](https://www.skatteetaten.no/en/business-and-organisation/vat-and-duties/vat/paying-vat/)

What we learn:

- official portals and filing entry points are publicly discoverable enough to seed
- cadence and filing treatment are often conditional and business-specific
- the platform must not assume the seed is authoritative; live verification is required before setup is finalized or periods are scheduled

### 4.2 Accounting / Finance Platform Benchmarks

#### Stripe Tax

Stripe describes indirect tax compliance as a lifecycle of obligation monitoring, registration, calculation, collection, and reporting/filing/remittance: [How Tax works](https://docs.stripe.com/tax/how-tax-works).

Patterns adopted:

- separate tax registrations from tax calculation
- monitor obligations by location and footprint
- treat reporting/filing/remittance as a distinct downstream workflow
- support exports and partners rather than forcing one filing engine into the core platform

Patterns rejected:

- trying to replicate Stripe’s continuously maintained tax content operation in phase 1

#### QuickBooks Online

QuickBooks documents automatic sales tax calculation and separate filing/pay workflows: [How QuickBooks calculates sales tax](https://quickbooks.intuit.com/learn-support/en-us/help-article/sales-taxes/learn-quickbooks-online-calculates-sales-tax/L8VWCLobK_US_en_US), [Sales tax in QuickBooks Online](https://quickbooks.intuit.com/learn-support/en-us/help-article/sales-taxes/sales-tax-quickbooks-online/L6oZbeziN_US_en_US), [File and pay sales tax](https://quickbooks.intuit.com/learn-support/en-us/help-article/state-taxes/faq-filing-taxes/L7id93G7F_US_en_US).

Patterns adopted:

- keep tax setup visible to SMB operators
- distinguish setup, calculation, and filing/payment
- preserve tax-exempt/customer/location factors in the data model

Patterns rejected:

- assuming an accounting system’s tax workflow can be the canonical platform workflow for every DPF business

#### ERPNext

ERPNext uses tax templates, tax rules, tax categories, and item-specific overrides rather than embedding all tax behavior directly into invoices: [Setting Up Taxes](https://docs.frappe.io/erpnext/user/manual/en/setting-up-taxes), [Tax Rule](https://docs.frappe.io/erpnext/user/manual/en/tax-rule), [Sales Taxes and Charges Template](https://docs.frappe.io/erpnext/v12/user/manual/en/selling/sales-taxes-and-charges-template).

Patterns adopted:

- separate tax determination metadata from transaction rows
- support business-level and item-level tax treatment
- preserve explicit tax categories/codes rather than only raw rates

Patterns rejected:

- reproducing a complete accounting tax-template engine in phase 1

### 4.3 Differentiator For DPF

DPF’s differentiator is the finance AI coworker.

Existing systems mostly assume:

- a human accountant performs setup and verifies the rules
- the product mainly records and exports data afterward

DPF should go further by making the coworker:

- guide setup interactively
- detect whether the business is already configured or not
- research likely authorities from footprint and business model
- verify live authority pages before persisting important configuration
- maintain due-date awareness and filing readiness over time

### 4.4 Anti-Patterns Identified

- treating seed data as runtime truth
- assuming every business starts from zero
- assuming every business is already configured
- collapsing calculation, liability, and filing into one opaque setting
- making the AI coworker guess legal facts instead of labeling uncertainty and asking for confirmation
- giving the coworker blanket whole-database authority instead of domain-scoped authority with audit

## 5. Design Goals

1. Make tax remittance setup part of the business onboarding and finance setup journey.
2. Give the finance coworker enough seeded jurisdiction intelligence to start intelligently without pretending the seed is always current.
3. Let the coworker guide both first-time setup and “normalize our existing setup” onboarding modes.
4. Track real business registrations, schedules, periods, evidence, and issues.
5. Keep calculation and remittance concerns distinct.
6. Keep the design reusable across multiple business archetypes, not only MSPs.
7. Keep integration boundaries clean for accounting and specialist tax systems.

## 6. Scope

### In Scope

- indirect taxes only: sales tax, VAT, GST-style remittance posture
- jurisdiction reference records
- business tax profile and per-authority registrations
- tax setup UX in finance settings
- coworker-led tax setup and verification workflow
- remittance cadence and period generation
- filing-preparation status tracking
- evidence, exports, and audit trail
- notifications for due dates, stale setup, and blocking issues
- authority model for high-trust finance coworker operations

### Out of Scope For Phase 1

- payroll/employment tax remittance
- full portal login and payment automation
- universal tax-rate calculation engine
- guaranteed local-jurisdiction coverage for all county/city/district authorities
- statutory filing execution across every authority
- replacing accounting or specialist tax filing products

## 7. Core Design Decision

DPF should use a **bootstrap seed + live verification** model.

The platform should ship a reusable jurisdiction reference dataset with official portal URLs, authority names, filing entry points, locality model hints, and source provenance. The finance coworker should use that seed as a starting map, then verify the live authority information during onboarding or before period scheduling.

If a jurisdiction is missing or stale, the coworker falls back to fresh research and records what it found. Seed data accelerates setup; it does not override live reality.

## 8. Domain Model Implications

### 8.1 Jurisdiction Reference Layer

`TaxJurisdictionReference`

Purpose:

- reusable platform knowledge about an authority or filing regime

Suggested fields:

- `jurisdictionRefId`
- `countryCode`
- `stateProvinceCode`
- `authorityName`
- `authorityType` (`country`, `state`, `county`, `city`, `district`, `special`)
- `parentJurisdictionRefId`
- `taxTypes` (`sales_tax`, `vat`, `gst`, `oss`, `ioss`, etc.)
- `localityModel` (`state_only`, `state_plus_local`, `home_rule_local`, `country_only`, `oss_overlay`)
- `officialWebsiteUrl`
- `registrationUrl`
- `filingUrl`
- `paymentUrl`
- `helpUrl`
- `cadenceHints`
- `filingNotes`
- `automationHints`
- `sourceUrls`
- `sourceKind`
- `lastResearchedAt`
- `lastVerifiedAt`
- `confidence`
- `staleAfterDays`

### 8.2 Business Tax Posture Layer

`OrganizationTaxProfile`

Purpose:

- top-level indirect-tax posture for a business

Suggested fields:

- `organizationId`
- `homeCountryCode`
- `primaryRegionCode`
- `taxModel` (`simple_manual`, `externally_calculated`, `hybrid`)
- `externalSystem`
- `setupMode` (`unknown`, `existing`, `new_business`)
- `setupStatus` (`draft`, `in_review`, `active`, `blocked`)
- `footprintSummary`
- `lastVerifiedAt`
- `notes`

`TaxRegistration`

Purpose:

- one real registration or filing relationship between the organization and an authority

Suggested fields:

- `organizationId`
- `jurisdictionReferenceId`
- `registrationNumber`
- `registrationStatus`
- `filingFrequency`
- `filingBasis`
- `remitterRole`
- `effectiveFrom`
- `effectiveTo`
- `firstPeriodStart`
- `portalAccountNotes`
- `verifiedFromSourceUrl`
- `lastVerifiedAt`
- `confidence`

### 8.3 Remittance Operations Layer

`TaxObligationPeriod`

Purpose:

- one filing/payment period for one registration

Suggested fields:

- `registrationId`
- `periodStart`
- `periodEnd`
- `dueDate`
- `status` (`draft`, `ready`, `filed`, `paid`, `issue`, `overdue`, `skipped`)
- `salesTaxAmount`
- `inputTaxAmount`
- `netTaxAmount`
- `manualAdjustmentAmount`
- `exportStatus`
- `filedAt`
- `paidAt`
- `confirmationRef`
- `preparedByAgentId`

`TaxFilingArtifact`

Purpose:

- evidence and handoff records

Suggested fields:

- `periodId`
- `artifactType` (`workpaper`, `export`, `confirmation`, `supporting_note`, `source_capture`)
- `storageKey` or file reference
- `externalRef`
- `sourceUrl`
- `createdByAgentId`
- `createdByUserId`

`TaxIssue`

Purpose:

- tracked blocking or warning conditions

Suggested fields:

- `organizationId`
- `registrationId`
- `periodId`
- `issueType`
- `severity`
- `status`
- `title`
- `details`
- `openedAt`
- `resolvedAt`

## 9. Calculation vs Remittance Boundaries

DPF should not conflate tax calculation with remittance workflow.

DPF should support:

- storing transaction-level tax amounts and rates on sales and purchase transactions
- capturing tax codes/categories later as finance matures
- summarizing liability for a period
- tracking whether the business is ready to file and pay

External systems may still own:

- comprehensive jurisdictional rate content
- edge-case product/service taxability
- high-confidence statutory calculations across many regions
- actual filing execution in some environments

Boundary rule:

- DPF owns `readiness`, `registrations`, `period workflow`, `evidence`, `alerts`, and `handoff`
- DPF may own `simple calculation` in low-complexity cases
- specialist accounting/tax systems may continue to own `advanced calculation` and `filing execution`

## 10. Setup Modes And Coworker Behavior

The finance coworker should behave like an expert operator, not a raw form filler.

It should first classify the business:

- already filing and registered
- partially configured
- new business / first-time setup

Then it adapts its questions and suggestions accordingly.

### Existing Setup Mode

The coworker should:

- ask which authorities the business already files with
- collect registration IDs, cadence, and ownership
- verify the known setup against official sources where possible
- normalize the business into structured `TaxRegistration` records without forcing a restart

### New Business Mode

The coworker should:

- ask where the business is registered, operates, and delivers services
- infer likely jurisdictions from footprint and business type
- research likely registration paths and authority portals
- label uncertainty clearly and create follow-up tasks where accountant/legal confirmation is still needed

### Core Coworker Rules

- do not assume new
- do not assume already configured
- ask the next best question, not every question at once
- prefer official authority pages and public primary sources
- record confidence and provenance
- do not guess legal facts when the evidence is unclear

## 11. Remittance Periods And Schedules

Once a registration is confirmed, DPF should generate obligation periods.

Phase 1 behavior:

- generate periods from the registration’s assigned filing frequency
- set due dates from configured rules or manually confirmed authority guidance
- allow manual overrides where the authority-assigned cadence differs from broad seed hints
- support nil-return obligations where the authority requires filing even with no tax due

The existing `ScheduledAgentTask` model is the right platform seam for ongoing monitoring and reminder orchestration, while `Notification` and `ToolExecution` cover alerts and audit trail.

## 12. Filing, Export, and Audit Workflow

Phase 1 filing workflow should be preparation-oriented:

1. coworker reviews the registration and current period
2. coworker assembles the available tax summary and supporting notes
3. coworker generates a filing packet or export
4. humans or downstream systems file and pay
5. the period is updated with confirmation references, notes, and evidence

Required audit features:

- source URLs used during live verification
- timestamps for verification and changes
- generated export/workpaper artifacts
- who or what updated the period
- notifications sent for upcoming, completed, or blocked periods

`ToolExecution` already provides a strong base audit trail for coworker actions and should be extended through normal platform patterns, not bypassed.

## 13. Integration Implications

DPF should integrate with accounting and tax systems without making them mandatory.

Likely integration roles:

- accounting systems receive exports, summary journals, or filing-support datasets
- tax systems receive prepared transaction exports or period summaries
- payroll systems such as ADP remain out of scope for this indirect-tax epic

Phase 1 should support:

- export status and external reference fields on periods/artifacts
- integration-linked notes on the organization tax profile
- clean handoff rather than hard-coded vendor-specific workflows

## 14. MCP / Agent Authority Standard

This epic should reinforce a reusable DPF platform rule:

**Scope AI coworker authority by business capability, not by blanket table access.**

Implications:

- finance remittance coworker gets strong authority within the tax-remittance domain
- it gets supporting read access to finance/customer/context records it needs
- it does not become a platform super-admin
- high-risk actions still require audit, notification, and explicit guardrails

The current grant system in `apps/web/lib/tak/agent-grants.ts` already enforces deny-by-default tool mapping and is the right place to extend with tax-remittance-specific grant keys later.

## 15. Recommended Epic And Backlog Breakdown

### Epic Title

`Tax Remittance Readiness, Automation, and Jurisdiction Intelligence`

### Why It Should Be Separate

- it is cross-archetype platform infrastructure, not an MSP-only behavior
- it spans setup, compliance posture, scheduling, audit, and integrations
- it introduces its own durable reference and operational models
- it should not be buried inside recurring billing, invoicing, or archetype work

### Likely Backlog Breakdown

1. Jurisdiction reference registry and seed dataset
2. Organization tax profile and registration data model
3. Tax remittance settings UX in finance
4. Coworker-led tax setup and live verification flow
5. Obligation period generation and status tracking
6. Filing packet, export, and evidence workflow
7. Notifications and issue tracking for upcoming/blocked periods
8. Agent grant and capability model for tax-remittance authority
9. Low-priority seed refresh and reference maintenance workflow
10. Later-phase portal submission and payment automation

## 16. Risks And Anti-Patterns

Key risks:

- stale seed data used as truth
- under-modeling setup confidence and verification provenance
- over-promising filing automation before portal and credential flows are mature
- giving the coworker too much authority without meaningful audit boundaries
- shipping a UI that only supports greenfield setup and ignores existing businesses

Avoid these anti-patterns:

- one global “tax enabled” switch
- storing only free-text notes instead of structured registrations and periods
- hiding tax setup entirely behind the coworker with no inspectable UI source of truth
- encoding country/state cadence hints as if they were the business’s actual assigned cadence

## 17. Recommended Rollout Phases

### Phase 1: Readiness Foundation

- jurisdiction reference seed
- organization tax profile
- tax registration records
- finance settings UX
- coworker-led setup and live verification
- period generation
- filing packet / export / evidence flow
- notifications and issue tracking

### Phase 2: Stronger Liability Modeling

- explicit tax decision snapshots and adjustments
- tighter linkage from invoices, recurring schedules, credits, and bills to obligation periods
- improved audit workpapers and reconciliation support

### Phase 3: Credentialed Automation

- encrypted authority credentials
- portal automation where appropriate
- scheduled filing/payment execution
- failure handling for MFA, portal outages, insufficient funds, and changed authority requirements

## 18. Recommended First Implementation Slice

The first slice should deliver:

- a `Tax Remittance` settings route under finance
- new schema models for jurisdiction references, organization tax profile, registrations, periods, artifacts, and issues
- a lightweight jurisdiction seed file
- coworker-aware setup flow that asks whether the business is already configured or setting up from scratch
- period generation and manual filing-preparation tracking

That gives the platform a real tax-remittance foundation without waiting for full submission automation.
