# IT Service Provider / MSP Archetype Design

**Date:** 2026-04-23  
**Status:** Draft  
**Author:** OpenAI Codex with user direction  
**Epic:** TBD - recommend new epic

## 1. Problem Statement

The current storefront/business archetype model is too weak for an IT service provider / managed service provider (MSP) business.

Today, an archetype primarily influences:

- portal vocabulary
- seeded storefront items
- intake forms
- setup defaults
- some category-level behavior

That is not sufficient for an MSP. An MSP does not just market services. It runs an ongoing managed customer estate across customers, sites, assets/configuration items (CIs), agreements, incidents, requests, changes, projects, schedules, and recurring billing preparation.

For TeamLogic and similar businesses, the archetype must be stronger. Selecting the MSP archetype should load a real business operating profile into the base platform, not just a storefront template.

## 2. Live Backlog Context

Per repo guardrails, live backlog state was checked first against the runtime PostgreSQL database on 2026-04-22 using the active Docker credentials from the repo root `.env`.

Observed live state at that time:

- only one recent open epic was present: `EP-BUILD-9F749C` - `Code Graph Ship Test - Ship Tracking`
- no open MSP / TeamLogic / IT service provider epic was present
- built-in storefront archetypes already include `it-managed-services` under `professional-services`

Implication:

- this work does not cleanly fit an active live epic today
- a new epic should be created for the stronger MSP archetype track
- the existing built-in `it-managed-services` archetype is a starting point, but it is far too storefront-oriented to satisfy the target operating model

## 3. Research & Benchmarking

This design is based on current public references from TeamLogic and comparable MSP / asset / documentation / topology platforms.

### 3.1 TeamLogic IT

TeamLogic publicly positions its managed offering around:

- help desk
- network monitoring and management
- system monitoring and maintenance
- cloud services
- cybersecurity
- co-managed IT
- backup and disaster recovery

Their public managed IT services material describes oversight of routers, switches, firewalls, access points, servers, endpoints, identity, applications, and hybrid cloud environments. That supports treating managed customer environments as first-class objects in the archetype, not just inquiry forms.

References:

- https://www.teamlogicit.com/Managed-IT-Services
- https://www.teamlogicit.com/Resources/Managed-IT-Services
- https://www.teamlogicit.com/TeamlogicIT/media/TLIT-Images/Resources/Info%20Sheets/Co-Managed-IT-Services_2023.pdf?ext=.pdf
- https://author.teamlogicit.com/getmedia/05d6f991-6253-4960-9cc4-74779b906c86/Franchise-Information-Report_June_2025.pdf.aspx

### 3.2 NinjaOne

NinjaOne's current PSA/billing documentation shows that agreements are standard operating primitives with:

- billing intervals
- support hours
- agreement templates
- organization-specific agreements
- products such as devices, backups, end-users, and other billable units
- agreement period tracking

Its ConnectWise mapping docs also show device counts and agreement/product mapping as standard MSP behavior rather than custom logic.

Patterns adopted:

- agreement template concept
- recurring schedule concept
- billable unit categories such as devices and end-users
- organization/customer-scoped agreements
- scheduled sync between managed estate and billing preparation

References:

- https://www.ninjaone.com/docs/professional-services-automation-psa/agreement-services-billing/
- https://www.ninjaone.com/docs/integrations/service-automation-and-management-psa-and-itsm/connectwise-manage/products-agreements/

### 3.3 IT Glue

IT Glue's configuration documentation demonstrates the importance of customer-scoped configuration objects with:

- organization ownership
- device/location metadata
- interfaces
- connected-to relationships
- external-source overlays
- PSA/RMM sync

Patterns adopted:

- customer-scoped CI/configuration ownership
- explicit relationship capture between customer devices
- source attribution and overlay behavior for imported data

Reference:

- https://help.itglue.kaseya.com/help/Content/2-using/documentation-guide/configurations.html

### 3.4 NetBox

NetBox's tenancy model is especially relevant because it explicitly notes MSP use cases in which each customer is represented as a tenant and core objects such as sites, devices, IPs, VMs, and locations can be tenant-assigned.

Patterns adopted:

- customer/tenant scoping across core infrastructure objects
- site and location as first-class records
- graph/traversal-friendly representation of technical estate

Reference:

- https://netbox.readthedocs.io/en/stable/features/tenancy/

### 3.5 GLPI

GLPI demonstrates the value of tying together:

- CMDB
- helpdesk
- financial management
- project management

It explicitly positions asset inventory and helpdesk linkage as a standard way to get full control of IT infrastructure.

Patterns adopted:

- asset-to-ticket linkage
- project capability tied to ITIL/service work
- lifecycle and financial metadata on technical assets

References:

- https://glpi-project.org/features/
- https://help.glpi-project.org/documentation/modules/tools/projects
- https://help.glpi-project.org/02_faq/financial_and_administrative_information/

### 3.6 HaloPSA

Halo's public guide catalog is enough to show the category shape even without relying on private pages. The guide taxonomy makes clear that Halo treats the following as normal MSP capabilities:

- billing rules and agreements
- contract schedules
- recurring invoices
- asset meters
- asset discovery
- contract/agreement rules

Patterns adopted:

- contract schedule concept
- recurring billing profile concept
- asset-count-driven invoice inputs
- strong linkage between agreements and recurring preparation

Reference:

- https://usehalo.com/halopsa/guides/1273/

### 3.7 Patterns Rejected

Patterns explicitly not adopted for the base archetype:

- "PSA clone everything" in v1
- forcing one vendor's billing workflow into the platform
- collapsing internal company CIs and customer CIs into one mixed estate
- making Neo4j the source of truth

## 4. Design Goals

1. Make the MSP archetype a true operating profile, not just a portal theme.
2. Support real MSP entities: customers, sites, managed assets/CIs, agreements, service work, schedules, and billing preparation.
3. Keep Postgres authoritative while using Neo4j as a customer-environment graph projection.
4. Keep local company infrastructure separate from customer-managed infrastructure.
5. Allow customer-specific deployment overlays later without weakening the shared base archetype.
6. Prepare for billing correctly without hard-coding one billing process.

## 5. Non-Goals

- Reproducing ConnectWise, HaloPSA, or NinjaOne end-to-end in this first design
- Defining one mandatory billing execution workflow for all MSP customers
- Encoding TeamLogic-specific franchise-only procedures into the shared platform
- Delivering the separate site mapping epic in this spec
- Delivering the separate tax remittance epic in this spec
- Making Neo4j authoritative over customer operational data

## 6. Core Design Decision

**The `IT service provider / MSP` archetype must activate first-class platform modules.**

Selecting this archetype should do more than seed services like "Managed IT Support" or "Cloud Migration." It should activate and configure a business model with its own domain objects, workflows, graph projection, and operating defaults.

In short:

- old model: `archetype = storefront/setup flavor`
- required model: `archetype = business operating model activation`

## 7. Capability Modules Activated By The MSP Archetype

The archetype should activate these base-platform modules:

### 7.1 Customer Estate Management

- customer accounts
- customer sites
- managed assets / configuration items
- CI categories such as endpoints, servers, network devices, SaaS tenants, cloud resources, printers, backup jobs, licenses, firewalls, virtual machines, and identity platforms

### 7.2 Service Agreements

- agreement records
- agreement lines
- agreement schedules
- coverage scope
- renewal and review dates
- support hour definitions

### 7.3 Billing Readiness

- billable unit definitions
- recurring schedule definitions
- agreement snapshots by billing period
- overage and uncovered-item visibility
- invoice-ready output records

This is intentionally `billing readiness`, not one universal billing process.

### 7.4 Service Operations

- incidents
- service requests
- changes
- escalation support
- SLA application
- ticket-to-customer/site/CI linkage

### 7.5 Project Delivery

- migrations
- onboarding
- remediation programs
- refreshes
- rollouts
- strategic/vCIO initiatives

### 7.6 Lifecycle / Compliance / Operations Signals

- warranty dates
- contract dates
- backup posture
- patch posture
- lifecycle state
- security/compliance signals
- review cadences

### 7.7 Integration Slots

The archetype should expose standard integration surfaces for:

- HR/payroll
- directory/identity
- RMM/endpoint management
- documentation
- accounting
- communications
- cloud/security

Specific vendor choices are deferred to the customer deployment.

## 8. Core Domain Model

The MSP archetype requires the following first-class records.

### 8.1 Commercial and Service Context

- `CustomerAccount`
- `CustomerSite`
- `ServiceAgreement`
- `AgreementLine`
- `ServiceProject`

### 8.2 Managed Environment

- `ManagedAsset` and/or `ConfigurationItem`
- CI relationship records
- CI class/type records
- lifecycle/status metadata

### 8.3 Operational Work

- `ServiceTicket`
- `Incident`
- `Request`
- `Change`
- `ScheduledReview`

### 8.4 Billing Preparation

- billing unit snapshots
- agreement period records
- invoice input / handoff records

### 8.5 Key Relationship Rules

- one customer can have many sites
- one site can have many managed assets/CIs
- one customer can have multiple agreements
- agreements can cover sites, CI groups, service bundles, or named assets
- tickets and changes should reference customer, site, and CI whenever known
- billing preparation should derive from agreement coverage plus period snapshots

## 9. Agreements, Schedules, And Billing Readiness

The archetype should support standard MSP agreement pricing models, including:

- per user
- per endpoint/device
- per server
- per network device
- per site
- per service bundle
- per configuration item
- block hours / prepaid hours
- fixed monthly retainer
- one-time project charges

However, the design must not prescribe one execution workflow for invoice creation, approval, export, or collection. Those details may differ by customer deployment.

What the base archetype should provide:

- billable unit categories
- recurring schedule definitions
- agreement period boundaries
- count snapshots for the period
- exception visibility for adds, removes, overages, and uncovered items
- clean invoice-ready outputs for later billing execution

What the base archetype should not force:

- exact invoice workflow
- exact export path
- exact accounting integration
- exact proration rules

## 10. Service Operations Workflow

The archetype should make service work context-aware.

Default workflow shape:

1. identify customer
2. identify site
3. identify affected CI when known
4. identify applicable agreement
5. apply SLA/routing/billing-readiness context

Implications:

- service records should not remain generic inbox items once the archetype is active
- CI context should be visible during ticket handling
- agreement context should influence response expectations
- recurring operational review work can be generated from estate signals

## 11. Customer Environment Graph

The MSP archetype should include a customer environment graph projected into Neo4j.

### 11.1 Architectural Rule

- Postgres/Prisma is authoritative
- Neo4j is a projection for traversal, reference, impact analysis, and visualization

### 11.2 Why A Separate Customer Graph Is Needed

MSPs manage customer environments as connected systems, not just lists of assets. Engineers need to answer:

- what is this CI connected to?
- what depends on this server?
- what devices belong to this site?
- what tickets have affected this environment?
- what agreement covers this estate?

### 11.3 What The Customer Graph Should Project

- customers
- sites
- managed assets/CIs
- CI-to-CI relationships
- dependency edges
- agreement coverage references
- ticket/change references
- status/lifecycle/security/backup metadata

### 11.4 What The Graph Enables

- visual CI maps
- impact analysis
- engineer reference views
- QBR and customer review support
- future graph-driven triage and recommendations

## 12. Internal Estate vs Customer Estate Separation

The platform must maintain a hard separation between:

- the MSP's own internal estate
- customer-managed estates

This separation must exist in:

- data model
- route context
- permissions
- reporting
- graph labels and queries
- automation rules
- billing preparation

The user experience can feel similar, but the domains must not be silently merged.

Recommended rule:

- internal company CIs remain in the internal infrastructure/discovery domain
- customer CIs live in the MSP customer-environment domain
- any relationship between the two must be explicit and typed, for example:
  - `MANAGES`
  - `MONITORS`
  - `BACKS_UP`
  - `CONNECTS_TO`

## 13. Portal And Archetype Load Behavior

When the MSP archetype is selected, the platform should:

1. activate MSP modules
2. seed MSP service defaults
3. apply MSP vocabulary and workflow defaults

Suggested seeded service categories:

- managed support
- help desk
- network monitoring
- endpoint/server management
- backup and disaster recovery
- cybersecurity
- cloud services
- Microsoft 365 / identity support
- projects / migrations
- compliance / assessments
- advisory / vCIO

The portal still matters, but the archetype must no longer be merely a storefront template.

## 14. Boundary Between Base Archetype And Customer Overlay

### 14.1 Base Platform Archetype

The shared archetype should own:

- the MSP operating model
- core entities and relationships
- agreement and schedule primitives
- service-desk linkage rules
- billing-readiness structures
- customer graph projection patterns
- recommended integration categories

### 14.2 Customer-Specific Overlay

A deployed customer instance can define:

- exact source-of-truth systems
- exact billing execution process
- exact vendor stack
- proprietary reporting
- franchise-specific operating procedures
- custom automations and prompts
- non-shareable commercial or operational logic

This preserves a strong shared archetype without overfitting the base product to a single customer.

## 15. Data Model Stewardship Implications

This design strongly suggests that the current archetype model is no longer enough on its own. The base platform will need a broader concept of archetype-driven module activation and possibly archetype capability profiles.

Potential refactoring direction:

- keep storefront archetype selection as the user-facing entry point
- add an internal `business profile activation` layer that can turn modules on/off and apply defaults
- allow one archetype to configure both portal behavior and internal operating modules

This avoids continuing to overload storefront-only templates with business-model responsibilities they were not designed to carry.

## 16. Related But Separate Epics

The following are required adjacent tracks, but should remain separate from this spec:

### 16.1 Site Location And Mapping

Needed because customer sites are first-class MSP records and require strong location/map capability.

### 16.2 Tax Remittance

Needed because service businesses still require tax readiness, but this is broader than the MSP archetype and should be reusable across multiple archetypes.

## 17. Recommended Epic

Create a new epic for this work rather than attaching it to the existing storefront foundation items.

Recommended epic title:

`EP-MSP-001 - Strong IT Service Provider / MSP Archetype`

Why a new epic:

- it crosses storefront, customer model, service operations, agreements, graph, and integration boundaries
- it is materially broader than item/vocabulary tweaks
- it needs phased rollout and architectural discipline

Suggested backlog breakdown:

1. archetype activation framework for stronger business profiles
2. customer sites as first-class records
3. managed assets / configuration items for customer estates
4. agreements and agreement schedules
5. service ticket linkage to customer/site/CI
6. billing readiness and recurring schedule preparation
7. customer environment Neo4j projection
8. internal-estate vs customer-estate separation in UX and permissions
9. MSP archetype setup defaults and seeded service catalog

## 18. Rollout Recommendation

### Phase 1

- stronger archetype activation model
- customer/site/CI foundation
- agreement and schedule primitives
- basic ticket linkage

### Phase 2

- billing-readiness outputs
- lifecycle/compliance posture fields
- customer environment graph projection

### Phase 3

- deeper automation
- more advanced graph-driven operations
- richer customer overlays and contribution-back patterns

## 19. Final Recommendation

The base platform should evolve the `IT service provider / MSP` archetype into a strong operating archetype.

That archetype should:

- activate real platform modules
- model customer sites and managed CIs explicitly
- support agreements, schedules, and billing preparation
- support service operations tied to customer environments
- project customer environments into a separate Neo4j graph
- preserve hard separation from the MSP's own internal CIs

This gives TeamLogic and similar businesses a credible base platform starting point, while preserving room for customer-specific overlays after deployment.
