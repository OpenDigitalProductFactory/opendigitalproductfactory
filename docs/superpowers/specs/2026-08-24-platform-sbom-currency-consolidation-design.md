# Platform SBOM and currency consolidation design

Status: proposed  
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

## Verification contract

- Unit: normalization, deterministic document identity, idempotent replacement, supersession, catalog bridge.
- Render: mixed and empty states, lifecycle derivation, semantic table, export link, navigation.
- Route: both compatibility redirects.
- Architecture: single-home guard fixtures and repository scan.
- Functional: seed a nonproduction install twice and prove one current platform document for the source digest and nonzero occurrences.
- UX: desktop and narrow first viewport, clear facet labels, keyboard navigation, no duplicate tab.
