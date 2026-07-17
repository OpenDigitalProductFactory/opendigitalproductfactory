# Software Asset Management Phase C - Entitlements, ELP, Usage Reclamation, and SaaS Management

**Date:** 2026-07-17
**Status:** Draft for founder sign-off - spec + backlog decomposition only, no build
**Epic:** EP-ASSET-INTELLIGENCE
**Parent roadmap BIs:** BI-E454034B, BI-55756F66, BI-30151E25
**Predecessor spec:** [2026-07-16 Software & Asset Intelligence Enrichment](2026-07-16-software-asset-intelligence-enrichment-design.md)
**Kernel decision:** DI-3CBA1886314C - choose `extend-existing-spines` over a parallel SAM domain or external-SAM-first bridge

## 1. Purpose

Phase A/B gave DPF the identity and lifecycle substrate that commercial SAM products depend on: `CatalogIdentity`, lifecycle milestones, CPE crosswalk, SBOM bridge, identity-resolution logs, enrichment tools, and the catalog sweep. Phase C starts the proprietary moat: software license entitlement, license rights, usage metering, reclamation, and SaaS discovery.

This is not a quick build. The three existing roadmap BIs are intentionally large:

- **BI-E454034B:** license entitlement and compliance, Effective License Position (ELP), contracts, true-up.
- **BI-55756F66:** reclamation and usage metering.
- **BI-30151E25:** SaaS management through OAuth grants, SSO logs, and expense-feed discovery.

Founder sign-off is required before implementation. The sequencing is steered here; the build comes later.

## 2. Reference Model

The reference products and standards converge on one workflow:

1. Normalize software identity.
2. Capture purchases, contracts, and software entitlements.
3. Express entitlement rights with license metrics and publisher-specific rules.
4. Measure installations and usage.
5. Reconcile consumption against rights into an ELP.
6. Produce true-up, optimization, renewal, reclamation, and audit evidence.

Flexera positions FlexNet Manager / Flexera One ITAM around current license positions, product-use rights, usage metering, license reclamation, contracts, and hybrid software compliance. See [Flexera FlexNet Manager](https://www.flexera.com/products/flexnet-manager), [Flexera One ITAM](https://www.flexera.com/products/flexera-one/it-asset-management), and [Flexera SaaS Management](https://www.flexera.com/products/flexera-one/saas-management).

ServiceNow SAM exposes the same primitives: software entitlements, allocations, license metrics, reconciliation, ELP reports, publisher packs, reclamation, and SaaS License Management. Publisher packs cover complex vendor logic such as Microsoft, Oracle, SAP, IBM, Adobe, Citrix, and VMware. See [ServiceNow SAM](https://www.servicenow.com/docs/r/it-asset-management/software-asset-management/c_SoftwareAssetMgmt.html), [software license metrics](https://www.servicenow.com/docs/r/it-asset-management/software-asset-management/c_SAMLicenseMetrics.html), [publisher packs](https://www.servicenow.com/docs/r/xanadu/it-asset-management/software-asset-management/sam-publisher-packs.html), and [Microsoft publisher pack](https://www.servicenow.com/docs/r/it-asset-management/software-asset-management/microsoft-publisher-pack.html).

ISO/IEC 19770 gives the standards frame:

- **19770-1:** requirements for an IT asset management system. See [ISO/IEC 19770-1:2017](https://www.iso.org/standard/68531.html).
- **19770-2:** software identification tags, aligning with the identity spine already represented by `CatalogIdentity` and SBOM/PURL/CPE inputs.
- **19770-3:** entitlement schema for software entitlements, usage rights, metrics, and management. See [ISO/IEC 19770-3:2016](https://www.iso.org/standard/52293.html).
- **19770-4:** resource utilization measurement, matching Phase C's usage-metering lane. The ISO catalogue lists it as "IT asset management - Part 4: Resource utilization measurement" in the 19770 family.
- **19770-5:** overview and vocabulary. See [ISO/IEC 19770-5](https://www.iso.org/standard/55999.html).

## 3. Substrate Verification

The required DPF-first audit found existing substrate that Phase C must reuse:

| Area | Existing substrate | Phase C verdict |
| --- | --- | --- |
| Normalized software identity | `CatalogIdentity`, `CatalogLifecycleMilestone`, `IdentityResolutionLog`, `DiscoveryFingerprintRule`; `InventoryEntity.catalogIdentityId`; `BomComponent.catalogIdentityId` | Reuse as the licensable software identity spine. Do not create a parallel software-title table. |
| Product / estate scope | `DigitalProduct`, `InventoryEntity`, `DiscoveredSoftwareEvidence`, `DiscoveryConnection` | Reuse for installed and discovered software consumption. |
| Assurance and compliance findings | `AssuranceFinding` | Reuse for underlicensed, overlicensed, inactive-paid-seat, renewal-risk, shadow-SaaS, and reclamation findings. No SAM finding table. |
| Supplier and contract scaffold | `Supplier`, `SupplierContract`, `ContractAllowance`, `ContractUsageSnapshot`, `Bill`, `ExpenseClaim`, `ExpenseItem` | Extend carefully. Current contracts are finance/AI-provider shaped but already generalized enough to avoid a parallel contract repository. |
| Regulatory licensing readiness | `OrganizationLicenseProfile`, `LicenseRequirementReference`, `OrganizationLicenseRecord`, `PersonLicenseRecord`, `LicenseReadinessIssue` | Do not reuse for SAM entitlements. This is jurisdiction/permit/credential readiness, not software usage rights. |
| Integrations / SaaS feeds | `IntegrationCredential`, `IntegrationToolCallLog`, OAuth helpers, `DiscoveryConnection`, QuickBooks import staging, native integration catalog | Reuse as the integration substrate for OAuth grant, SSO, admin API, and expense-feed discovery. |
| Action execution | `RemoteAction` and governed execution path | Reuse for uninstall/reclaim/removal requests. Never auto-mutating. |
| Backlog | EP-ASSET-INTELLIGENCE plus BI-E454034B, BI-55756F66, BI-30151E25 | Keep the three existing items as parent roadmap lanes and file smaller child implementation BIs. |

Code graph caveat: the MCP code graph is currently low-trust for this topic, indexed from a dirty `my-changes` snapshot and missing structural relationships. Direct `origin/main` source and live backlog were treated as authoritative.

## 4. Kernel-Steered Architecture Choice

`dpf-brainstorming` produced three viable strategies:

1. **Extend existing spines** - add only missing SAM domain models while reusing `CatalogIdentity`, `DigitalProduct`, `SupplierContract`, integration credentials, expense data, RemoteAction, and `AssuranceFinding`.
2. **SAM parallel domain** - create a self-contained SAM schema and bridge to DPF at reporting time.
3. **External SAM bridge first** - defer native modeling and import opaque ELP summaries from Flexera/ServiceNow-style tools.

`dpf-decision-via-kernel` selected **extend existing spines** with high confidence, composite 9.96 and margin 4.23. No commandment conflict fired. This is the binding design direction unless founder review overrides it.

## 5. Data Model Direction

Phase C should add the missing SAM concepts as first-class models, but each must anchor to existing DPF spines.

### 5.1 Entitlement and Rights

Add a SAM entitlement model family whose canonical unit is not "a license document" but "a right to use a `CatalogIdentity` under a metric and rule set."

Candidate models:

- `SoftwareEntitlement` - purchased/subscribed right, linked to `CatalogIdentity`, `Supplier`, optional `SupplierContract`, optional `BillLineItem`/`ExpenseItem` evidence, effective dates, quantity, metric, region, tenant, renewal window, source, confidence.
- `SoftwareEntitlementAllocation` - who/what the entitlement is allocated to: `Principal`, `EmployeeProfile`, `InventoryEntity`, `DigitalProduct`, device group, or SaaS account.
- `SoftwareLicenseMetric` - normalized metric vocabulary: per-device, per-user, named-user, concurrent, core, processor, vCPU, install, tenant, consumption, subscription, custom.
- `SoftwarePublisherRule` - DPF-authored overlay for top vendors only. Links to `CatalogIdentity` or publisher family, describes consumption formula, downgrade/upgrade rights, virtualization/cloud/BYOL constraints, bundle/suite rules, and evidence requirements.
- `SoftwareEntitlementDocument` or document link - optional pointer to the existing document/artifact substrate, not a new document store.

Rules are hand-curated for top vendors first. The non-goal remains intact: DPF will not clone Flexera's Product Use Rights catalog or ServiceNow publisher-pack breadth.

### 5.2 Consumption and ELP

Add a reconciliation read/write layer:

- `SoftwareConsumptionSnapshot` - observed consumption at a point in time, linked to `CatalogIdentity`, `InventoryEntity`, `DigitalProduct`, and evidence source. It stores observed installs, active users, usage events, cores/vCPU, SaaS seats, or vendor-specific units.
- `SoftwareEffectiveLicensePosition` - reconciliation result per `CatalogIdentity` + organization/scope + period: entitled quantity, consumed quantity, delta, compliance state, estimated true-up cost, reclaimable quantity, confidence, evidence.
- `SoftwareReconciliationRun` - batch/run envelope for ELP calculations, with source counts and rule versions used.

ELP writes `AssuranceFinding` rows for actionable deltas:

- `software-underlicensed`
- `software-overlicensed`
- `software-unallocated-use`
- `software-inactive-paid-seat`
- `software-renewal-risk`
- `shadow-saas-detected`

The finding evidence links back to the ELP row and the consumption/entitlement rows used.

### 5.3 Usage and Reclamation

Usage metering must distinguish a measured observation from a recommendation:

- `SoftwareUsageObservation` - raw or normalized usage event/aggregate: last used, launch count, active minutes, API consumption, SSO login, SaaS admin activity, or license-server checkout.
- `SoftwareReclamationCandidate` - derived recommendation with savings estimate, confidence, user/business-owner context, approval state, and `RemoteAction` link when the candidate becomes an uninstall/remove-seat request.

Reclamation starts as recommendation-only. Any uninstall, deprovisioning, or SaaS seat removal goes through `RemoteAction` with approval and audit evidence.

### 5.4 SaaS Management

SaaS management is an evidence-fusion problem. The model should avoid a parallel SaaS app catalog by projecting SaaS apps onto `CatalogIdentity` and `DigitalProduct` where possible.

Add:

- `SaasApplicationAccount` - one observed SaaS app/account/tenant, linked to `CatalogIdentity` where normalized and `Supplier` where vendor-known.
- `SaasUserSeat` - principal/email/account seat state: assigned, active, suspended, external, unknown.
- `SaasDiscoverySignal` - OAuth grant, SSO login, expense/payments, admin API, browser/domain, manual confirmation. Carries source, timestamp, evidence, and confidence.

Inputs:

- OAuth grants/scopes from connected identity providers and SaaS admin APIs.
- SSO/SAML/OIDC login logs where available.
- Expense and bill line descriptions for shadow IT discovery.
- Native integration catalog and future connectors.

Outputs:

- SaaS identities and seats flow into `SoftwareConsumptionSnapshot`.
- Shadow IT and inactive paid seats become `AssuranceFinding` rows.
- Confirmed subscriptions link to `SupplierContract` and `SoftwareEntitlement`.

## 6. Phased Backlog Decomposition

The existing parent BIs remain the initiative lanes. The following child BIs should be created under EP-ASSET-INTELLIGENCE and reference their parent in the body until DPF has structured child-BI relations.

### C0 - Stewardship and Data Contracts

**BI-DC51DB7B:** SAM Phase C0: model stewardship and standards mapping
**Size:** medium
**Parent:** BI-E454034B
**Acceptance:** model proposal maps each new concept to ISO/IEC 19770-1/3/4, Flexera/ServiceNow reference primitives, and existing DPF substrates; it names enum vocabularies and privacy boundaries before any migration.

### C1 - Entitlement Foundation

**BI-A19FE7A2:** SAM entitlement foundation: rights, metrics, allocations, and contract linkage
**Size:** large
**Parent:** BI-E454034B
**Acceptance:** `SoftwareEntitlement`, metric vocabulary, allocation model, and contract/procurement evidence links exist; sample entitlements can be imported manually and linked to `CatalogIdentity`.

### C2 - Publisher Rule Overlay

**BI-9DFFBE01:** SAM publisher-rule overlay v1 for top vendors
**Size:** large
**Parent:** BI-E454034B
**Acceptance:** hand-curated rule framework supports Microsoft, Adobe, Oracle, SAP, and VMware seed packs at shallow-but-auditable depth; rules are versioned, evidence-backed, and scoped to DPF-authored coverage, not a proprietary catalog clone.

### C3 - ELP Engine

**BI-5E850F77:** Effective License Position engine and true-up findings
**Size:** large
**Parent:** BI-E454034B
**Acceptance:** reconciliation run reads entitlements, publisher rules, installed/usage consumption, and contract price hints; writes `SoftwareEffectiveLicensePosition`; creates/updates `AssuranceFinding` rows for underlicense, overlicense, true-up, and renewal risk.

### C4 - Usage Metering

**BI-F2ADD851:** Software usage observation pipeline for reclamation
**Size:** large
**Parent:** BI-55756F66
**Acceptance:** usage observations ingest from inventory/discovery, app telemetry where present, SSO logs, and SaaS admin APIs; privacy classification and retention policy are explicit; snapshots feed ELP and reclamation.

### C5 - Reclamation Workflow

**BI-47D7D670:** Reclamation candidate engine and RemoteAction approval path
**Size:** large
**Parent:** BI-55756F66
**Acceptance:** inactive/unused entitlements become ranked candidates with savings estimates; operator-approved candidates create governed `RemoteAction` requests; no auto-uninstall or seat removal occurs without approval.

### C6 - SaaS Discovery Foundation

**BI-08A34B18:** SaaS discovery from OAuth grants, SSO logs, and expense feeds
**Size:** large
**Parent:** BI-30151E25
**Acceptance:** `SaasDiscoverySignal`, account, and seat projections ingest OAuth grant inventory, SSO login logs, and expense/payments evidence; normalized SaaS apps link to `CatalogIdentity`/`Supplier`; shadow IT creates findings.

### C7 - SaaS Entitlement and Seat Optimization

**BI-4891F663:** SaaS entitlement reconciliation and inactive-seat optimization
**Size:** large
**Parent:** BI-30151E25
**Acceptance:** SaaS seats/subscriptions reconcile against entitlements/contracts; inactive paid seats and overlapping products are surfaced as `AssuranceFinding` and reclamation candidates; initial adapters target Microsoft 365 and Adobe only if credentials and legal terms permit.

### C8 - Operator UX

**BI-068EF11F:** SAM cockpit: ELP, renewals, reclamation, and SaaS risk views
**Size:** medium
**Parent:** all three Phase C lanes
**Acceptance:** UI uses existing report-kit/canonical primitives; no new navigation layer unless UX-fit review approves it; shows ELP deltas, upcoming renewals, inactive paid seats, shadow SaaS, evidence lineage, and approved actions.

## 7. Non-Goals

- No proprietary publisher-rights catalog clone.
- No opaque dependence on Flexera, ServiceNow, Snow, Zylo, Productiv, Torii, or another SAM/SaaS product as the canonical source.
- No parallel `SAMFinding` table.
- No reuse of regulatory `OrganizationLicenseRecord` for software usage rights.
- No auto-mutating uninstall, deprovision, or seat removal.
- No broad vendor-pack promise beyond shallow hand-curated top-vendor overlays.

## 8. Verification Strategy for Later Builds

Each implementation BI needs at least:

- Unit tests for metric calculations, publisher-rule formulas, entitlement allocation, reconciliation, usage normalization, and SaaS discovery matching.
- Migration tests for schema invariants and relation delete behavior.
- Production build.
- UX verification for any cockpit or action surface.
- Canonical-runtime/local-CI evidence for reconciliation jobs, migration apply, and action approval flow.

Phase C should use sample fixtures for Microsoft 365, Adobe, Oracle Database, VMware, and a generic SaaS expense line. The fixtures must avoid real customer identifiers.

## 9. Open Questions for Founder Review

1. Should the first publisher-rule pack be Microsoft-first, or split across Microsoft + Adobe to prove both installed and SaaS subscription patterns?
2. Should DPF store contract terms directly on `SupplierContract` extensions, or add SAM-specific terms under `SoftwareEntitlement` with `SupplierContract` as source evidence?
3. What is the first acceptable usage signal for reclamation: last-launch/app-metering, SSO-login recency, SaaS-admin activity, or expense-only inference?
4. Should SaaS discovery start with connected identity providers, finance/expense feeds, or Microsoft 365/Adobe admin APIs?

## 10. Sign-Off Gate

Do not start implementation until founder review answers the open questions or explicitly approves defaults:

- Default Q1: Microsoft-first.
- Default Q2: entitlement stores the SAM-specific rights; `SupplierContract` remains commercial agreement/evidence.
- Default Q3: SSO-login recency + SaaS-admin activity are acceptable; expense-only inference creates `needs_review` findings.
- Default Q4: identity-provider/SSO discovery first, then expense feed, then vendor admin APIs.
