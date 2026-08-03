# Archetype Capability Applicability And MSP Segmentation Design

> **Authority notice (2026-08-01):** This historical design records as-implemented
> lineage. Its V3 workbook references have `undetermined` source-use status under
> `SUD-PORTFOLIO-WORKBOOK-V3-2026-08-01`; they are not current normative or AI evidence.
> Use current code and live data for observed state and the
> [Four-Portfolio Archetype and AI Workforce Operating Standard](../../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md)
> for target semantics and source-use controls.

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

### 3.5 Customer network topology and MSP scope references

NetBox models overlapping address space with VRFs. Its documentation describes each VRF as an independent routing table used to isolate customers or organizations and route overlapping spaces such as multiple 10.0.0.0/8 instances. NetBox tenants separately group resources for administrative purposes, usually customers or internal departments.

Auvik treats the network map as a central feature showing physical and logical connections, device status, IP address, interfaces, and connection details. Its ConnectWise Automate integration distinguishes an MSP client map from a client network map, and its site-type documentation ties network mapping and monitoring functionality to site-level plan availability.

N-able N-central documentation describes monitored devices as systems maintained for a customer, and its topology map is accessed at the customer or service-organization level. NinjaOne documentation similarly uses organizations and locations as management boundaries, with NMS device location changes constrained by organization and credential context.

Sources:

- NetBox VRFs: https://netbox.readthedocs.io/en/stable/models/ipam/vrf/
- NetBox tenants: https://netbox.readthedocs.io/en/stable/models/tenancy/tenant/
- Auvik network map: https://support.auvik.com/hc/en-us/articles/204908674-Your-network-map
- Auvik ConnectWise Automate client maps: https://support.auvik.com/hc/en-us/articles/360020807372-Using-the-plugin-with-ConnectWise-Automate-v11
- Auvik site types: https://support.auvik.com/hc/en-us/articles/360027698992-What-are-the-different-site-types
- N-able N-central devices: https://documentation.n-able.com/N-central/userguide/Content/Devices/Devices_Overview.html
- N-able N-central topology maps: https://documentation.n-able.com/N-central/userguide/Content/Configuration/Discovery_Jobs/View_Topology_Map.html
- NinjaOne organizations and locations: https://www.ninjaone.com/docs/endpoint-management/hardware-inventory/organizations-and-locations/
- NinjaOne NMS location movement: https://www.ninjaone.com/docs/network-management-system/moving-network-devices-between-locations/

Adopted patterns:

- customer and site scope are authoritative boundaries for network discovery and topology.
- overlapping private IP ranges must be valid when they occur under different customer/site scopes.
- a customer network map is an MSP/RMM operational surface, not a universal small-business feature.
- plan or service tier may affect which site-level network functions are available.

Rejected patterns:

- do not expose customer topology just because the platform can store scoped inventory.
- do not show a customer network workbench for non-MSP archetypes such as salons, retail shops, or appointment-service businesses.
- do not rely on global device/IP uniqueness and repair it later with filters.

### 3.6 Historical input: 4-portfolio taxonomy workbook

The 2026-05-22 design used
`docs/Reference/4_portfolio_Reworked_V3_Definitions_IT4IT.xlsx` as a working input for a four-sheet
portfolio decomposition and operating-model axes. Its source-use status is now `undetermined`, so it
is neither current authority nor admissible evidence for those semantics.

The durable implementation outcome is the typed registry in
`packages/storefront-templates/src/types.ts` and the current archetype records. The FPAW standard now
owns four-portfolio meaning and source-use controls. New closed-axis values widen the typed registry
through the governed enum/migration process; they are not proposed to this workbook first.

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

Archetype behavior should be driven by an `activationProfile` contract that names **operating-model axes**, **portfolio roles**, and **capability applicability rules** — in that order of authority. Per-capability records (scope, isolation, surfaces, billing pattern) are *derived* from the axes + portfolios via a named rule set; they should not be hand-authored per (capability × archetype).

This is a deliberate inversion of the obvious approach. A flat `(archetype → capabilities[])` table
works for two or three archetypes; it collapses under its own weight at ten. The historical design
used axis-plus-portfolio factoring; current authority for that factoring is the typed code and FPAW,
not the unresolved workbook.

Current model:

```ts
activationProfile.modules = ["customer-estate", "service-agreements", ...]
```

Target model:

```ts
activationProfile = {
  axes: {
    form: "services",                       // goods | services
    delivery: "hybrid",                     // digital | physical | hybrid
    primaryConsumer: "business",            // individual | business | household | patient | channel-partner | internal
    consumptionChannel: "portal+onsite",
    commercialModel: "recurring-agreement", // see §10
    provisioning: "account-and-entitlement",
    platform: "no"                          // is this a platform/ecosystem play
  },
  portfolios: {
    foundational:           { scope: "minimal" },
    manufactureAndDeliver:  { scope: "primary", it4itStages: ["detect-to-correct", "deploy-to-operate", "request-to-fulfill"] },
    forEmployees:           { scope: "standard" },
    productsAndServicesSold:{ scope: "primary", offerings: [/* taxonomy refs */] }
  },
  capabilityOverrides: [
    // Only here when the rules-engine output is wrong for a specific archetype.
    // Empty for most archetypes. Required overrides are visible in code review.
    { capabilityKey: "remote-support", applicability: "recommended", reason: "consent gating not yet automated" }
  ],
  billingProfile: { /* derived from axes.commercialModel — see §10 */ }
}
```

The first implementation should preserve compatibility with the current profile shape. `readActivationProfile` should normalize legacy profiles by *inferring* axes and portfolios from the existing `modules`/`billingReadinessMode`/`customerGraph`/`estateSeparation` fields. Seed data migrates gradually without breaking archetype reset, marketing, TAK route context, or customer-estate helpers.

No `version` field and no `profileType` discriminator. The presence of `axes`/`portfolios` is the discriminator; the legacy shape continues to be recognized by the absence of those keys. If a future incompatible change becomes necessary, add the version field then — not speculatively now.

Survival rule for legacy callers: when `readActivationProfile` encounters a profile without `axes`/`portfolios`, the normalizer must populate sensible defaults for both (inferred from `modules`/`billingReadinessMode`/`customerGraph`/`estateSeparation`) before returning. Downstream consumers — including rules-engine evaluation, the §13 Capability Registry, and `getCapabilityActivation` — therefore never have to branch on "axes present" vs "axes absent". Legacy seed data ages out gradually; no flag-day cutover.

### 6.5 Operating-Model Axes

Each archetype is classified along a small set of orthogonal axes. Capability applicability, default
scope, and billing pattern are *derived* from these axis values, not declared per archetype. The
current value vocabularies are owned by the typed registry; the workbook column names below are
historical lineage notes, not current source authority.

| Axis | Values (initial) | Current DPF authority |
| --- | --- | --- |
| `form` | `goods`, `services` | `types.ts` `ProductForm` |
| `delivery` | `digital`, `physical`, `hybrid` | `types.ts` `DeliveryMode` |
| `primaryConsumer` | `individual`, `household`, `business`, `patient-and-payer`, `channel-partner`, `internal` | `types.ts` `PrimaryConsumer` |
| `consumptionChannel` | `physical`, `web-app`, `portal-api`, `sales-assisted`, `onsite-plus-portal`, … | `types.ts` `ConsumptionChannel` |
| `commercialModel` | `transactional`, `subscription`, `recurring-agreement`, `usage-based`, `account-based-fees`, `encounter-based`, `appointment-checkout`, `point-of-sale`, `hybrid` | `types.ts` `CommercialModel` |
| `provisioning` | `none`, `account-with-billing`, `account-and-entitlement`, `account-with-kyc`, `device-bound`, `episode-of-care` | `types.ts` `ProvisioningModel` |
| `platform` | `no`, `yes-marketplace`, `yes-developer` | `types.ts` `PlatformModel` |

Rules engine examples (illustrative, not exhaustive):

- `axes.primaryConsumer === "business" && portfolios.manufactureAndDeliver.scope === "primary"` → `customer-estate.applicability = required`, `scopes = ["customer-account", "customer-site"]`, `isolation = "strict-customer-scope"`.
- `axes.commercialModel === "recurring-agreement"` → `service-agreements.applicability = required`, `billingProfile.primaryPaymentPattern = "recurring-agreement"`, `billingProfile.invoiceExecutionMode = "prepared-not-prescribed"`.
- `axes.commercialModel === "appointment-checkout"` → `appointment-checkout.applicability = required`, `recurring-agreement-billing.applicability = optional`.
- `axes.delivery !== "physical" && portfolios.manufactureAndDeliver.it4itStages.includes("detect-to-correct")` → `edge-node-customer-deployment.applicability = required`.

The rule set is short, code-reviewed, and lives next to the capability registry (see §13). An archetype that needs to override a derived applicability uses `capabilityOverrides` with a stated reason — visible in PR review so deviations don't accumulate silently.

### 6.6 Historical portfolio-decomposition implementation

The implementation introduced four local portfolio-role keys. Current FPAW semantics apply them to
governed aspects of business goods, services, DigitalProducts, workforce contribution, physical and
digital delivery, and shared foundations; the historical workbook is not the authority.

| Portfolio | What it contains | Primary axis the rules engine reads |
| --- | --- | --- |
| **Foundational** | Compute, storage, network, identity, data fabric — substrate the business runs on | `delivery`, `provisioning` |
| **Manufacture & Deliver** | specialized creation and delivery means, plus legacy local lifecycle metadata pending convergence | `commercialModel`, `it4itStages` |
| **For Employees** | Internal-facing tooling (TBM business capabilities such as Corp Comms, Finance, HR, Sales) | `primaryConsumer === internal`, headcount-scale heuristics |
| **Products & Services Sold** | The external commercial offer — what the customer pays for | `form`, `primaryConsumer`, `commercialModel`, `consumptionChannel`, `platform` |

Each archetype declares the **scope** of each portfolio (`absent` / `minimal` / `standard` / `primary`) and, for the *primary* portfolios, which sub-elements are required.

Worked examples:

- **MSP (`it-managed-services`)**: `manufactureAndDeliver` and `productsAndServicesSold` are
  *primary*. Sold managed services are realized through customer-estate operating and delivery work;
  legacy lifecycle labels are migration metadata, not external mappings. `forEmployees` is
  *standard*. `foundational` is *minimal* (it is not infrastructure-as-product).
- **Hair salon**: `productsAndServicesSold` is *primary*; `manufactureAndDeliver` and `forEmployees` are *minimal*; `foundational` is *minimal* (POS substrate only). No customer-estate falls out of the rules; appointment-checkout does.
- **Retail**: `productsAndServicesSold` primary, with `form = goods` and `consumptionChannel = web-app` or `physical` flipping the activated surfaces (e-commerce vs in-store POS).
- **HOA / property mgmt**: `productsAndServicesSold` primary with `commercialModel = recurring-agreement`, plus a managed external estate (sites/property) — which means *customer-estate falls out of the same rule that activates it for MSP*, demonstrating the architecture's reusability.

The rules engine reads axes + portfolios and produces the runtime capability set. This is what scales: adding the 50th archetype is a row of axis values and a portfolio mix, not a column of hand-curated capability flags.

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

**Ownership scope** (where does the row live, who can see it)

`organization`, `customer-account`, `customer-site`, `configuration-item`, `edge-node`.

**Transaction context** (what work-event bound this row)

`service-agreement`, `engagement`, `appointment`, `order`, `billing-period`, `episode-of-care`.

These were a single enum in earlier drafts. They have been split because they answer different questions: ownership scope drives row-level authorization and isolation; transaction context drives reporting roll-ups and billing-readiness joins. Conflating them broke down as soon as scope policy met server-action guards.

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

### 8.1 Customer Topology Isolation

Network topology is the strongest proof that customer scope cannot be a presentation-layer filter. Many small-business customers will use the same private address ranges (`192.168.1.0/24`, `10.0.0.0/24`, default gateway `192.168.1.1`) and may even use the same hardware vendors, hostnames, SSIDs, or device model identifiers. Those values are only natural identifiers **inside one customer estate scope**.

Applicability gate:

Customer network topology is not a universal portal route. It appears only when the normalized activation profile proves an MSP-style managed-network operating model:

- `customer-estate.applicability === "required"`
- `customer-estate.isolation === "strict-customer-scope"`
- `network-inventory.applicability === "required"`
- `network-inventory.isolation === "strict-customer-scope"`
- `edge-node-customer-deployment.applicability === "required"`

The initial built-in archetype that satisfies this gate is `it-managed-services`. Future archetypes can qualify only by deriving the same required capability combination from axes and portfolio roles; UI code must not compare raw `archetypeId` values to the MSP string. Non-MSP archetypes may still have organization-internal device inventory, security posture, backup posture, or facilities records, but they must not see a customer-estate network topology workbench unless their operating model is reclassified as MSP-style managed-network work.

Required topology invariants:

1. A customer-estate topology view must start from a `TopologyScopeContext`, not from a global graph plus client-side filters.
2. `TopologyScopeContext` has three legal modes:
   - `organization-internal`: the MSP's own DPF/internal estate.
   - `customer-account`: one `CustomerAccount`, all active sites unless further narrowed.
   - `customer-site`: one `CustomerSite` under one `CustomerAccount`.
3. Customer topology queries must require `customerAccountId`. `customerSiteId` is optional only when the operator intentionally wants all sites for one customer.
4. IP address, MAC address, hostname, LLDP system name, controller device id, SSID, serial number, and adapter-specific observed keys must never be treated as globally unique across customers.
5. Persisted inventory identity must include the topology scope. The persisted `InventoryEntity.entityKey` is composed as `<scopeKey>:<entityType>:<naturalKey>`, where `scopeKey` is the discovery scope (per invariant 2), `entityType` is the canonical entity type (e.g. `host`, `gateway`), and `naturalKey` is the attribution-source-prefixed raw observed key (e.g. `arp:192.168.1.1`). The `arp:` / `dns:` / `lldp:` prefixes inside `naturalKey` identify the attribution source and are not part of the scope grammar; only the leading `customer:.../site:...` / `organization:internal` segment carries scope. Examples:

   ```text
   customer:<customerAccountId>:site:<customerSiteId>:host:arp:192.168.1.1
   customer:<otherCustomerAccountId>:site:<otherCustomerSiteId>:host:arp:192.168.1.1
   organization:internal:host:arp:192.168.1.1
   ```

6. `InventoryRelationship.relationshipKey` must be derived from scoped endpoint keys plus relationship type. A relationship whose endpoints resolve to different topology scopes is invalid unless a future, explicitly reviewed cross-scope relationship type is introduced.
7. Stale detection must be scope-local. A discovery run for Customer A must only compare against Customer A's previous inventory keys; it must not mark Customer B's devices or the MSP's internal devices stale.
8. Neo4j topology projection is a read model. It must carry `scopeKey`, `customerAccountId`, and `customerSiteId` properties and every graph query must filter on those properties. Postgres remains authoritative.
9. Cross-customer MSP dashboards may show aggregate counts, health, and alerts. They must not render row-level device graphs or command buttons until a customer scope is selected.
10. The UI must make the active scope visible in the topology workbench header: customer name, site name when selected, edge node source, and last discovery run. Internal MSP topology must be an explicit mode, not the default inside customer work.

Worked example:

```text
Customer A, Site Austin:
  observed gateway: arp:192.168.1.1
  persisted entityKey: customer:cust_a:site:site_austin:host:arp:192.168.1.1

Customer B, Site Round Rock:
  observed gateway: arp:192.168.1.1
  persisted entityKey: customer:cust_b:site:site_round_rock:host:arp:192.168.1.1

MSP internal office:
  observed gateway: arp:192.168.1.1
  persisted entityKey: organization:internal:host:arp:192.168.1.1
```

Those are three different devices. Any implementation that collapses them because the IP address matches is a customer-data isolation defect.

## 9. Capability Applicability Matrix (worked examples)

**This table is a rendered view of the rules engine output, not the source of truth.** It exists to make the design legible and to serve as fixtures for the applicability tests. The actual applicability is derived from the axes + portfolio decomposition in §6.5/§6.6 — adding a new archetype must not require editing this table; it must come out of the rules.

If a row below disagrees with what the rules engine produces, the rules engine wins. The fix is either an `capabilityOverride` on the archetype (with stated reason) or a refinement of the rules — not a hand-edit of this table.

| Capability | MSP (`it-managed-services`) | Hair salon / beauty | Retail | HOA/property |
| --- | --- | --- | --- | --- |
| Customer accounts | required, customer scope | recommended, client scope | optional, loyalty/customer scope | required, member/property scope |
| Customer sites | required | optional | optional | required |
| Customer IT estate / CIs | required | not-applicable | optional for internal devices only | optional for property assets |
| Edge Node customer deployment | required for managed monitoring tiers | hidden | hidden | optional |
| Network inventory | required, customer topology enabled | hidden | hidden | optional internal/facilities only; no customer topology workbench |
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
- customer network topology routes are visible only when `canUseCustomerNetworkTopology(profile)` returns true from normalized capability activations
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

`Network` in the site route is conditional. For MSP-type profiles it is the customer topology workbench. For salons, retail, and other non-MSP archetypes it is absent from customer/site navigation; any internal device inventory remains under organization-internal operations, not under customer context.

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
2. Normalize legacy `modules` into the axis-derived capability applicability records (see §6.5).
3. Replace finance `recurringBillingEnabled` call sites with derived billing pattern helpers while keeping the legacy boolean as a compatibility output marked for removal once call sites migrate.
4. Add customer-estate scope helpers that force queries and actions to carry account/site context.
5. Keep archetype-specific UI copy and labels out of business logic; derive from profiles and vocabulary helpers.
6. Stand up a **Capability Registry** (see §14) as the single source of truth for legal `capabilityKey` values, their IT4IT value-stream stage, their default ownership scope, and their portfolio. Every consumer imports from it instead of carrying its own string union.

## 14. Data Model Direction

First slice:

- keep `StorefrontArchetype.activationProfile Json?`
- add TypeScript contracts, validation, and normalizers
- add the **Capability Registry** as a code-resident record: a single typed map keyed by `capabilityKey` declaring `portfolio`, `it4itStage` (nullable), `defaultOwnershipScope`, `defaultIsolation`, and `surfaces`. Imported by archetype definitions, server actions, and the activation summary component. No DB table yet — promote only when a second platform install needs to extend it.
- update seeded archetype definitions to use **axes + portfolios + (optional) overrides**, not a flat capabilities array.
- derive UI/workflow behavior from normalized runtime profile via the rules engine in §6.5.
- no migration required unless persisted profile examples need backfill.

Current customer-scope foundation already landed after this spec was first drafted:

- `EdgeNode.customerAccountId`
- `EdgeNode.customerSiteId`
- `EdgeNode.scopePolicy Json`
- `BootstrapToken.targetCustomerAccountId`
- `BootstrapToken.targetCustomerSiteId`
- `BootstrapToken.scopePolicy Json`
- `DiscoveryConnection.customerAccountId`
- `DiscoveryConnection.customerSiteId`
- `DiscoveryConnection.targetEdgeNodeId`
- `DiscoveryRun.customerAccountId`
- `DiscoveryRun.customerSiteId`

Next topology-isolation slice:

- add `TopologyScopeContext` helpers for organization/internal, customer-account, and customer-site modes.
- add customer/site/scope metadata to `InventoryEntity` and `InventoryRelationship`.
- derive `InventoryEntity.entityKey` and `InventoryRelationship.relationshipKey` from scope-qualified natural keys for customer-estate discovery.
- make discovery stale detection scope-local.
- filter Neo4j projection and graph server actions by `scopeKey` before data reaches `TopologyGraph`.
- add duplicate private-IP tests proving Customer A, Customer B, and MSP internal devices remain distinct.

Later slice:

- promote stable capability profile records into first-class tables only after the JSON contract proves useful across multiple archetypes.

## 15. Acceptance Criteria

The planning and implementation track is successful when:

1. The MSP archetype declares its operating model through **axes + portfolios**, and customer estate / edge node / service agreements / billing readiness / backup / cybersecurity / lifecycle / service operations fall out of the rules engine — not from a hand-authored capability list keyed by archetype id.
2. Beauty/salon archetypes do not inherit recurring invoice behavior as a default operating assumption. The same rules engine produces the salon's capability set from its axis values.
3. Adding a third archetype (e.g., HOA/property management) requires *zero* edits to the §9 example table and zero hand-curated capability rows — only axis values and portfolio scope declarations.
4. Finance setup can distinguish point-of-sale, appointment checkout, recurring agreement, subscription, project milestone, retainer, and ad-hoc invoice patterns, and the billing profile is derived from `axes.commercialModel`.
5. Edge Node MSP planning has a customer/site binding path.
6. Customer-estate actions and queries have a reusable scope helper that consumes the normalized profile, not the raw archetype id.
7. UI plans use customer-scoped navigation and DPF theme rules.
8. No TeamLogic-only code path is introduced, and no raw archetype-id conditional appears in feature code.
9. Two customers with the same private subnet, gateway IP, hostnames, and adapter observed keys produce separate `InventoryEntity`, `InventoryRelationship`, Neo4j `InfraCI`, and topology graph records.
10. A customer-scoped discovery run cannot mark another customer's devices, another customer's relationships, or the MSP internal estate stale.
11. Customer network topology surfaces are hidden for non-MSP archetypes, including hair salon and retail profiles, even though the platform can still use organization-internal inventory and posture helpers for those businesses.

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

1. Land the **Capability Registry** + **operating-model axis enums** + **portfolio decomposition types** as the shared contract. Tests cover the rules engine producing MSP, salon, retail, and HOA capability sets from axis values alone.
2. Implement activation profile normalization (legacy `modules` → axes/portfolios/derived capabilities) and the compatibility helpers consumers still need.
3. Update the MSP and beauty archetype definitions to use the new shape; assert that all the §9 example rows are produced by the rules engine, not by hand-edits.
4. Update the finance profile contract to derive payment patterns from `axes.commercialModel`. Mark `recurringBillingEnabled` deprecated and track migration of call sites in the PR.
5. Add a read-only setup/admin summary that shows what the selected archetype activates, sourced from the runtime profile.
6. Add customer-estate scope helpers and tests, consuming the normalized profile.
7. Plan the Edge Node customer/site binding migration under `EP-EDGE-NODE` and `EP-SITE-7C4D2B` as its own spec.
8. Plan service agreement billing-readiness records as the bridge to invoices, not full invoice execution.
