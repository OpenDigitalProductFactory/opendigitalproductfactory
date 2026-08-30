---
status: binding
---

# Platform SBOM and currency consolidation design

Status: binding
Backlog item: `BI-7D2C4F02`  
Decision: `DI-C24852C1789A`

## Problem and evidence

DPF has three adjacent but disconnected representations of software dependency posture:

1. `apps/web/lib/operate/platform-stack.ts` owns a static seven-row platform stack and renders it at `/ops/stack-currency`.
2. Product `Dependencies & Estate` renders attributed `InventoryEntity` records.
3. Product `Supply Chain` renders `BomDocument` composition, but the live install has no BOM rows and the route is only visible after entering the Operate family.

The static representation was added in PR #4295 after the canonical BOM substrate (PR #958) and SBOM-to-portfolio projection (PR #2269). Its implementation plan asserted that the assessment had no other consumer. There was no recorded independent review, and the existing projection parity test can only compare registered projectors; it cannot see a route-local source array.

## Design objective

Give an operator one product-scoped place to answer four different questions without collapsing their data semantics:

- Which digital products does this product depend on? (`ProductDependency`)
- Which deployed or discovered instances support it? (`InventoryEntity`)
- Which software components compose it? (`BomDocument` and occurrences)
- Which components are current or nearing support end? (`CatalogLifecycleMilestone` through `CatalogIdentity`)

The single operator home is `Digital Product > Operate > Dependencies`. One home means one navigation destination and one source graph, not one overloaded database table.

## Governed scope manifest

- **OBJ-PSCC-001:** Persist the generated platform CycloneDX document as the sole platform software-composition source linked to the `dpf-portal` DigitalProduct, with deterministic and idempotent install behavior.
- **OBJ-PSCC-002:** Make product `Operate > Dependencies` the single discoverable operator home while preserving the distinct semantics of product relationships, deployed estate, and software composition.
- **OBJ-PSCC-003:** Derive component currency only from canonical `CatalogIdentity` lifecycle milestones and preserve explicit provenance when support data is unavailable.
- **OBJ-PSCC-004:** Retire route-owned platform stack facts and duplicate navigation without breaking existing bookmarks.
- **OBJ-PSCC-005:** Add a repository invariant and verification evidence that prevent the competing route-local inventory pattern from recurring.

| Acceptance ID | Objective IDs | Acceptance statement |
| --- | --- | --- |
| AC-PSCC-001 | OBJ-PSCC-001 | A fresh install persists one current platform CycloneDX BOM linked to `dpf-portal` with nonzero component occurrences. |
| AC-PSCC-002 | OBJ-PSCC-001 | Reprocessing the same source digest is idempotent, while a changed source digest supersedes the older platform document without changing build-scoped BOMs. |
| AC-PSCC-003 | OBJ-PSCC-001, OBJ-PSCC-003 | Persisted platform components link through the existing SBOM bridge to canonical catalog identities where resolvable. |
| AC-PSCC-004 | OBJ-PSCC-002 | Product Operate presents product relationships, attributed estate, and software composition as distinct sections of one Dependencies destination. |
| AC-PSCC-005 | OBJ-PSCC-002 | Each section has an independent mixed or empty state, and an empty section does not hide populated sibling sections. |
| AC-PSCC-006 | OBJ-PSCC-003 | Component currency and support end are derived with the canonical lifecycle helpers; unavailable milestones render `Not sourced` rather than an inferred date. |
| AC-PSCC-007 | OBJ-PSCC-004 | `/ops/stack-currency` and product `/supply-chain` bookmarks redirect to the canonical software-composition section. |
| AC-PSCC-008 | OBJ-PSCC-004 | The Stack Currency operations tab, separate Supply Chain product destination, static `PLATFORM_STACK` owner, and route-owned purpose contract are removed. |
| AC-PSCC-009 | OBJ-PSCC-005 | A repository guard fails if a route-local platform component inventory, duplicate product destination, non-redirect compatibility route, or missing seed invocation is reintroduced. |
| AC-PSCC-010 | OBJ-PSCC-001, OBJ-PSCC-002, OBJ-PSCC-003, OBJ-PSCC-004, OBJ-PSCC-005 | Automated tests cover persistence identity and replacement, catalog linkage, lifecycle derivation, unified surface states, redirects, navigation, and the architectural invariant. |
| AC-PSCC-011 | OBJ-PSCC-002, OBJ-PSCC-005 | Shared nonproduction verification proves first-viewport discoverability, responsive layout, usable empty and error behavior, one current platform BOM, and no duplicate navigation. |

## Scope boundary

| Disposition | Surface | Contract |
| --- | --- | --- |
| In scope | Platform composition ingestion | Add a `@dpf/db` adapter that invokes the existing `scripts/sbom/generate-platform-sbom.mjs` output, normalizes it once, and persists it through the existing BOM and catalog bridge contracts. |
| In scope | Product Operate read model | Compose `ProductDependency`, canonical attributed `InventoryEntity`, and the latest product `BomDocument` into `/portfolio/product/[id]/inventory` without merging their schemas or semantics. |
| In scope | Compatibility and navigation | Rename the single product destination to Dependencies, redirect both former destinations to `#software-composition`, and remove the Stack Currency operations tab and purpose contract. |
| In scope | Recurrence prevention | Add a boundary guard that detects a route-local platform inventory, duplicate navigation, a non-redirect compatibility route, or a missing canonical seed invocation. |
| Out of scope | Database shape | No model, column, enum, index, or migration. The existing foreign keys and deletion behavior remain authoritative. |
| Out of scope | Global discovery operations | `/inventory`, connection discovery, inventory correction, topology, and `InventoryEntity` write flows do not change. |
| Out of scope | Build assurance | Build-scoped BOM ingestion, assurance runs/findings, redaction, and the existing machine-readable export endpoint keep their contracts. |
| Out of scope | Lifecycle sourcing | This work consumes `CatalogLifecycleMilestone`; it does not add feeds, infer support dates, or change milestone precedence. |
| Out of scope | Unrelated navigation | The existing Workrooms operations navigation change is preserved exactly. |

## Architecture preservation and blast radius

This is a composed read model over normalized sources, consistent with `principles/reporting-read-model-boundaries`, `architecture-over-shortcuts`, and `single-source-of-truth`. It introduces no parallel persistence model.

| Element | Current contract | Change | Preserved boundary and proof |
| --- | --- | --- | --- |
| `DigitalProduct` | Product aggregate keyed by stable `productId`; owns BOM, inventory, and dependency relations | Resolve only `dpf-portal` for seed ingestion and compatibility redirect | No product creation or lifecycle mutation; seed and redirect tests assert stable-id resolution. |
| `ProductDependency` | Unique directed product relation | Read incoming and outgoing edges for the unified page | Read-only; no package component is projected into this graph. Render tests preserve direction and relation type. |
| `InventoryEntity` | Attributed discovered/deployed estate | Read a bounded page of canonical entities | Read-only; global discovery/correction routes remain unchanged. Mixed-state tests prove estate absence cannot hide other facets. |
| `BomDocument` | Versioned composition record, optionally linked to a product/build/run | Add product-linked `sourceKind=platform-pnpm-lock` documents with deterministic identity | Only older platform documents for the same product/source kind become `superseded`; build/run documents are never updated. Transaction/idempotence tests prove the boundary. |
| `BomComponentOccurrence` | Product/build-private document membership | Replace occurrences only for the deterministic platform document | Cascade and occurrence uniqueness remain unchanged; stale-removal tests prove document-local replacement. |
| `BomComponent` and `CatalogIdentity` | Shared normalized component identity and lifecycle-enrichment spine | Reuse the existing component key and SBOM bridge | Components are upserted, not owned or deleted by this adapter. Catalog links remain optional and `onDelete: SetNull`. |
| Product Operate UI | Separate Dependencies & Estate and Supply Chain destinations | One Dependencies destination with three semantic sections | The global `/inventory` surface and export API remain separate; nav, redirect, route, and accessibility tests cover the changed surface. |
| Operations UI | Route-local Stack Currency table and tab | Redirect-only compatibility route; delete its local facts and purpose contract | The Workrooms tab and all other Operations tabs remain untouched; the repository guard compares exact boundaries. |

Persistence of one platform document is transactional: upsert the document and components, replace that document's occurrences, link resolvable catalog identities, and supersede older `platform-pnpm-lock` documents for `dpf-portal` in one database transaction. A failure rolls back that unit and is surfaced by the isolated seed-step failure contract; it cannot leave a half-current platform document.

## Scale and completeness contract

- The source lockfile and generated CycloneDX artifact are complete inputs. The adapter never silently drops components.
- Component and occurrence writes are chunked in batches of at most 500 rows inside the document transaction. A rerun performs work linear in the generated component count; it does not scan unrelated BOMs or inventory.
- The product page queries counts separately and requests at most 100 rows per facet. Additional relationships, estate rows, and component occurrences remain reachable through cursor pagination; the UI shows the total and the displayed range so a bound is never presented as completeness.
- The raw CycloneDX export remains the full document even when the human table is paged.
- The supported near-term ceiling is 50,000 occurrences in one platform BOM, well above the current monorepo lockfile. Inputs above that ceiling fail with the measured count instead of truncating. No scale-lift epic exists because the current substrate is below the ceiling; crossing it requires a dedicated epic for streaming generation and staged persistence before the limit may rise.

## Standards grounding

- CycloneDX 1.7 remains the interchange contract. The adapter validates `bomFormat`, `specVersion`, document version, component uniqueness, and identifiers against the [official JSON reference](https://cyclonedx.org/docs/1.7/json/); it does not reinterpret the component array as a product dependency tree.
- `docs/platform-usability-standards.md` governs theme tokens, progressive disclosure, semantic structure, partial/error states, and responsive/keyboard verification.
- `docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md` and `single-source-of-truth.md` require reuse of the existing generator and normalized BOM/catalog graph instead of a second inventory.
- No external standard requires a new DPF schema. The existing CycloneDX-to-BOM adapter boundary is therefore retained rather than replaced.

## Canonical model

```text
DigitalProduct (dpf-portal)
  ├─ ProductDependency ───────────────► DigitalProduct
  ├─ InventoryEntity ─► CatalogIdentity ─► CatalogLifecycleMilestone
  └─ BomDocument ─► BomComponentOccurrence ─► BomComponent
                                                └─► CatalogIdentity
                                                       └─► CatalogLifecycleMilestone
```

Rules:

1. `DigitalProduct` is the product aggregate and page identity.
2. `ProductDependency` is coarse product-to-product architecture, never package composition.
3. `InventoryEntity` is observed/deployed estate, never a substitute for an SBOM occurrence.
4. `BomDocument` is the authoritative versioned composition record. Long-tail libraries remain components; they are not projected into standalone products.
5. `CatalogIdentity` is the identity/lifecycle enrichment spine shared by estate and BOM components.
6. Currency is derived at read time with `deriveSupportEndDate` plus `deriveCurrency`. The presentation owns no EOL dates.

## Ingestion

The existing `scripts/sbom/generate-platform-sbom.mjs` remains the only platform composition generator. It already reads the root lockfile and produces CycloneDX 1.7 for the monorepo and published containers.

Seed/install adds an adapter, not a generator:

1. Generate the artifact from the installed root lockfile using the deployed git identity.
2. Normalize CycloneDX components into the shared BOM types and component-key contract.
3. Resolve `dpf-portal` by stable product id.
4. Use `bom_platform_<sourceDigest>` as the deterministic document identity.
5. Upsert the document, replace only its occurrences, and mark older `platform-pnpm-lock` documents for that product `superseded`.
6. Link components to catalog identities with the existing SBOM bridge.

The adapter runs after `seedDpfSelfRegistration`. A rerun with the same lockfile updates the same document. A new lockfile creates a new content identity and supersedes the previous platform document; build-scoped BOMs are unaffected.

## Read model and interaction design

`/portfolio/product/[id]/inventory` becomes the unified Dependencies page. It loads the latest canonical facts in parallel and renders:

1. A first-viewport orientation and summary showing product relationships, estate items, BOM components, and currency attention.
2. Product relationships, with direction and relation type.
3. Estate, retaining the existing discovery evidence cards and attribution signals.
4. Software composition, retaining SBOM export, assurance status, and component details while adding catalog-derived currency and support end.

Each section has an independent empty state. An empty estate must not hide an available BOM, and a missing BOM must not hide product dependencies. The software composition table is bounded in-page and the full machine-readable document remains available through export.

Compatibility routes:

- `/portfolio/product/[id]/supply-chain` → `/portfolio/product/[id]/inventory#software-composition`
- `/ops/stack-currency` resolves `dpf-portal` and redirects to the same section.

The Operations Stack Currency tab and route purpose contract are removed because the compatibility route is no longer a capability surface.

### Reviewable interaction contract

Entry points and focus behavior:

1. Product Overview links to one Operate destination named **Dependencies**.
2. The first viewport contains the `Dependencies` heading, one sentence distinguishing relationships, estate, and software composition, and summary counts for all three plus currency attention.
3. The sections follow that same order. Each is a labelled region with a heading; the software section has stable id `software-composition` so both compatibility redirects land on the real heading.
4. The redirect target receives normal browser anchor focus/scroll behavior and remains useful without client JavaScript.

Progressive disclosure and actions:

- Summary counts and section status stay visible. Large row sets use the shared table/list and pagination primitives; record detail is disclosed without duplicating identity text.
- The only primary software-composition action is **Export full SBOM**, which retains the existing API contract and names that the export is complete even when the table is paged.
- Currency is conveyed by text and semantic status tone, never color alone. Every row retains component name/version, package URL when present, document provenance, derived support end, and explicit `Not sourced` fallback.

| Facet state | Product relationships | Estate | Software composition |
| --- | --- | --- | --- |
| Populated | Direction, related product, relation type, and source | Canonical estate cards and attribution evidence | Current document provenance, total, currency summary, paged semantic table, and full export |
| Empty | “No product relationships recorded” and no invented independence claim | Existing discovery-oriented recovery guidance | For `dpf-portal`, explain that platform SBOM seed ingestion has not completed; for other products, retain Build Studio guidance |
| Partial/stale | Keep confirmed edges visible and label unavailable direction/source fields | Keep confirmed rows and their freshness/attribution status | Keep the current document visible and mark missing catalog lifecycle data `Not sourced` |
| Error | Section-level alert; populated sibling sections remain usable | Section-level alert with the owning discovery recovery path | Section-level alert; do not replace failure with a zero count |

At narrow widths, summary cards wrap to one column and tables remain horizontally scrollable inside their labelled region without widening the page. Heading order, landmarks, links, pagination, disclosures, and export are keyboard operable; focus indication and contrast come from shared theme-aware primitives.

## Failure and provenance behavior

- Missing generator inputs fail the isolated seed step loudly; other seed steps continue under the existing seed fault-isolation contract.
- Missing lifecycle milestones render `Not sourced`; the UI does not infer dates from versions.
- Missing BOM renders a platform-specific recovery explanation for `dpf-portal` and the existing Build Studio explanation for other products.
- Every composition row retains document generation time, document digest, package URL, and catalog linkage where available.

## Prospective invariant

A repository guard enforces the architectural boundary:

- no `PLATFORM_STACK` symbol or `platform-stack` source module;
- `/ops/stack-currency` is redirect-only;
- product navigation has one Dependencies destination and no parallel Supply Chain destination;
- seed invokes the canonical platform BOM adapter;
- the platform generator remains the source of platform CycloneDX data.

This guard is intentionally boundary-specific. It prevents the exact failure class—an operator route owning a competing platform component inventory—without banning other legitimate operations read models.

## Alternatives rejected

### Keep the operations page as an adapter

This removes duplicate data but preserves duplicate operator ownership and discoverability. It scored materially below the chosen design in `DI-C24852C1789A`, especially on one-home, cognitive load, and maintainability.

### Project every component into InventoryEntity

This erases the distinction between observed instances and package composition, expands rows dramatically, and abandons the already-shipped BOM evidence model.

### Project frameworks and libraries into DigitalProduct

This inflates the portfolio with implementation detail and makes product relationships version-specific. Only independently managed or licensed products belong in `DigitalProduct`; libraries stay in the BOM/catalog graph.

## Data and migration impact

No schema migration. All writes use existing models. The first corrected seed is additive: it creates one current platform document and component/catalog rows. It does not delete build BOMs, operator-owned products, inventory, or lifecycle observations.

## Risk and rollback plan

| Risk | Detection | Mitigation | Verification and rollback |
| --- | --- | --- | --- |
| Generator path differs in a release image | Seed path-resolution test and init-image/pregate execution | Resolve from the installed root and fail only the isolated platform-BOM seed step with a concrete path error | Exact-tree pregate plus shared nonproduction seed; revert the PR to restore prior seed behavior |
| Platform replacement touches build-scoped BOMs | Transaction test seeds platform and build documents together | Filter replacement/supersession by `digitalProductId` plus `sourceKind=platform-pnpm-lock`; never by product alone | Assert build document, digest, status, and occurrences are byte-for-byte unchanged |
| Large BOM causes memory or page overload | Unit fixture at the 50,000-occurrence ceiling and query-limit assertions | Batch persistence, count-first reads, cursor pagination, bounded first viewport, full export | Fail explicitly above the ceiling; revert adapter/UI without deleting persisted BOM rows |
| Catalog linkage changes shared identity | Bridge test with linked, unresolved, and pre-linked components | Reuse canonical component key/bridge; optional FK only; never overwrite lifecycle milestones | Assert unresolved components remain valid and existing catalog links/milestones are unchanged |
| Empty or failed facet hides useful sibling data | Mixed-state render matrix | Fetch facets independently and render section-local empty/error states | Render tests plus shared nonproduction fault/empty checks |
| Compatibility bookmarks or navigation regress | Route and nav tests | Server redirects to a stable semantic anchor; one product destination only | Verify both old URLs, active tab state, browser history, and keyboard focus |
| Competing route-local facts recur | Boundary guard fixture suite and repository scan | Ban the former symbol/module, duplicate nav, non-redirect route, and missing seed call | Guard is wired into the normal check suite; revert restores all files atomically if necessary |

Rollback is one DCO PR revert. No down migration is required. Persisted platform BOM rows are additive evidence and may remain safely; reverting the read/seed path neither deletes nor mutates build-scoped evidence.

## Acceptance evidence plan

| Acceptance | Automated evidence | Runtime/UX evidence |
| --- | --- | --- |
| Composition persistence (criteria 1–3) | DB unit tests for normalization, deterministic identity, idempotent rerun, supersession isolation, stale occurrence removal, and catalog bridge | Seed shared nonproduction twice; query one current `dpf-portal` platform document, nonzero complete occurrences, unchanged build BOMs, and resolvable catalog links |
| Unified experience and currency (criteria 4–6) | Page/render tests for all three regions, mixed/empty/error states, lifecycle helper output, `Not sourced`, pagination totals, and full export | Desktop and narrow screenshots; keyboard pass; verify empty estate with populated BOM and populated estate with missing BOM |
| Compatibility and invariant (criteria 7–9) | Server redirect tests, product and Operations nav tests, purpose-artifact freshness, guard fixture tests, and repository scan | Open both legacy bookmarks and confirm the stable software-composition heading and one active Dependencies destination |
| Automated verification (criterion 10) | Focused suites, DB/web typechecks, prose/style/generated-artifact guards, `pregate:preflight`, exact-tree `pregate`, and `pr:health` | Workroom evidence links each acceptance row to its test/runtime result |
| Shared nonproduction proof (criterion 11) | UX route/render checks for heading structure, first viewport, responsive overflow, empty/error semantics, and keyboard navigation | Shared nonproduction UX critique with desktop/narrow screenshots and post-action database proof |

## Verification contract

- Unit: normalization, deterministic document identity, idempotent replacement, supersession, catalog bridge.
- Render: mixed and empty states, lifecycle derivation, semantic table, export link, navigation.
- Route: both compatibility redirects.
- Architecture: single-home guard fixtures and repository scan.
- Functional: seed a nonproduction install twice and prove one current platform document for the source digest and nonzero occurrences.
- UX: desktop and narrow first viewport, clear facet labels, keyboard navigation, no duplicate tab.
