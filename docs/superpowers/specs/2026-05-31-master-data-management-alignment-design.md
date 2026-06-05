---
title: Master Data Management Alignment Design
authoredAt: 2026-05-31
authoredBy: codex
status: draft
specKind: design
relatedSpecs:
  - docs/superpowers/specs/2026-03-17-admin-reference-data-design.md
  - docs/superpowers/specs/2026-05-26-graph-data-trust-vector-design.md
  - docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md
  - docs/superpowers/specs/2026-03-21-ea-digital-product-first-class-design.md
  - docs/superpowers/specs/2026-03-11-phase-4b-customer-route-design.md
  - docs/superpowers/specs/2026-05-22-customer-surface-archetype-activation-design.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/single-source-of-truth.md
  - docs/founder-kernel/wiki/principles/live-state-over-seed-data.md
  - docs/founder-kernel/wiki/principles/schema-audit-before-features.md
  - docs/founder-kernel/wiki/principles/organization-canonical-identity.md
externalReferences:
  - https://www.iso.org/standard/81745.html
  - https://www.dama-mn.org/Reference-MDM
  - https://www.sap.com/resources/what-is-mdm
  - https://www.ibm.com/master-data-management
  - https://www.informatica.com/products/master-data-management/multidomain-mdm.html
  - https://docs.oracle.com/en/cloud/saas/customer-data-management/faudm/overview-of-customer-data-management.html
---

# Master Data Management Alignment Design

## 1. Purpose

This spec aligns DPF with master data management practices: governing
the shared business entities that many workflows reuse, such as
organizations, customers, contacts, sites, products, suppliers,
locations, inventory entities, taxonomies, and reference data.

The goal is not to bolt on a generic MDM suite. DPF already owns much
of the operational master data directly in its domain model. The goal
is to make those records behave like managed master data:

- one canonical business identity per domain entity,
- source-system crosswalks for imported or integrated records,
- governed create/change/merge workflows,
- data quality scores and issue queues,
- survivorship rules for conflicting attributes,
- lineage and audit for why a value is trusted,
- publishing contracts so other DPF surfaces consume the same record.

## 2. Substrate Verification

No existing MDM-specific spec or backlog item was found for "master
data management", "golden record", "survivorship", or "match merge".
This design therefore uses existing DPF substrate instead of creating
a parallel MDM island.

Existing master-data-shaped models:

| Domain | Existing substrate | Current posture |
| --- | --- | --- |
| Organization | `Organization`, `BusinessContext`, `StorefrontConfig` | Strong canonical-owner rule already exists: `Organization` is the platform identity source of truth. |
| Customer | `CustomerAccount`, `CustomerContact`, `CustomerSite` | Domain records exist with source fields on `CustomerAccount`, but no generalized crosswalk, match/merge, or stewardship workflow. |
| Product | `Portfolio`, `DigitalProduct`, `ProductVersion`, `ProductBusinessModel` | Product master exists for DPF's operating model; quality/completeness exists in adjacent portfolio-health code. |
| Supplier | `Supplier`, `SupplierContract`, `AiProviderFinanceProfile` | Supplier master exists for finance/procurement, but source matching and duplicate handling are not generalized. |
| Location/reference data | `Country`, `Region`, `City`, `Address`, admin reference-data spec | Reference-data admin exists for geography; merge duplicates was explicitly deferred. |
| Inventory/configuration | `InventoryEntity`, `InventoryRelationship`, `DiscoveryRun` | Discovery records carry confidence, first/last seen, attribution, and source connection context. |
| Taxonomy/classification | `TaxonomyNode`, `BusinessCapability`, archetype capability maps | Classification substrate exists; governance differs by domain. |
| Trust/quality | Graph/Data Trust Vector spec, `PortfolioQualityIssue`, assurance ledger | Trust and data quality dimensions exist but are not yet applied as master-data governance. |
| Identity | `Principal`, `PrincipalAlias` | Strong pattern for alias convergence; `PrincipalAlias (aliasType, aliasValue, issuer)` is already the durable source crosswalk for identity-bearing entities. |
| Integration intake | `IntegrationImportStagedRecord` | Per-batch staged source records with `sourceProvider`, `entityFamily`, `externalId`, `reviewStatus="candidate"`, and `proposedLocal*` fields — the intake/triage precursor to a durable crosswalk and the existing duplicate-candidate substrate. |

Verdict: the MDM foundation should extend current domain models with
shared governance/read-model contracts and a reusable source-crosswalk
pattern. New canonical customer/product/supplier tables are not
justified. Two existing substrates constrain the new work and must be
reused rather than duplicated: `PrincipalAlias` (identity crosswalk) and
`IntegrationImportStagedRecord` (source intake + candidate review). See
§6.2–§6.3.

## 3. Benchmark Practices

Common master data management solutions converge on these capabilities:

| Capability | Practice to adopt in DPF |
| --- | --- |
| Master domains | Treat customer, contact, site, organization, product, supplier, location, asset/inventory, and taxonomy/reference data as explicit governed domains. |
| Golden record | Each domain has one canonical record used by DPF workflows, plus source references for imported variants. |
| Source identification | Every externally sourced record keeps source system, source object id, observed timestamp, and ingestion run. |
| Standardization | Normalize names, addresses, domains, emails, phone numbers, currencies, statuses, country/region/city codes, product identifiers, and supplier names before match decisions. |
| Match and dedupe | Detect exact and fuzzy duplicates, score match confidence, and route uncertain matches to stewardship instead of silently merging. |
| Survivorship | When source records conflict, choose attribute winners by explicit rule: source priority, freshness, completeness, human override, or domain-specific authority. |
| Stewardship workflow | Business users can review possible duplicates, approve merges, reject matches, correct values, and see why the platform suggested the action. |
| Reference data management | Codes, classifications, statuses, countries, currencies, industries, and archetype vocabularies are governed separately from transactions. |
| Hierarchies and relationships | Parent/child accounts, portfolio/product trees, supplier contracts, site hierarchies, and inventory relationships are first-class governed relationships. |
| Data quality | Score completeness, conformity, uniqueness, consistency, accuracy evidence, timeliness, and validity. Track issues to closure. |
| Lineage and audit | Every mastered value exposes where it came from, when it was observed, who changed it, and whether it was inferred or approved. |
| Publishing | Downstream app pages, coworkers, APIs, reports, and integrations consume canonical records through stable read models, not source-system tables. |

## 4. How DPF Works Today

DPF is already closer to operational MDM than it may look:

- It has strong single-source-of-truth doctrine for `Organization`.
- It uses `Principal` + `PrincipalAlias` for identity convergence.
- It has source-aware discovery and inventory models with confidence
  and first/last-seen timestamps.
- It has customer/site/product/supplier domain tables rather than a
  generic CRM-only blob.
- It has reference-data admin work for geographic data.
- It has graph/data trust-vector work for freshness, provenance, and
  confidence metadata.
- It has audit ledgers and action logs for tool and authority events.

The gap is that these are local patterns, not a reusable MDM discipline.
For example:

- `CustomerAccount` has `sourceSystem` and `sourceId`, but there is no
  reusable crosswalk that can hold multiple sources per canonical
  customer.
- Geographic reference-data cleanup allows deactivate/reactivate, but
  duplicate merge was deferred.
- Inventory has confidence and attribution, but customer/supplier data
  does not share the same trust vocabulary.
- Duplicate handling exists in backlog and issue-report workflows, but
  not as a domain-mastering primitive.
- Stewardship appears in several places as operator review, but there
  is no general "master data issue queue" for possible duplicates,
  conflicting source values, stale records, or low-quality attributes.

## 5. DPF MDM Doctrine

### 5.1 Canonical record stays in the domain table

Do not create generic `MasterCustomer`, `MasterProduct`, or
`MasterSupplier` tables while DPF already has domain-owned canonical
models. The canonical customer record is `CustomerAccount`; the
canonical supplier record is `Supplier`; the canonical organization
identity is `Organization`; the canonical digital product record is
`DigitalProduct`.

### 5.2 Source records are not canonical records

Source-system observations should be modeled as crosswalk/evidence, not
as peer canonical entities. A Pipedrive company, QuickBooks customer,
CSV row, discovery record, or manually entered lead can point to the
same `CustomerAccount` without becoming a separate account truth.

### 5.3 Confidence is visible

MDM surfaces must distinguish:

- confirmed canonical value,
- source-observed value,
- inferred value,
- conflicting value,
- stale value,
- human-overridden value.

These states must be expressed with the canonical trust vocabulary already
defined in the Graph/Data Trust Vector spec
(`docs/superpowers/specs/2026-05-26-graph-data-trust-vector-design.md`):
`TrustTier` (`high | medium | low | unknown`) and `TrustStatementKind`
(`current-fact | last-known-fact | inferred-result | low-confidence-result`),
plus the `conflictContradiction` dimension for conflicting values. Do **not**
introduce a parallel MDM-specific set of tier or status strings — that spec is
the single source of truth for trust vocabulary.

### 5.4 Merge is governed, reversible where possible, and audited

Merge actions must preserve aliases, source references, audit trail,
relationships, and pre-merge values. A merge is a stewardship decision,
not a background cleanup side effect.

### 5.5 Reference data is a mastered domain

Countries, regions, cities, currencies, industry/archetype vocabulary,
statuses, capability classifications, product categories, and supplier
terms are MDM domains. They need versioning, deactivation, replacement,
and usage impact reporting before change.

## 6. Proposed Foundation

### 6.1 Domain registry

Introduce a small code-level registry before adding new tables:

```ts
type MasterDataDomain =
  | "organization"
  | "customer-account"
  | "customer-contact"
  | "customer-site"
  | "digital-product"
  | "supplier"
  | "inventory-entity"
  | "taxonomy-node"
  | "reference-data";
```

For each domain, define:

- canonical model,
- canonical id field,
- searchable identity attributes,
- required quality dimensions,
- allowed source systems,
- merge policy,
- steward capability gate,
- publishing read model.

The **steward capability gate** is not a new role: it is a `PlatformCapability`
entry (`capabilityId`) checked at the steward action boundary, exactly as other
governed actions are gated. Each steward decision (link, merge, reject,
create-new) is recorded as a `ToolExecution` carrying that `capabilityId` —
reusing the existing tool-execution audit envelope rather than a bespoke
steward-action log.

### 6.2 Source crosswalk

Add a reusable crosswalk only after confirming no existing domain-specific
link table fits the first implementation slice:

```prisma
model MasterDataSourceRef {
  id              String   @id @default(cuid())
  domain          String
  canonicalId     String
  sourceSystem    String
  sourceEntityType String?
  sourceEntityId  String
  sourcePayloadHash String?
  observedAt      DateTime
  lastSeenAt      DateTime
  trustTier       String   @default("unknown")
  status          String   @default("active")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([domain, sourceSystem, sourceEntityId])
  @@index([domain, canonicalId])
  @@index([sourceSystem, sourceEntityId])
}
```

This is a crosswalk, not a canonical-data table. It should not store the
full source record by default. Full source payloads belong in the
owning integration or ingestion evidence table.

**Identity-bearing domains are out of scope for this table.** Per AGENTS.md
§11 (Principal Convergence, 2026-05-09), any identity-bearing entity is a
`PrincipalAlias` linked to one `Principal`, and the composite
`PrincipalAlias (aliasType, aliasValue, issuer)` is already the durable
source crosswalk for identity. `organization` and `customer-contact`
therefore resolve cross-source identity through `PrincipalAlias`, **not**
through `MasterDataSourceRef`. Scope `MasterDataSourceRef` to non-identity
domains only — `customer-account`, `supplier`, `digital-product`,
`inventory-entity`, `reference-data`. A second identity crosswalk would
violate single-source-of-truth.

**Reconcile with existing import staging.** Import-originated source
observations already land in `IntegrationImportStagedRecord` (`sourceProvider`,
`entityFamily`, `externalId`, `reviewStatus`, `proposedLocal*`).
`MasterDataSourceRef` is the *durable, resolved* mapping written once a staged
record is accepted/linked — it is not a second intake table, and the staging
record is not promoted into a parallel crosswalk row per import batch.

**Enum registration.** `domain`, `status`, and `trustTier` are canonical
string-enum columns: register their values in `apps/web/lib/backlog.ts` and
`apps/web/lib/mcp-tools.ts` in the same commit (hyphens, not underscores) per
AGENTS.md §3, and constrain `trustTier` to the `TrustTier` set
(`high | medium | low | unknown`) rather than a free string.

**Referential integrity (polymorphic by design).** `(domain, canonicalId)` is a
polymorphic pointer with no foreign key, because one table spans many canonical
models. The cost is that the database cannot enforce the link: deleting a
`CustomerAccount` does not cascade, and a merge must repoint crosswalk rows from
the losing canonical id to the surviving one. The spec therefore requires
application-level integrity: (a) the merge flow (§6.6) repoints all
`MasterDataSourceRef` rows for the losing id, and (b) an orphan sweep reconciles
crosswalk rows whose `canonicalId` no longer resolves. Whether the highest-volume
domains (`customer-account`, `supplier`) instead warrant a typed nullable FK
column for DB-enforced integrity is an open decision (§10) for
`dpf-decision-via-kernel`, not settled here.

### 6.3 Match candidate queue

Possible duplicates and source conflicts should become reviewable work:

- subject domain,
- candidate canonical records,
- match score and match reasons,
- conflicting attributes,
- suggested action: link, merge, reject, create new,
- steward decision and rationale.

First consumers should be customer accounts, suppliers, and geographic
reference data because those have clear duplicate risk and user-visible
impact.

**Reuse, don't duplicate, the candidate substrate.** For candidates that
originate from an import batch, reuse `IntegrationImportStagedRecord`
(`reviewStatus="candidate"`, `proposedLocalEntityType`,
`proposedLocalConfidence`) — it already is a source-record candidate queue.
Add net-new match-candidate substrate **only** for the case staging does not
cover: in-place dedup of two *existing* canonical rows (e.g. two
`CustomerAccount`s that may be the same record). Do not stand up a parallel
intake/candidate model alongside `IntegrationImportStagedRecord`.

### 6.4 Survivorship rules

Represent survivorship as config, not hidden code:

| Attribute class | Default rule |
| --- | --- |
| Legal/customer name | Human-approved value wins; otherwise highest-priority source, then most recent. |
| Website/domain | Verified domain wins; otherwise normalized exact match; conflicts go to steward. |
| Email/phone | Validated contact channel wins; stale invalid channels lose. |
| Address | Validated/geocoded address wins; otherwise most complete current source; conflicts go to steward. |
| Status | DPF workflow status wins over imported CRM status unless integration mapping explicitly owns it. |
| Industry/archetype | `StorefrontConfig.archetypeId` wins for portal vocabulary; imported industry is evidence only. |
| Supplier payment terms | Finance-approved supplier record wins over imported bill/vendor text. |

**Where the config lives.** "Config, not hidden code" means these rules are
stored as governed rule-as-JSON, following the existing precedents
(`EaDqRule.rule`, `PolicyRule`, `ApprovalRule`) rather than a new bespoke
shape — a `rule` JSON payload scoped by `domain` + attribute class, with
`severity` and lifecycle. The survivorship rule set is itself a mastered
**reference-data domain** (§5.5): versioned, deactivatable, and usage-impact
reported before change. It must not be a hardcoded constant that silently
re-decides survivorship on deploy.

### 6.5 Data quality dimensions

Data quality must be expressed as `TrustDimension[]` using the canonical
`TrustDimensionKey` registry owned by the Graph/Data Trust Vector spec — not a
parallel MDM dimension list. Six of the nine MDM dimensions already exist in
that registry; reuse them by their canonical key:

| MDM dimension | Canonical `TrustDimensionKey` | Status |
| --- | --- | --- |
| completeness | `coverageCompleteness` | exists — reuse |
| freshness | `freshness` | exists — reuse |
| source authority | `sourceAuthority` | exists — reuse |
| lineage coverage | `dataLineage` | exists — reuse |
| steward validation | `humanValidation` | exists — reuse |
| consistency | `conflictContradiction` | exists — reuse |
| validity / conformity | `validityConformity` | **net-new** — add to registry |
| uniqueness | `uniqueness` | **net-new** — add to registry |
| relationship integrity | `relationshipIntegrity` | **net-new** — add to registry |

The three net-new MDM-specific dimensions must be added to the
`TrustDimensionKey` union in
`docs/superpowers/specs/2026-05-26-graph-data-trust-vector-design.md` (the
single registry), not introduced as an MDM-only vocabulary. They then surface
in admin/steward views and coworker/tool payloads through the existing
`TrustAssessment` envelope — no bespoke MDM quality shape.

### 6.6 Merge audit and reversibility

Doctrine §5.4 requires every merge to be audited and reversible where possible;
this section places that requirement on existing substrate rather than a new
audit table. A merge is a governed steward action and is recorded as a
`ToolExecution` (+ `ToolExecutionReceipt`) carrying the steward `capabilityId`,
the surviving and losing `canonicalId`s, and the field-level survivorship
outcomes; authorization is captured in `AuthorizationDecisionLog` as for other
gated actions.

Reversibility requires a **pre-merge snapshot**: the losing record's attributes,
its `MasterDataSourceRef` rows, and its relationships, captured as receipt
evidence on that `ToolExecution` before mutation. Reversal repoints crosswalk
rows back and restores the snapshot; it is itself a governed, audited steward
action. Destructive hard-delete of the losing canonical row is deferred (§7
step 3) until this snapshot/reversal path exists — until then a "merge" is a
link + supersede, never a delete.

## 7. Implementation Sequence

1. **Inventory current domains.** Add the code-level domain registry and
   document canonical model ownership.
2. **Customer-account pilot.** Add source crosswalk and duplicate
   candidate detection for `CustomerAccount` because CRM imports,
   marketing workflows, sites, contacts, and opportunities all converge
   there.
3. **Steward queue.** Add a small admin/steward page for possible
   duplicates and source conflicts. Start with link/reject/create-new;
   defer destructive merge until audit/reversal is designed.
4. **Survivorship v1.** Implement explicit field-level rules for
   customer name, website, source status mapping, primary contact, and
   primary site/address.
5. **Reference-data merge.** Extend the reference-data admin surface
   with replacement/merge for duplicate regions/cities and usage-impact
   preview. This implements the duplicate merge that
   `docs/superpowers/specs/2026-03-17-admin-reference-data-design.md`
   explicitly deferred (deactivate/reactivate shipped; merge did not).
6. **Supplier pilot.** Reuse the same source crosswalk and steward queue
   for `Supplier`, especially AI provider finance profiles and imported
   vendor/bill records.
7. **Publishing contracts.** Expose canonical mastered records through
   stable read models for coworkers, dashboards, and integrations.

## 8. Non-Goals

- No generic MDM product implementation in the first slice.
- No parallel canonical tables for domains DPF already owns.
- No automatic fuzzy merge without steward review.
- No global schema rewrite.
- No replacing domain-specific business rules with a generic data hub.

## 9. Acceptance Criteria

- A developer can identify the canonical model for each governed master
  data domain.
- Imported customer records can link to an existing `CustomerAccount`
  without creating duplicate customers.
- Possible duplicates produce steward-visible candidates with reasons.
- Conflicting source values are visible with survivorship rationale.
- Reference-data changes show usage impact before deactivation or merge.
- Coworkers and dashboards read canonical records and receive trust/data
  quality metadata when the record is incomplete, stale, inferred, or
  source-conflicted. This metadata is emitted as the trust-vector spec's
  `TrustAssessment` envelope (`kind: "data-trust-vector"`) attached to the
  published read model's `DataSourceProvenance.trust` — not a bespoke MDM
  payload shape.
- A steward merge produces an auditable `ToolExecution` with a pre-merge
  snapshot, and crosswalk rows are repointed (not orphaned) to the surviving
  canonical id.
- Survivorship rules are stored as governed, versioned config — not a code
  constant — and a change shows usage impact before it takes effect.

## 10. Open Decisions and Backlog Linkage

**Open decisions (for `dpf-decision-via-kernel`, not settled here):**

- **Crosswalk integrity shape.** Polymorphic `(domain, canonicalId)` with
  application-enforced integrity (this spec's default) vs. typed nullable FK
  columns per high-volume domain for DB-enforced cascade. Trade-off: one
  reusable table vs. referential safety on `customer-account`/`supplier`.
- **Merge severity.** Whether v1 ever hard-deletes a losing canonical row once
  the snapshot/reversal path exists, or permanently keeps it as a superseded
  tombstone.

**Backlog linkage.** Per DPF doctrine a spec is built against a backlog item,
not floating intent. This design still needs an epic + sized BIs filed and
promoted to Build Studio, sequenced per §7. One BI is **cross-spec**: adding
`validityConformity`, `uniqueness`, and `relationshipIntegrity` to the
`TrustDimensionKey` registry in
`docs/superpowers/specs/2026-05-26-graph-data-trust-vector-design.md` must land
before MDM consumes them, so it is a coordinated dependency, not an MDM-internal
task. Status stays `draft` until the epic is filed and the two open decisions
are resolved.

## 11. Architecture Review Notes

This spec passed two `dpf-architecture-review` passes. The first aligned trust
vocabulary, identity crosswalk, and import-staging reuse (PR #1328). The second
closed data-model integrity gaps the doctrine had promised but the foundation
had not placed: polymorphic-crosswalk referential integrity (§6.2), merge
audit/reversibility on the existing `ToolExecution` envelope (§6.6),
survivorship config storage (§6.4), and the steward gate bound to
`PlatformCapability` (§6.1). No new audit, config, or steward-action tables were
introduced — each concern was placed on substrate that already exists.
