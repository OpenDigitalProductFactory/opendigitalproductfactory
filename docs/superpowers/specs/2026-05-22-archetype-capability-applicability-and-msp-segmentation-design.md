# Archetype Capability Applicability And MSP Segmentation Design

**Date:** 2026-05-22
**Status:** Draft
**Author:** OpenAI Codex with user direction
**Related archetype:** `it-managed-services`
**Related docs:**
- `docs/superpowers/specs/2026-04-23-it-service-provider-msp-archetype-design.md`
- `docs/superpowers/plans/2026-04-23-msp-customer-estate-foundation.md`
- `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`
- `docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md`

## 1. Problem Statement

DPF needs business archetypes to activate different operating models without turning every feature into a global product assumption.

The MSP case makes the gap clear. A managed service provider such as TeamLogic IT has customers, and each customer has its own IT estate. That estate includes sites, networks, devices, users, services, backup posture, cybersecurity posture, licenses, tickets, projects, agreements, recurring billing inputs, and review obligations. Those are not universal requirements for every small business.

A hair salon, by contrast, may share some base capabilities such as customers, scheduling, payments, communications, and finance, but it usually takes payment at the time of service. It should not be forced through an agreement-centric recurring invoice model just because another archetype needs it.

The current platform has useful foundations, but they are too coarse:

- `packages/storefront-templates/src/types.ts` has `ActivationProfile.modules`, `billingReadinessMode`, `customerGraph`, and `estateSeparation`.
- `packages/storefront-templates/src/archetypes/professional-services.ts` gives `it-managed-services` a strong MSP activation profile.
- `apps/web/lib/storefront/archetype-activation.ts` validates and derives simple behavior from that profile.
- `packages/finance-templates/src/types.ts` has a category-level `recurringBillingEnabled` boolean.
- `packages/db/prisma/schema.prisma` already has `CustomerAccount`, `CustomerSite`, `CustomerConfigurationItem`, `Invoice`, and `RecurringSchedule`.
- `EdgeNode` and edge discovery exist, but node/discovery targeting is not yet customer/site scoped.

The missing architecture is an applicability contract: a governed way to say which capabilities apply to which archetypes, at which scope, with which UI/workflow defaults and isolation rules.

## 2. Live Backlog Context

Live DPF MCP reads were available on 2026-05-22. No DB fallback was used.

Relevant active overlap:

- `EP-EDGE-NODE`: Edge Node deployment, mTLS, telemetry, discovery, and collector work.
- `EP-SITE-7C4D2B`: first-class customer site records and location validation.
- `EP-CTRL-5E21A4`: automated control utility, including MSP-grade tenant isolation and consent for remote support.
- Existing edge backlog includes network telemetry and discovery paths that can become customer-estate inputs.
- Existing customer-site backlog gives MSP segmentation a concrete place to bind sites and locations.

Planning implication: do not create a standalone TeamLogic-only product island. Extend the shared archetype/profile layer, then let MSP-specific activation light up customer estate, edge-node customer deployment, service agreements, and billing-readiness workflows.

## 3. Research & Benchmarking

### 3.1 Target customer: TeamLogic IT Round Rock

The Round Rock TeamLogic site presents services across Managed IT Services, Co-Managed IT Services, Cybersecurity, Cloud Services, Business Continuity, Network Management, IT Consulting and Support, Productivity and Collaboration, IT Compliance, and Managed AI Services. The site also highlights 24/7 monitoring, proactive maintenance, help desk support, network visibility, business continuity, and cloud/identity/security services.

Sources:

- TeamLogic Round Rock home and service catalog: https://www.teamlogicit.com/rrtx
- Managed IT Services: https://www.teamlogicit.com/rrtx/Managed-IT-Services
- Cybersecurity: https://www.teamlogicit.com/rrtx/Cybersecurity
- Business Continuity: https://www.teamlogicit.com/rrtx/Business-Continuity
- Network Management: https://www.teamlogicit.com/rrtx/Network-Management
- Blog: BUDR foundation for business continuity: https://www.teamlogicit.com/rrtx/resources/what-makes-budr-the-foundation-of-business-continuity
- Blog: 24/7 endpoint and identity monitoring: https://www.teamlogicit.com/rrtx/resources/why-24-7-endpoint-and-identity-monitoring-now
- Blog: cloud computing as SMB operating infrastructure: https://www.teamlogicit.com/rrtx/resources/cloud-computing-the-road-to-growth

Adopted patterns:

- customer-by-customer managed estate
- 24/7 endpoint, identity, network, and backup monitoring
- local edge node per managed customer/site
- recurring service review and reporting
- agreement and coverage context around service delivery

### 3.2 Standards

NIST CSF 2.0 organizes cybersecurity outcomes around Govern, Identify, Protect, Detect, Respond, and Recover. MSP support should not be a generic ticket queue; it should make these functions visible through estate inventory, security posture, incidents, recovery readiness, and governance/reporting workflows.

CIS Controls v8.1 puts asset inventory and software inventory at the front of the control set. CIS Control 1 and 2 support the Edge Node direction: DPF should actively inventory enterprise assets, software, and unmanaged findings per customer estate.

Sources:

- NIST CSF 2.0 release: https://www.nist.gov/node/1840561
- NIST Cybersecurity Framework: https://www.nist.gov/cyberframework/index.cfm
- CIS Control 1: https://www.cisecurity.org/controls/inventory-and-control-of-enterprise-assets
- CIS Control 2: https://www.cisecurity.org/controls/inventory-and-control-of-software-assets

Adopted patterns:

- explicit inventory before protection/monitoring claims
- governed risk and evidence posture, not only device lists
- customer-scoped response and recovery records
- recurring review queues for assets, backup, identity, and security coverage

### 3.3 Open-source operating-model references

NetBox uses tenants to group resources for administrative purposes, commonly representing customers or internal departments. This supports a customer-scoped resource boundary without requiring every customer to be a separate installation.

GLPI combines inventory, CMDB, helpdesk, financial management, administration, entities, rules, SLAs, and automation. Its model supports keeping assets, tickets, financial information, and service processes tied together in one operational system.

Sources:

- NetBox tenants: https://netbox.readthedocs.io/en/stable/models/tenancy/tenant/
- GLPI features: https://www.glpi-project.org/en/features/

Adopted patterns:

- customer or tenant assignment on estate objects
- sites, devices, software, network devices, tickets, SLAs, rules, and financial context as connected operating records
- one instance can isolate multiple customer/entity groups

Rejected pattern:

- do not make Neo4j or topology projection authoritative for MSP records. Postgres remains authoritative; graph views are projections.

### 3.4 Commercial MSP/PSA references

NinjaOne agreement billing shows agreement templates, organization-specific agreements, billing intervals, support hours, products, devices, device backups, end users, and accounting sync as normal MSP billing concepts.

IT Glue configurations emphasize customer-scoped configuration records, interfaces, connected-to relationships, RMM/documentation overlays, and device types such as servers, firewalls, switches, routers, wireless access points, printers, PBX devices, UPS devices, workstations, mobile devices, and non-IP managed devices.

HaloPSA's guide catalog shows billing rules, agreements, contract schedules, invoice approvals, ready-for-invoicing, recurring invoice profiles, asset meters, subscription quantity automation, and customer/site/user records as standard PSA concerns.

Sources:

- NinjaOne agreement services billing: https://www.ninjaone.com/docs/professional-services-automation-psa/agreement-services-billing/
- IT Glue configurations: https://help.itglue.kaseya.com/help/Content/2-using/documentation-guide/configurations.html
- HaloPSA guide catalog: https://usehalo.com/halopsa/guides/1273/

Adopted patterns:

- agreement template plus customer-specific agreement
- billing interval and period boundary tracking
- billable unit sources such as devices, backups, users, seats, and services
- invoice-ready output separate from accounting execution
- configuration item relationships and external-source overlays

Rejected patterns:

- do not clone a full PSA in one iteration.
- do not hard-code one vendor's invoice workflow into DPF.
- do not make recurring invoices the default finance shape for every business.

## 4. Design Goals

1. Make archetypes activate operating capabilities, not just vocabulary and storefront defaults.
2. Let capabilities declare applicability per archetype: required, recommended, optional, hidden, or not applicable.
3. Make scope explicit for each capability: organization, customer account, customer site, configuration item, service agreement, engagement, appointment, order, billing period, or edge node.
4. For MSPs, enforce strict customer-estate segmentation inside the MSP organization.
5. Keep customer-estate segmentation reusable for other business models that manage external assets, sites, property, fleets, or members.
6. Replace the category-wide recurring billing boolean with payment and billing patterns.
7. Reserve implementation capacity for refactoring so this does not become a TeamLogic-specific patch.

## 5. Non-Goals

- Full multi-tenant customer portals for every MSP customer in this slice.
- Replacing PSA/RMM/documentation/accounting products end-to-end.
- Automating remote support actions before consent and authority design is complete.
- Building final invoice execution, payment collection, or accounting sync in the first applicability slice.
- Encoding TeamLogic franchise-only processes into shared product code.

## 6. Core Architecture Decision

Archetype behavior should be driven by a versioned `activationProfile` contract that names capabilities, applicability, scope, isolation, UI surfaces, workflow defaults, and billing/payment patterns.

Current model:

```ts
activationProfile.modules = ["customer-estate", "service-agreements", ...]
```

Target model:

```ts
activationProfile = {
  version: 2,
  profileType: "managed-service-provider",
  capabilities: [
    {
      capabilityKey: "customer-estate",
      applicability: "required",
      scopes: ["customer-account", "customer-site", "configuration-item"],
      isolation: "strict-customer-scope",
      surfaces: ["customers", "customer-estate", "edge-nodes", "lifecycle-reviews"],
      defaultWorkflows: ["estate-review", "coverage-gap-review"]
    }
  ],
  billingProfile: {
    primaryPaymentPattern: "recurring-agreement",
    supportedPaymentPatterns: ["recurring-agreement", "project-milestone", "ad-hoc-invoice"],
    invoiceExecutionMode: "prepared-not-prescribed"
  }
}
```

The first implementation should preserve compatibility with the current profile shape. `readActivationProfile` should normalize legacy profiles into a v2 runtime shape. Seed data can then be migrated gradually without breaking current archetype reset, marketing, TAK route context, and customer-estate helpers.

## 7. Key Terms

**Capability**

A platform function or module such as customer estate, service agreements, appointment checkout, recurring finance, edge node, remote support, lifecycle reviews, or customer portal.

**Applicability**

How a capability applies to an archetype:

- `required`: must be configured for the archetype to be operational.
- `recommended`: should be presented prominently but can be deferred.
- `optional`: available but not central.
- `hidden`: not shown by default but usable through admin/configuration.
- `not-applicable`: should not be offered because it creates the wrong operating model.

**Scope**

The domain boundary for data and workflows. Examples: `organization`, `customer-account`, `customer-site`, `configuration-item`, `service-agreement`, `appointment`, `order`, `billing-period`, `edge-node`.

**Isolation**

The enforcement posture for a capability. MSP customer estate requires `strict-customer-scope`; salon appointment checkout may only need `organization-scope`.

**Payment pattern**

The normal commercial motion for money. Examples: `point-of-sale`, `appointment-checkout`, `recurring-agreement`, `subscription`, `project-milestone`, `retainer`, `usage-based`, `donation`.

## 8. MSP Segmentation Decision

MSP customers should not become separate DPF tenants in the first implementation. They should be strict customer-scoped operating boundaries inside one MSP organization.

Rationale:

- The current platform already has `CustomerAccount`, `CustomerSite`, `CustomerConfigurationItem`, `Invoice`, and `RecurringSchedule`.
- The TeamLogic use case is primarily an MSP operator managing customer estates, not separate customer administrators running independent DPF installs.
- NetBox and GLPI both support customer/entity grouping inside one operational system.
- True tenant boundaries can be added later for external customer portals or customer-operated administration.

Required rules:

1. Every MSP estate object must resolve to a `CustomerAccount`.
2. Every site-bound object must resolve to a `CustomerSite`.
3. Edge Node enrollment for an MSP deployment must capture intended customer/site scope through an authority-issued bootstrap target, not by trusting request-body customer IDs.
4. Edge discovery submissions must derive customer/site scope from the authenticated node and its approved scope policy.
5. Credentials, integration connections, remote support sessions, and discovered topology must be customer-scoped.
6. Cross-customer views are allowed only in aggregate MSP operations views that never mix actionable row-level commands without a selected customer scope.
7. Customer portal access, if introduced later, should use Principal convergence and authorization policy, not a parallel customer identity table.

## 9. Capability Applicability Matrix

This is the target shape for first-class archetype applicability.

| Capability | MSP (`it-managed-services`) | Hair salon / beauty | Retail | HOA/property |
| --- | --- | --- | --- | --- |
| Customer accounts | required, customer scope | recommended, client scope | optional, loyalty/customer scope | required, member/property scope |
| Customer sites | required | optional | optional | required |
| Customer IT estate / CIs | required | not-applicable | optional for internal devices only | optional for property assets |
| Edge Node customer deployment | required for managed monitoring tiers | hidden | hidden | optional |
| Network inventory | required | hidden | hidden | optional for facilities |
| Cybersecurity posture | required | recommended for internal business IT | recommended for POS/store IT | recommended |
| Backup and restore posture | required | recommended for business systems | recommended for store systems | recommended |
| Service agreements | required | optional packages/memberships only | optional wholesale/account terms | required for management contracts |
| Recurring agreement billing | required/readiness | optional | optional | required |
| Appointment checkout | hidden | required | optional | not-applicable |
| Point-of-sale payment | optional | required | required | optional |
| Project work | required | optional | optional | required |
| Lifecycle review queues | required | optional for equipment | optional | required |
| Remote support | recommended, gated by consent | hidden | hidden | optional |

## 10. Billing And Invoicing Design

The platform should stop treating recurring billing as a category-level boolean.

Instead, finance profiles should expose payment and billing patterns:

```ts
type PaymentPattern =
  | "point-of-sale"
  | "appointment-checkout"
  | "ad-hoc-invoice"
  | "recurring-agreement"
  | "subscription"
  | "retainer"
  | "project-milestone"
  | "usage-based"
  | "donation";

interface BillingPatternProfile {
  primaryPaymentPattern: PaymentPattern;
  supportedPaymentPatterns: PaymentPattern[];
  invoiceExecutionMode: "none" | "manual" | "prepared-not-prescribed" | "automated";
  recurringBillingApplicability: "required" | "recommended" | "optional" | "not-applicable";
}
```

MSP default:

- primary pattern: `recurring-agreement`
- supported: `recurring-agreement`, `project-milestone`, `ad-hoc-invoice`, `usage-based`
- invoice execution: `prepared-not-prescribed`
- recurring applicability: `required`

Hair salon default:

- primary pattern: `appointment-checkout`
- supported: `appointment-checkout`, `point-of-sale`, `optional-package`
- invoice execution: `manual` or `none`
- recurring applicability: `optional`

This preserves the salon use case where payment happens in the building when service is rendered, while still allowing packages or memberships without making recurring invoices the main workflow.

## 11. Edge Node Role In MSP

The Edge Node is the local customer-estate collector and control point.

For MSP customers, install intent should be:

```text
MSP organization
  -> customer account
    -> customer site
      -> edge node
        -> discovery runs
        -> observed devices, software, identities, network topology, backups, security signals
```

Required product behavior:

- create a customer/site-scoped bootstrap token for each node install
- bind `EdgeNode` to a customer/site scope policy
- expose approved capabilities per scope, such as `discovery.network`, `discovery.software`, `metrics.host`, `metrics.network`, `backup.posture`, `identity.signal`
- map discovery runs into customer CIs and customer lifecycle queues
- prevent one customer node from submitting or querying another customer's estate

This fits the active Edge Node specs but adds the missing customer-estate target.

## 12. UI Model

The MSP UI should feel like an operational workbench, not a marketing page.

Required UI principles:

- customer selector is always visible in customer-estate and MSP operations surfaces
- cross-customer views are summary/triage only until a customer is selected
- site, estate, agreements, tickets, projects, backup, security, and billing readiness are tabs or sub-routes under a customer context
- action buttons are scope-aware and disabled when no customer/site context exists
- use icons and dense status chips for monitoring, backup, identity, network, and lifecycle state
- use DPF theme variables only; no hardcoded colors
- avoid explanatory blocks in the UI; explain through concise labels, status, empty states, and progressive setup

Suggested first MSP workspace shape:

```text
/customers
  customer list and lifecycle attention

/customers/[id]
  Overview | Sites | Estate | Edge Nodes | Agreements | Service Work | Projects | Backup | Security | Billing Readiness

/customers/[id]/sites/[siteId]
  Site Overview | Network | Devices | Software | Backups | Access | Edge Node
```

Setup should not ask the operator to understand the whole architecture. Selecting IT Managed Services should surface a concise checklist:

- customer accounts and sites
- edge node deployment
- managed asset inventory
- service agreements
- billing readiness
- backup and security posture

## 13. Refactoring Allocation

At least 20 percent of the first implementation capacity should be refactoring. The refactor is not cleanup theater; it is what prevents MSP behavior from becoming one-off conditionals.

Refactoring targets:

1. Move activation profile parsing and normalization into a shared profile contract instead of keeping all behavior in route-specific helpers.
2. Normalize legacy `modules` into v2 capability applicability records.
3. Replace finance `recurringBillingEnabled` call sites with derived billing pattern helpers while keeping the legacy boolean as compatibility output.
4. Add customer-estate scope helpers that force queries and actions to carry account/site context.
5. Keep archetype-specific UI copy and labels out of business logic; derive from profiles and vocabulary helpers.

## 14. Data Model Direction

First slice:

- keep `StorefrontArchetype.activationProfile Json?`
- add TypeScript contracts, validation, and normalizers
- update seeded archetype definitions
- derive UI/workflow behavior from normalized runtime profile
- no migration required unless persisted profile examples need backfill

Second slice:

- add customer/site scope policy fields for Edge Node and discovery connections
- prefer additive nullable fields first, then enforce with code-level guards and tests
- candidate additions:
  - `EdgeNode.customerAccountId`
  - `EdgeNode.customerSiteId`
  - `EdgeNode.scopePolicy Json`
  - `DiscoveryConnection.customerAccountId`
  - `DiscoveryConnection.customerSiteId`
  - `DiscoveryConnection.targetEdgeNodeId`

Later slice:

- promote stable capability profile records into first-class tables only after the JSON contract proves useful across multiple archetypes.

## 15. Acceptance Criteria

The planning and implementation track is successful when:

1. The MSP archetype declares customer estate, edge node deployment, service agreements, billing readiness, backup posture, cybersecurity posture, lifecycle reviews, and service operations through normalized capability applicability.
2. Beauty/salon archetypes do not inherit recurring invoice behavior as a default operating assumption.
3. Finance setup can distinguish point-of-sale, appointment checkout, recurring agreement, subscription, project milestone, retainer, and ad-hoc invoice patterns.
4. Edge Node MSP planning has a customer/site binding path.
5. Customer-estate actions and queries have a reusable scope helper.
6. UI plans use customer-scoped navigation and DPF theme rules.
7. No TeamLogic-only code path is introduced.

## 16. Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Feature flag sprawl | Use a typed capability applicability profile, not scattered booleans. |
| Customer data bleed | Scope helpers, server-side guards, edge auth scope, and tests. |
| Overbuilding tenancy too early | Use strict customer scope inside one MSP organization first; reserve true tenancy for external customer portals. |
| Finance model stays too blunt | Replace recurring boolean with payment/billing pattern profile. |
| UI becomes too generic | Use archetype profile to activate domain-specific work surfaces, not just labels. |
| Edge Node becomes internal-only | Add customer/site install intent and bootstrap target to the Edge Node roadmap. |

## 17. Recommended Next Slices

1. Implement activation profile v2 normalization and tests.
2. Update the MSP archetype and finance profile contract to express applicability and payment patterns.
3. Add a read-only setup/admin summary that shows what the selected archetype activates.
4. Add customer-estate scope helpers and tests.
5. Plan the Edge Node customer/site binding migration under `EP-EDGE-NODE` and `EP-SITE-7C4D2B`.
6. Plan service agreement billing-readiness records as the bridge to invoices, not full invoice execution.
