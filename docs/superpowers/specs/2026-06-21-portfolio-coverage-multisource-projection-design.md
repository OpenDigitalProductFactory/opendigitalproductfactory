# Portfolio Coverage Surface — Multi-Source Projection Design

| Field | Value |
|-------|-------|
| **Status** | Draft — founder review before fan-out |
| **Date** | 2026-06-21 |
| **Author** | Claude (Opus 4.8) with founder (Mark Bodman) |
| **Extends** | [`2026-06-07-business-operating-model-portfolio-wiring-design.md`](2026-06-07-business-operating-model-portfolio-wiring-design.md) (single source of truth for Facets A/B; do not duplicate). This spec covers the **deferred Facets C & D** (§4.3 of that spec) plus the cross-cutting **source-projection mechanism** and **coverage axis** that populate all four. |
| **Primary Objective** | Make the four portfolios a **coverage & planning surface** by projecting every substrate that already knows about a real (or potential) digital product, component, integration, or supplier into the portfolio — not just network discovery. Today the portfolio *taxonomy* is rich but the *instances* are sparse because only one source writes them. |
| **Epic** | Extends **EP-BOM-WIRING**. Cross-links **EP-ASSURANCE-LEDGER** (SBOM substrate), **EP-ARCH-GRAPH-LIVE** (same reality bridged to the EA graph), **EP-MDM** (multi-source survivorship), **EP-PROACTIVE-OPS** (lifecycle/criticality), **EP-SBO** (QuickBooks). |
| **Non-Goals** | Does not re-architect Facets A/B (owned by 2026-06-07). Does not implement migrations in this doc (schema decisions are flagged for the plan). Does not turn DPF into a SaaS-spend-management product. Does not auto-enable any integration — "potential" entries are planning rows, enablement stays operator-governed. |
| **Primary Inputs (verified live, worktree `admiring-faraday-6c45fd`)** | `packages/db/data/portfolio_registry.json`, `packages/db/data/digital_product_registry.json` (schema 2.3.0), `packages/db/src/seed.ts:492` (`seedDigitalProducts`), `packages/db/prisma/schema.prisma` (`DigitalProduct`:583, `InventoryEntity`:3646, `McpIntegration`:7886, `IntegrationCredential`:1348), `packages/db/src/discovery-sync.ts`, `packages/db/src/discovery-promotion.ts`, `apps/web/lib/onboarding/seed-market-offer.ts`, `packages/storefront-templates/src/capability-registry.ts`, `apps/web/lib/assurance/cyclonedx-generator.ts`. |

---

## 1. Problem Statement

The portfolio surface has a **rich taxonomy and a starved instance layer.**

- **The taxonomy is dense.** `search_portfolio_context` returns hundreds of IT4IT/APQC process nodes across the four roots — including `for_employees/develop_and_manage_products_and_services/vendor_management` ("the management of technology suppliers … selection, negotiation, contracting, procurement, renewals"), `.../manage_foundational_facing_products_and_services_portfolio`, and `.../refine_manufacturing_and_deliver_portfolio_taxonomy`. The *shape* to hold suppliers, foundational products, and delivery tooling already exists.
- **The instances are sparse, and almost all in one portfolio.** Live `DigitalProduct` rows come from exactly two writers:
  1. **Network discovery** (`discovery_sweep` → `InventoryEntity` → promotion gate → `DigitalProduct`), which scans **local infrastructure only** (hosts, Docker containers, k8s, Prometheus, ARP/SNMP) and therefore writes almost exclusively into **`foundational`**.
  2. **A hand-curated seed** (`digital_product_registry.json`, ~8 rows: Docker, Neo4j, Postgres, Qdrant, Prometheus, Grafana, `dpf-meta`, `dpf-platform-standard`), all `source: manual_entry`.
- **Three of the four portfolios are effectively empty.** `manufacturing_and_delivery`, `for_employees`, and the customer-facing parts of `products_and_services_sold` have **no discovered source** — the 2026-04-30 discovery-gap spec said so explicitly and deferred them, and the 2026-06-07 BOM-wiring spec scoped Facets C/D **out** (§4.3: "Out of primary scope for this spec").

**The consequence (Mark's observation, verified):** the things that *actually do the work* are invisible to the portfolio they belong in.

- **Manufacture & Delivery depends on GitHub and Build Studio** — `apps/web/lib/integrate/github-api-commit.ts`, `apps/web/lib/integrate/build-orchestrator.ts`, plus scheduling, self-upgrade, the edge-node fleet, and the marketing delivery channels. These *are* the `manufacturing_and_delivery` portfolio. **None is a portfolio entry.**
- **Integrations are real or one click away.** QuickBooks (`apps/web/lib/integrate/quickbooks/*`, read-first, live), Stripe, ADP, HubSpot, M365 are tracked in `IntegrationCredential` with a `status` (unconfigured/connected/error); the broader catalog lives in `McpIntegration` with `pricingModel`, benchmark domain, and `priorityTier`. These are integrations *to* digital products that belong under the portfolios — and the catalog already encodes **active-vs-potential**. Yet `search_integrations` returns **empty** on the live install (catalog unseeded), and **no integration projects into a portfolio.**
- **Third-party SBOM components are "lost."** The platform generates a CycloneDX 1.7 SBOM (`apps/web/lib/assurance/cyclonedx-generator.ts` → `BomComponent`) of its own npm + model dependencies, with `supplierName`, `licenseExpression`, `packageUrl`. Some are paid (the registry already names **Docker Business — seat license** and **Neo4j Enterprise — instance license** as `product_models`). The SBOM is attached to products but **never surfaced as portfolio components**, so "what third parties are we made of, and which do we pay for" has no home.
- **Suppliers/goods aren't seeded from archetype.** `seed-market-offer.ts` seeds the *services sold* (a plumber's call-outs, boiler service) — but the plumber's **suppliers and merchant materials** ("we rely on trade suppliers and merchants for parts … a missing part means a second trip") live only as editable narrative text, with no portfolio entries, despite the `vendor_management` taxonomy node waiting for them.

**The deeper miss:** the `digital_product_registry.json` schema (2.3.0) *already models all of this* — `usage_mode: used|sold`, `procurement_type: external_purchase|external_sale`, `realizes_model_ids` (link to the paid `product_models`), `depends_on_product_ids` (the dependency/SBOM graph), `source`/`source_confidence`. **But `seedDigitalProducts` (`seed.ts:521`) maps only 5 of those ~20 fields** — the rest are silently dropped because `DigitalProduct` has no columns for them. The intended design exists on paper; the wiring and the schema home do not.

> **One-line framing.** Network discovery is one source-projector. The portfolio needs *several* — one per substrate that already knows the answer — plus a **coverage axis** (`used` / `sold` / `available` / `potential`) so the portfolio shows not only what you have, but what you could enable. That turns four sparse inventories into a coverage & planning surface.

## 2. Design Intent

Introduce a **multi-source portfolio projection layer** — not a new substrate, a generalization of the one that exists. Network discovery already does the canonical move: read reality → write `InventoryEntity` (attributed, deduped, scoped) → promote to `DigitalProduct` placed in a portfolio + taxonomy node. Generalize "reality" from *the local network* to *every substrate the platform already maintains*, and add a coverage dimension.

```text
SOURCE SUBSTRATES (already exist)                 PROJECTOR            LANDING            SURFACE
─────────────────────────────────                ──────────          ─────────          ───────
network sweep (hosts/containers)  ─┐
capability-registry.ts (32 caps)   │             source-attributed   InventoryEntity    Portfolio (×4)
integration registry (McpIntegration/Cred) ──►   projector       ──► (+ coverage,   ──► + taxonomy node
AI provider registry (ModelProvider)│            (one per source)     + source)          + coverage filter
SBOM (BomComponent: npm + models)  │                  │              │  └─ promote ─►    DigitalProduct
archetype suppliers/goods         ─┘                  │              │
                                                     every row carries: source ∈ {network_discovery,
                                                     manual_entry, capability_registry, integration_registry,
                                                     sbom, ai_provider, archetype}  ×  coverage ∈ {used, sold,
                                                     available, potential, planned, retired}
```

Three load-bearing ideas:

1. **Coverage axis.** Promote the registry's `usage_mode` from a buried, dropped field to a first-class portfolio dimension: `used` (in use), `sold` (a market offer), `available` (integrated and configurable now — e.g. QuickBooks credential exists), `potential` (catalogued, one click to enable — e.g. a `McpIntegration` with no credential), `planned`, `retired`. **"Potential" rows are the planning surface** — they make the portfolio answer "what could this business turn on?" without committing to it.

2. **Source attribution generalized.** Reuse the existing attribution machinery (`InventoryEntity.attributionMethod` / `attributionConfidence` / `lastConfirmedRun.sourceSlug` / `scopeKey`; registry `source`/`source_confidence`) and widen the source vocabulary beyond network sweeps. Each projected row knows where it came from, so the surface can show provenance and the platform can reconcile multiple sources for the same thing (MDM survivorship — §6).

3. **Project, don't re-author.** Every projector reads a substrate that already exists and is already maintained; it never becomes a second source of truth. The integration registry stays canonical for integrations; the SBOM stays canonical for components; `capability-registry.ts` stays canonical for capabilities. The projector is a *view-materializer* into the portfolio, refreshed on a cadence, idempotent, non-destructive over operator edits (same discipline as `seed-market-offer.ts`).

### 2.1 The four-portfolio × source matrix

| Portfolio | Today's source | New projected sources | Example entries (coverage) |
|---|---|---|---|
| **Foundational** | network discovery + manual registry | AI provider registry; SBOM runtime/infra components; voice/STT services; MCP servers | Docker Model Runner (`used`), Postgres/Neo4j/Qdrant (`used`), cloud LLM providers (`available`/`potential`), Neo4j Enterprise license (`used`, paid) |
| **Manufacturing & Delivery** | *(empty)* | capability-registry + platform capabilities: Build Studio, GitHub delivery, scheduling, self-upgrade pipeline, edge-node fleet, marketing channels | Build Studio (`used`), GitHub (`used`), Postmark email (`available`), LinkedIn Ads (`potential`) |
| **For Employees** | *(empty; Facet B owned by 2026-06-07)* | productivity integrations (M365, Slack), internal tools the workforce consumes | Microsoft 365 (`available`), Slack (`potential`) — *workforce identities themselves remain Facet B / 2026-06-07* |
| **Products & Services Sold** | archetype market offer (`seed-market-offer.ts`) | **suppliers/goods** from archetype (the buy-side); SBOM as the sold product's bill-of-materials (`dpf-platform-standard`) | Plumber services (`sold`), plumber suppliers (`used`, vendor_management), parts/goods (`sold`) |

The **boundary with 2026-06-07 is clean**: that spec *populates Facet A's sold offers and Facet B's workforce identities*; this spec *populates the foundational/delivery floor those facets rest on, and adds the supply (buy-side) and component (SBOM) views*. They meet at the same `Portfolio` / `DigitalProduct` / `InventoryEntity` substrate and the same projection discipline.

## 3. Current-State Verification

Grounded by direct read (file:line):

- **Portfolio roots:** `packages/db/data/portfolio_registry.json` — exactly four (`foundational`, `manufacturing_and_delivery`, `for_employees`, `products_and_services_sold`), IT4IT §6.1–6.4.
- **`DigitalProduct` is thin** (`schema.prisma:583`): `productId`, `name`, `portfolioId?`, `taxonomyNodeId?`, `lifecycleStage` (default `plan`), `lifecycleStatus` (default `draft`), `version`, `description?`, `observationConfig Json?`. **No** `usageMode`/`source`/`productKind`/`procurementType` columns. `observationConfig Json?` is the only escape hatch.
- **`digital_product_registry.json` is rich but mostly dropped:** schema 2.3.0 carries `usage_mode` (`used`/`sold`), `product_kind`, `procurement_type` (`external_purchase`/`external_sale`), `criticality_tier`, `commercial_scope`, `realizes_model_ids` → `product_models` (Docker Business = seat license; Neo4j Enterprise = instance license; DPF Platform = subscription), `depends_on_product_ids`, `is_part_of_product_ids`, `source`/`source_confidence`. **`seedDigitalProducts` (`seed.ts:492–542`) reads only `product_id`, `name`, `description`, `portfolio_id`, `taxonomy_node_id`, `lifecycle.stage_status`.** The rest never reaches the DB.
- **`InventoryEntity` is the rich multi-source model** (`schema.prisma:3646`): `attributionStatus`, `attributionMethod`, `attributionConfidence`, `attributionEvidence Json`, `providerView` (default `"foundational"`), `properties Json`, `portfolioId?`, `taxonomyNodeId?`, `digitalProductId?`, `scopeKey` (default `organization:internal`), source via `lastConfirmedRun → DiscoveryRun.sourceSlug`. Promotion gate: `discovery-promotion.ts` (attributed + confidence ≥ 0.90 + taxonomyNode set + promotable type → `DigitalProduct`). **Only network/edge collectors write it today.**
- **Integration substrate exists, catalog unseeded:** `McpIntegration` (`schema.prisma:7886`: `category`, `subcategory`, `pricingModel`, `priorityTier` via benchmark, `archetypeIds`, `status`), `IntegrationCredential` (`schema.prisma:1348`: per-provider `status` unconfigured/connected/error, encrypted creds). `search_integrations` returns `[]` live → catalog not populated. QuickBooks integration is real (`apps/web/lib/integrate/quickbooks/*`, read-first).
- **SBOM substrate exists, not projected:** `cyclonedx-generator.ts` → `BomDocument` → `BomComponent` (`name`, `version`, `packageUrl`/PURL, `supplierName`, `licenseExpression`, `componentType`) → `BomComponentOccurrence`. `DigitalProduct.bomDocuments` relation exists; nothing renders components as portfolio entries. SBOM persistence/scanning tracked under **EP-ASSURANCE-LEDGER** (BI-ASSURANCE-P1-01, BI-96DFDC7D).
- **Capability registry exists, not projected:** `packages/storefront-templates/src/capability-registry.ts` — 32 capabilities each with **portfolio role + IT4IT stage** (the ideal Facet-C/D projector source). `operational-value-stream.ts` derives value streams. Neither writes portfolio instances.
- **Archetype seeding is half-wired:** `seed-market-offer.ts` seeds *sold services* into `products_and_services_sold`; `seed-portfolio-decomposition.ts` persists portfolio scope. **No supplier/goods seeding** despite `vendor_management` taxonomy + archetype `supplyChain` narrative.

**Live epic anchors (prefer over new epic):** EP-BOM-WIRING (home), EP-ASSURANCE-LEDGER (SBOM), EP-ARCH-GRAPH-LIVE (integration reality → EA graph), EP-MDM (survivorship), EP-PROACTIVE-OPS (lifecycle/criticality), EP-SBO (QuickBooks).

## 4. Design

### 4.1 The coverage axis (the new dimension)

A typed coverage status on the portfolio entry, ordered from most-committed to least:

| Coverage | Meaning | Source signal |
|---|---|---|
| `used` | Actively in use by the org | discovered running; credential connected; capability active |
| `sold` | A market offer (revenue) | archetype offer; commercial registry row |
| `available` | Integrated and configurable **now** | `IntegrationCredential` exists / provider configured but idle |
| `potential` | Catalogued, **one click to enable** | `McpIntegration` catalog row, no credential; capability not yet activated |
| `planned` | On the roadmap | backlog/lifecycle `idea`/`evaluate` |
| `retired` | Decommissioned | lifecycle `retire` |

This reuses the registry's `usage_mode` intent (`used`/`sold`) and extends it with the planning values. The portfolio surface gains a **coverage filter** so an operator can see "what we run" vs "what we could turn on" — the coverage/planning surface Mark asked for.

### 4.2 Source attribution (generalized)

Widen the source vocabulary already in play (`network_discovery`, `manual_entry`) with: `capability_registry`, `integration_registry`, `ai_provider`, `sbom`, `archetype`. Each projected row records its `source` and a confidence/trust grade, reusing `InventoryEntity.attributionMethod`/`attributionConfidence` and the registry's `source`/`source_confidence`. This is what lets §6 (MDM) reconcile the same real thing arriving from two sources (e.g. Docker seen by network discovery *and* named in the SBOM *and* in the manual registry).

### 4.3 The projector framework (reuse the promotion pipeline)

**Decision: discovered/overlapping sources project through `InventoryEntity`, then promote; authoritative sources write `DigitalProduct` directly.** `InventoryEntity` already carries attribution, dedup (`entityKey`), source-scoped staleness, `scopeKey` isolation, `properties Json`, and the promotion gate that places rows into the right portfolio + taxonomy node — the right path when a thing is *discovered* and may overlap another source (integrations, SBOM, AI providers that network discovery might also see). But **authoritative, deterministic sources have nothing to attribute** — we *know* Build Studio is the build system — so they write `DigitalProduct` directly with the coverage/source markers, the blessed `seed-market-offer.ts` pattern. The capability projector (P1) and archetype projector (P5) are authoritative; the integration/SBOM/AI-provider projectors (P2/P4) use the `InventoryEntity` attribution path with MDM survivorship.

**Storage staging (implementation):** coverage status + source kind are stamped into `DigitalProduct.observationConfig` JSON (the schema's existing extension point) behind a typed helper, so the framework + first projector ship without a runtime-bound Prisma migration. The typed `coverageStatus`/`sourceKind` enum columns are BI-PORTCOV-P0's remaining deliverable, to be generated via `prisma migrate dev` once a runtime is available; the read/write helper localizes that later move.

The projectors extend the existing landing model:

```
PortfolioSourceProjector (contract)
  source: PortfolioEntrySource          // 'capability_registry' | 'integration_registry' | 'ai_provider' | 'sbom' | 'archetype'
  scope:  scopeKey                       // org isolation, reuses discovery scoping
  project(): InventoryEntityUpsert[]     // each carries source, coverage, taxonomy hint, evidence
  → existing discovery-sync upsert (source-scoped, non-destructive)
  → existing promotion gate → DigitalProduct in portfolio + taxonomy node
```

Each projector is idempotent, source-scoped (only marks stale what *it* previously wrote — the invariant already proven in `discovery-sync-source-attribution.test.ts`), and runs on the existing scheduled-jobs cadence (no new cron family — reuse EP-SCHEDULING-SURFACE catalog).

### 4.4 Per-source projectors

1. **Capability / platform-capability projector → Foundational + Manufacturing & Delivery.** Read `capability-registry.ts` (32 capabilities already tagged with portfolio role + IT4IT stage) and the concrete platform subsystems behind them (Build Studio = `build-orchestrator.ts`, GitHub delivery = `github-api-commit.ts`, scheduling, self-upgrade, edge fleet, marketing channels). Project each as a `DigitalProduct` (`product_kind: platform_capability`) in its portfolio, coverage `used`. **This is the headline fix** — it makes "manufacture & delivery depends on GitHub and Build Studio" true in the portfolio.

2. **Integration projector → all four (category-routed).** Project `IntegrationCredential` rows as coverage `available`/`used` (status connected) and the `McpIntegration` catalog as coverage `potential`, routed to a portfolio by benchmark domain (`accounting_billing_payments` → Foundational/Financial or Products-sold supply; `crm_sales` → Products-sold; `communications_email_chat` → For Employees; `rmm_endpoint_device_management` → Manufacturing & Delivery). Carry `pricingModel` (free/paid) so the surface shows cost. **Prereq: seed the empty `McpIntegration` catalog** (the integration data already has the schema + benchmark metadata; the catalog rows are just missing).

3. **AI-provider projector → Foundational.** Project `ModelProvider` / `providers-registry.json` as Foundational compute supply, coverage `used` (configured) / `potential` (catalogued, unconfigured) — the local-first posture surfaces Docker Model Runner as `used` and cloud providers as `potential`.

4. **SBOM component projector → component layer of the sold/used product.** Project notable `BomComponent` rows (direct deps, runtime, and any with a `product_models` procurement link) as components/`depends_on` of `dpf-meta` / `dpf-platform-standard`, carrying `supplierName`, `licenseExpression`, PURL, and a **paid flag** derived from `procurement_type`/`product_models` (Docker Business, Neo4j Enterprise). This is the "third parties we lose track of" inventory. **Composes with EP-ASSURANCE-LEDGER** (reuse `BomComponent`; do not regenerate SBOM).

5. **Archetype supplier/goods projector → Products-sold (buy-side) + vendor_management.** Extend `seed-market-offer.ts`: where an archetype's `supplyChain`/operating-model implies suppliers and stocked goods (the plumber's merchants + van-stock parts), seed editable supplier entries under the `vendor_management` taxonomy node and goods entries distinct from services. Same non-destructive, operator-refines discipline.

### 4.5 Surface (no new route)

Layer coverage onto the existing `/portfolio` surface (per the maturity spec's "re-use nav, don't add sub-routes" rule): a **coverage filter/legend** (used / available / potential), a provenance chip (source), and — for `potential` integration rows — an **"Enable" affordance** that deep-links to the existing integration-connect flow. Enablement stays operator-governed; the portfolio never auto-connects anything. **UX-fit gated** (§12 AGENTS.md) — progressive disclosure, no raw config exposed.

## 5. Research & Benchmarking

The 2026-06-07 spec already grounds the IT4IT v3 / DPPM backbone, TM Forum SID, CSDM 4.0, and CycloneDX SBOM modeling (its §12–13). This section adds the references specific to the **multi-source projection** and **coverage/potential** concepts.

| Reference (real product/framework) | Data-model pattern read | Adopted | Rejected / anti-pattern |
|---|---|---|---|
| **Backstage Software Catalog** (CNCF) — `Component`/`Resource`/`System`/`API` entities with `owner`, `spec.type`, and **processors that ingest from many sources** into one catalog | The "many ingestion processors → one catalog entity model" is exactly the projector framework. | Projector-per-source into one `InventoryEntity`/`DigitalProduct` model; `owner` ≈ portfolio owner_role. | Backstage stores YAML-in-repo as source of truth — we keep the *substrate* canonical, not a YAML copy. |
| **SAP LeanIX / ServiceNow APM + CSDM** — Application Portfolio Management: `Application` ↔ `Business Capability` ↔ `Technology`, lifecycle, **TIME/cost disposition** | Portfolio entries carry lifecycle + capability link + cost; CSDM's Business/Application/Technical service split. | Capability link (capability-registry), lifecycle stage, cost via procurement layer. | Heavyweight CMDB classes — we reuse the thin `DigitalProduct` + rich `InventoryEntity`, not a new class tree. |
| **SaaS Management Platforms — Zylo / Productiv / Torii** — discover SaaS via SSO/finance/expense; classify **sanctioned vs discovered vs available**; surface unused licenses | The **sanctioned/discovered/available** trichotomy is the coverage axis; "available to enable" is a first-class state, not just "in use". | The `used`/`available`/`potential` coverage axis; cost/pricing surfaced per entry. | SMP's spend-optimization focus — we want *coverage/planning*, not seat-cost reclamation (DPF is local-first). |
| **Apptio TBM** — Cost Pools → IT Towers → Products & Services → Consumers; procurement/license basis | Procurement layer (`product_models`: seat/instance/subscription) as the cost anchor for paid components. | Keep `product_models` procurement layer; project the **paid flag** onto components. | Full TBM cost allocation — out of scope; we surface *whether* it's paid, not chargeback math. |
| **CycloneDX 1.7** (already used) — components/services/dependencies, PURL, `supplier`, license | SBOM is a typed dependency graph with stable component identity. | Reuse `BomComponent` as the component layer; PURL as identity; supplier/license/paid surfaced. | Re-deriving an SBOM in the portfolio — we project the existing one. |

**Net design fills the gap** none of the above cover for DPF: a **local-first, self-hosted** platform that must project *its own* operating model (the recursion) and a *customer's* operating model through the **same** projection layer, with a coverage axis that includes "potential" as a planning aid rather than a spend-reclamation lever.

## 6. Data-Model Stewardship (§11 AGENTS.md)

- **`DigitalProduct` stays the canonical portfolio entry.** It is thin today; the coverage + source + procurement fields the registry already describes need a home. **Open decision (plan):** typed columns on `DigitalProduct` (`coverageStatus`, `sourceKind`, `procurementType`) vs. structured keys in `observationConfig Json?`. Recommendation: typed `coverageStatus` + `sourceKind` (they drive filtering/queries and a closed enum belongs in a column per §3 strongly-typed-string-enums), procurement detail in JSON until a cost feature needs it.
- **`InventoryEntity` is the multi-source landing model — reuse it.** It already has attribution, dedup, scope, `properties Json`, and promotion. Projectors widen its `attributionMethod`/source vocabulary; no new landing table.
- **No parallel table.** Integrations stay in `McpIntegration`/`IntegrationCredential`; components in `BomComponent`; capabilities in `capability-registry.ts`. Projectors materialize *views* into the portfolio; the substrates remain canonical (single-source-of-truth).
- **MDM survivorship (EP-MDM).** The same real thing (e.g. Docker) can arrive from network discovery + SBOM + manual registry. The projector framework must reconcile on a stable key (PURL for components, provider id for integrations, capability id for capabilities) and pick a survivor — this is exactly EP-MDM's "source crosswalk & survivorship." Cross-link, don't reinvent.
- **Procurement layer.** `product_models` (registry) is the existing home for "what we pay for and how it's licensed." Keep it; the SBOM projector links components to it via `realizes_model_ids` to derive the paid flag.

## 7. Phased Plan (BIs under EP-BOM-WIRING)

Ordered by dependency; each filed via the governed path (size → triage → link epic).

- **P0 — Coverage & source schema audit + decision (keystone enabler).** Confirm where `coverageStatus`/`sourceKind` live (column vs JSON); confirm `InventoryEntity` can carry non-network sources without breaking source-scoped staleness; write the projector contract. *(small)*
- **P1 — Projector framework + capability projector (keystone).** The `PortfolioSourceProjector` contract + the first projector (capability-registry → Foundational + Manufacturing & Delivery: Build Studio, GitHub, scheduling, self-upgrade, edge fleet). Makes 3-of-4 portfolios non-empty. *(large)*
- **P2 — Integration projector + seed the catalog.** Seed `McpIntegration` from the benchmark metadata; project credentials (`available`/`used`) + catalog (`potential`), category-routed, with pricing. *(large)* — **landed (refined)**: the `McpIntegration` marketplace is empty on a fresh install, so rather than seed it, project from a curated `supported-integrations-manifest.ts` (the integrations DPF actually has adapters for). `project-external-supply.ts` projects **AI providers** (live `ModelProvider` → Foundational; configured `used`, catalogued `potential` — also covers P3 below) **+ business integrations** (connected `used` / credential-exists `available` / else `potential`), routed accounting·hr·crm·comms·work → For Employees, identity·cloud → Foundational, ticketing·rmm → Manufacturing & Delivery, carrying pricing. Global (seed.ts), idempotent, non-destructive.
- **P3 — AI-provider projector → Foundational.** Configured = `used`, catalogued = `potential`; local-first surfaces Docker Model Runner. *(medium)*
- **P4 — SBOM component projector.** Project `BomComponent` as the component layer of `dpf-meta`/`dpf-platform-standard` with supplier/license/PURL + paid flag; compose with EP-ASSURANCE-LEDGER. *(medium)*
- **P5 — Archetype supplier/goods projector.** Extend `seed-market-offer.ts` with suppliers (vendor_management) + goods; plumber exemplar. *(medium)* — **landed**: `packages/db/src/portfolio-sources/archetype-supply-manifest.ts` (per-category starters) + `project-archetype-supply.ts` (reuses the projector writer), wired into onboarding `setup-progress.ts` alongside `seedMarketOffer`. Suppliers → Manufacturing & Delivery (`used`), goods → Products & Services Sold (`sold`), source `archetype`; non-destructive + idempotent.
- **P6 — Coverage surface UX.** Coverage filter/legend + provenance chip + "Enable" deep-link on `potential` rows; UX-fit gated; no new route. *(medium)*
- **P7 — Coverage/source parity guard.** A test asserting the projected portfolio stays in sync with the live substrates (mirrors the EP-SCHEDULING-SURFACE catalog↔registry parity guard) — so a new integration/capability/dependency can't silently fall out of the portfolio. *(small)*

## 8. Acceptance Criteria

1. A fresh install's `manufacturing_and_delivery` portfolio lists Build Studio, GitHub delivery, scheduling, self-upgrade, and the edge fleet — projected from `capability-registry.ts`, not hand-entered.
2. The `foundational` portfolio includes AI providers (Docker Model Runner `used`; cloud providers `potential`) and SBOM components with supplier/license + paid flag (Docker Business, Neo4j Enterprise).
3. Integrations appear in their portfolios with a coverage status: QuickBooks `available`/`used`, catalogued integrations `potential` — and `search_integrations` is non-empty.
4. The plumber archetype seeds editable **suppliers** (vendor_management) and **goods** distinct from services.
5. Every projected entry carries a **source** (provenance chip) and a **coverage status**; the `/portfolio` surface filters by coverage; `potential` integration rows offer a governed "Enable" deep-link (no auto-connect).
6. **No parallel substrate:** integrations/components/capabilities stay canonical in their registries; projectors materialize views into `InventoryEntity`/`DigitalProduct`. Same-thing-from-two-sources reconciles via EP-MDM survivorship.
7. The parity guard fails CI if a live capability/integration/runtime dependency has no portfolio projection.

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Projected rows overwrite operator edits | Non-destructive upsert + source-scoped staleness (proven pattern); operator-edited fields preserved. |
| Coverage `potential` reads as noise / over-claims | `potential` is opt-in to view (filtered off by default); never implies it's enabled; "Enable" is governed. |
| Same thing duplicated across sources | MDM survivorship on a stable key (PURL/provider-id/capability-id) — EP-MDM, not a bespoke dedup. |
| Treating the customer as a software factory | Recursion vs customer-overlay split is inherited from 2026-06-07 §2.1 (`installScope`); capability projector is DPF-scope; customer installs project *their* capabilities/integrations. |
| Schema churn on `DigitalProduct` | Audit-first (P0); prefer JSON home until a closed enum/query needs a column. |
| Scope creep into spend management | Explicit non-goal; surface pricing/paid flag, not chargeback. |
| New cron sprawl for projectors | Reuse the EP-SCHEDULING-SURFACE canonical catalog; one staggered projection job, not one cron per source. |

## 10. Open Decisions for the Plan

1. `coverageStatus`/`sourceKind` as typed columns vs `observationConfig` JSON keys (recommend typed for the two filtering enums).
2. Projector cadence: onboarding + scheduled refresh vs event-triggered on substrate change (recommend scheduled via the scheduling catalog, event-trigger later).
3. SBOM projection granularity: all components vs direct + paid + runtime only (recommend the latter to avoid 2000-row noise; surface the rest on the product's supply-chain tab).
4. Integration→portfolio routing table: confirm the benchmark-domain → portfolio map (draft in §4.4.2).
5. Does the capability projector read `capability-registry.ts` directly, or a thin manifest of "platform subsystems as products" (Build Studio, GitHub) that the registry doesn't enumerate at subsystem granularity? (recommend a small manifest composed with the registry.)

---

*Companion to [`2026-06-07-business-operating-model-portfolio-wiring-design.md`](2026-06-07-business-operating-model-portfolio-wiring-design.md). This spec is the Facet-C/D + source-projection + coverage-axis extension; that spec remains authoritative for Facets A/B, WWWD grounding, and backlog fan-out.*
