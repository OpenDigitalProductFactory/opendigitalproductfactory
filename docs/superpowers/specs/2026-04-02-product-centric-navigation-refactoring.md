# Product-Centric Navigation Refactoring

| Field | Value |
|-------|-------|
| **Epic** | EP-NAV-REFACTOR-001 |
| **IT4IT Alignment** | Cross-cutting: touches all seven value streams (Evaluate through Operate) by restructuring how users access lifecycle data for each Digital Product |
| **Depends On** | 2026-03-10 Portfolio Route Design (implemented), 2026-03-21 CSDM 6 Digital Product Meta-Model (implemented), 2026-03-14 Discovery Taxonomy Attribution (implemented) |
| **Predecessor Specs** | Portfolio Route Design, CSDM 6 Meta-Model, Discovery Taxonomy Attribution, HR Full Lifecycle Design, Contribution Mode & Git Integration |
| **Status** | Draft |
| **Created** | 2026-04-02 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

---

## 1. Problem Statement

The platform has grown organically around **functional top-level routes** (Backlog, Inventory, EA Modeler, AI Workforce, Build). Managing a single Digital Product requires bouncing between 5+ routes. Several structural problems have emerged:

### 1.1 Structural Misalignment

| Problem | Example | Root Cause |
|---------|---------|------------|
| **System Health under Backlog** | `/ops/health` is a tab alongside Backlog items and Changes | Operations was the catch-all for "stuff that doesn't fit elsewhere" |
| **No product home** | Product detail (`/portfolio/product/[id]`) shows only metadata + business model assignment | Products were modeled as taxonomy leaf data, not as first-class lifecycle entities |
| **Infrastructure leaks to users** | SystemHealthDashboard references Docker containers, monitoring stack internals | Health was built for platform operators, not product owners |
| **Taxonomy as rigid structure** | Full 481-node tree always rendered in sidebar | Small orgs see hundreds of empty nodes; taxonomy is reference data, not navigation structure |
| **Cross-cutting views are primary** | Backlog (`/ops`) is a top-level nav item showing all items across all products | Users manage products through aggregate views instead of product-specific ones |

### 1.2 What IT4IT and DPPM Require

Per G252 Section 2.1 and W205, a Digital Product:
- Has a **full lifecycle** from approved idea to retirement with residual obligations
- Is managed through **two parallel lifecycles**: system (code, infra, deployment) and contract (subscriptions, billing, support)
- Is the **unit of accountability** — Product Managers own financial outcomes, not just technical delivery
- Is accessed through its **Portfolio Type** (Foundational, Manufacture & Delivery, For Employees, Products & Services Sold)

The current UI treats products as inventory records. It should treat them as **living entities with lifecycle views**.

### 1.3 The Portal as a Digital Product

The portal application itself is a Digital Product under Foundational/Platform Services. It should have its own lifecycle view where System Health is naturally one of its tabs — not an orphan under Backlog/Operations.

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **Product is the anchor entity** | Per CSDM 6 meta-model: everything connects to and flows through the Digital Product |
| P2 | **Portfolio as primary navigation** | Per G252: portfolios define operating context, governance, and financial management |
| P3 | **Taxonomy is reference, not structure** | Only render nodes with attributed products; allow orgs to flatten/combine; depth grows with org |
| P4 | **No infrastructure in user-facing UI** | Docker, containers, monitoring stack are implementation details the platform manages |
| P5 | **Cross-cutting views are secondary** | Aggregate Backlog, Inventory, EA views still exist but are not the primary management path |
| P6 | **Lifecycle tabs, not functional silos** | A product's home shows all lifecycle aspects as tabs: Overview, Backlog, Health, Architecture, Changes, Inventory |
| P7 | **Progressive disclosure of complexity** | Start simple (few products, few taxonomy nodes); complexity emerges as the organization grows. Aligned to US Patent 8,635,592 "Method and system for tailoring software functionality" (Bodman, 2014) — the platform adapts its visible feature surface to the user's current operational scale rather than exposing the full capability set upfront |

---

## 3. Information Architecture

### 3.1 Navigation Hierarchy (New)

```
Header Nav:
  My Workspace          /workspace              (unchanged — personal dashboard)
  Portfolio             /portfolio              (ENHANCED — primary product access)
  Backlog               /ops                    (DEMOTED — cross-cutting aggregate)
  Inventory             /inventory              (DEMOTED — cross-cutting aggregate)
  EA Modeler            /ea                     (DEMOTED — cross-cutting aggregate)
  AI Workforce          /platform/ai            (unchanged — platform governance)
  Build                 /build                  (unchanged — Build Studio)
  Docs                  /docs                   (unchanged)
```

The visible change in the header is minimal. The transformation happens **inside** Portfolio and in the product detail experience.

### 3.2 Portfolio Route (Enhanced)

**Current**: Portfolio shows a taxonomy tree sidebar with node detail panels. Products are leaf-node lists.

**New**: Portfolio becomes the primary product management surface.

```
/portfolio                              Portfolio Overview (4 portfolio cards)
/portfolio/[...slug]                    Taxonomy drill-down (unchanged mechanics)
/portfolio/product/[id]                 PRODUCT LIFECYCLE HOME (NEW — tabbed)
/portfolio/product/[id]/backlog         Product Backlog tab
/portfolio/product/[id]/health          Product Health tab
/portfolio/product/[id]/architecture    Product Architecture tab
/portfolio/product/[id]/changes         Product Changes tab
/portfolio/product/[id]/inventory       Product Inventory tab
/portfolio/product/[id]/versions        Product Versions tab
/portfolio/product/[id]/offerings       Product Service Offerings tab
/portfolio/product/[id]/team            Product Team & Roles tab
```

### 3.3 Product Lifecycle Home — Tab Definitions

Each tab maps to one or more IT4IT value streams and surfaces data that already exists in the platform but is currently scattered across functional routes.

| Tab | IT4IT Value Stream | Data Source | What It Shows |
|-----|-------------------|-------------|---------------|
| **Overview** | Evaluate, Explore | `DigitalProduct`, `Portfolio`, `TaxonomyNode`, `BusinessModel` | Product metadata, lifecycle stage/status, version, portfolio placement, taxonomy classification, business model, team summary, dependency graph preview |
| **Backlog** | Explore, Integrate | `BacklogItem` where `digitalProductId = product.id` | Filtered backlog: open items, epics, priorities. Same component as `/ops` but scoped to this product |
| **Health** | Operate | `observationConfig`, monitoring data, `ServiceOffering` SLA targets | Product-specific health: availability, error rates, SLA compliance. For the portal product, this is System Health |
| **Architecture** | Evaluate, Explore | `EaElement` where `digitalProductId = product.id` | EA elements attributed to this product: capabilities, services, components, dependencies |
| **Changes** | Integrate, Deploy | `ChangeItem` where product relation, `FeatureBuild` | Change history, active builds, promotion status, deployment history |
| **Inventory** | Operate | `InventoryEntity` where `digitalProductId = product.id` | Discovered infrastructure, runtime facts, software/packages attributed to this product |
| **Versions** | Deploy, Release | `ProductVersion` | Version history, git tags, deployment timestamps, release notes |
| **Offerings** | Release, Consume | `ServiceOffering` | Service offers, pricing tiers, SLA definitions, active contracts |
| **Team** | Cross-cutting | `BusinessModelRoleAssignment`, `EmployeeProfile` | Current page content (business model + role assignments) plus team directory |

### 3.4 The Portal as a Digital Product

The portal application must be seeded as a first-class `DigitalProduct` record:

```
productId:        "dpf-portal"
name:             "Digital Product Factory Portal"
portfolioId:      (Foundational portfolio)
taxonomyNodeId:   (Platform Services node under Foundational)
lifecycleStage:   "operate"
lifecycleStatus:  "active"
version:          (read from package.json at seed time)
```

When users navigate to this product's Health tab, they see the `SystemHealthDashboard` — but without Docker commands, container names, or monitoring stack internals. The dashboard must present **service-level health** (API response times, database connectivity, vector store availability, AI inference routing) not infrastructure-level details.

### 3.5 Full Taxonomy as EA Reference Model

The current 481-node taxonomy (APQC-based) is seeded into `TaxonomyNode` and rendered only in the Portfolio sidebar. This conflates two concerns: **navigation** (how users find their products) and **reference data** (the canonical capability framework an organization has adopted).

**Design**: The full taxonomy is surfaced as a **Reference Model** under EA Modeler (`/ea/models`), alongside other industry-standard frameworks:

| Reference Model | Source | Industry | Status |
| --------------- | ------ | -------- | ------ |
| **APQC Process Classification Framework** | `taxonomy_v2.json` | Cross-industry | Seeded (current taxonomy) |
| **BIAN (Banking Industry Architecture Network)** | Future import | Banking & Financial Services | Planned |
| **TM Forum Frameworx** | Future import | Telecommunications | Planned |
| **ACORD** | Future import | Insurance | Planned |
| **HL7 FHIR** | Future import | Healthcare | Planned |

Each reference model is a self-contained capability taxonomy. Organizations select which model(s) to activate. The Portfolio taxonomy tree renders nodes from the **active** model(s) only. An organization might use APQC as their base and overlay BIAN for banking-specific capabilities.

**How it works**:

1. Reference models are browseable at `/ea/models/[slug]` — the full tree is always visible here for exploration, mapping, and governance regardless of how many products are attributed
2. The Portfolio sidebar renders only the **active** model's nodes that have products (progressive disclosure — see below)
3. When a new industry model is imported, its nodes are added to `TaxonomyNode` with a `source` or `modelSlug` discriminator
4. Products can be attributed to nodes from any active model — a banking product might sit under a BIAN node while internal tools sit under APQC nodes

This separates two distinct workflows:

| Workflow | Where | Who | Frequency | What Happens |
| -------- | ----- | --- | --------- | ------------ |
| **Curate the reference** | EA Modeler > Reference Models | EA team, taxonomy owner | Periodic (quarterly, on standards release) | Import new version of APQC/BIAN/etc., review node additions/removals/renames, map changes to existing product attributions, approve updates |
| **Use the reference** | Portfolio sidebar | Product managers, day-to-day users | Daily | Navigate to products through the pruned, product-populated subset of the active taxonomy |

The update process (curating) should never disrupt the navigation process (using). When a reference model is updated — e.g., APQC releases a new version — the EA team reviews the diff under Reference Models, maps any renamed/removed nodes to their replacements, and publishes the update. Products attributed to changed nodes get flagged for re-attribution. The Portfolio sidebar reflects changes only after the update is published.

This is analogous to how a chart of accounts works in finance: the finance team maintains the structure; everyone else just posts against it.

### 3.6 Taxonomy Rendering — Progressive Disclosure

**Current behavior**: The `PortfolioTree` sidebar renders the full taxonomy hierarchy. Empty nodes are visible.

**New behavior**:

1. **Only render nodes with products (direct or cumulative `totalCount > 0`)**. Empty branches are pruned from the tree.
2. **Allow a "Show all nodes" toggle** for taxonomy administrators who need to see the full structure.
3. **When an org has fewer than ~20 products**, flatten the tree: show Portfolio root > Products directly, skipping intermediate L1/L2 nodes that only pass through. As the org grows and adds more products, the intermediate structure naturally appears.
4. **Search/filter in sidebar**: let users find products by name without navigating the tree.

Implementation: modify `buildPortfolioTree()` in `apps/web/lib/evaluate/portfolio.ts` to accept a `pruneEmpty: boolean` parameter (default `true`). The `PortfolioTree` component reads a user preference or defaults to pruned.

---

## 4. Route Changes

### 4.1 New Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/portfolio/product/[id]/backlog` | `ProductBacklogTab` | Backlog items scoped to product |
| `/portfolio/product/[id]/health` | `ProductHealthTab` | Health metrics scoped to product |
| `/portfolio/product/[id]/architecture` | `ProductArchitectureTab` | EA elements scoped to product |
| `/portfolio/product/[id]/changes` | `ProductChangesTab` | Change items and builds scoped to product |
| `/portfolio/product/[id]/inventory` | `ProductInventoryTab` | Inventory entities scoped to product |
| `/portfolio/product/[id]/versions` | `ProductVersionsTab` | Version history |
| `/portfolio/product/[id]/offerings` | `ProductOfferingsTab` | Service offerings |
| `/portfolio/product/[id]/team` | `ProductTeamTab` | Current business model + role panel |

### 4.2 Modified Routes

| Route | Change |
|-------|--------|
| `/portfolio/product/[id]` (existing) | Becomes the **Overview** tab of the product lifecycle home. Add `ProductTabNav` component. Existing business model content moves to `/portfolio/product/[id]/team`. |
| `/ops/health` | **Remove** as a standalone route. System Health becomes the Health tab of the portal product (`/portfolio/product/{portal-id}/health`). Add redirect from `/ops/health` to the portal product's health tab. |
| `/ops` | Remains as cross-cutting backlog aggregate. Add "View in product" links on each backlog item that has a `digitalProductId`. |
| `/inventory` | Remains as cross-cutting aggregate. Add "View in product" links on each inventory entity that has a `digitalProductId`. |

### 4.3 Removed Routes

| Route | Replacement |
|-------|-------------|
| `/ops/promotions` | Promotions are change events — accessible from a product's Changes tab or from cross-cutting Changes |

### 4.4 Redirects

| Old Path | New Path | Mechanism |
|----------|----------|-----------|
| `/ops/health` | `/portfolio/product/{portal-cuid}/health` | Next.js `redirect()` in page, resolved at build/seed time via a well-known productId `dpf-portal` |

---

## 5. Component Architecture

### 5.1 New Components

```
apps/web/components/product/
  ProductTabNav.tsx          Tab navigation for product lifecycle home
  ProductOverviewTab.tsx     Overview content (extracted from current page.tsx)
  ProductBacklogTab.tsx      Backlog items filtered by digitalProductId
  ProductHealthTab.tsx       Health dashboard scoped to product
  ProductArchitectureTab.tsx EA elements filtered by digitalProductId
  ProductChangesTab.tsx      Changes + builds filtered by product relation
  ProductInventoryTab.tsx    Inventory entities filtered by digitalProductId
  ProductVersionsTab.tsx     Version history list
  ProductOfferingsTab.tsx    Service offerings list
  ProductTeamTab.tsx         Business model + role assignments (current page content)
```

### 5.2 Modified Components

| Component | Change |
|-----------|--------|
| `PortfolioTree.tsx` | Add `pruneEmpty` prop, product search input, flatten logic for small orgs |
| `PortfolioNodeDetail.tsx` | Product list items become links to `/portfolio/product/[id]` (already are, but make them more prominent with lifecycle stage badges) |
| `SystemHealthDashboard.tsx` | Remove any Docker/container references. Present service-level health only. Accept optional `productId` prop to scope metrics. |
| `OpsTabNav.tsx` | Remove "System Health" tab. Keep Backlog, Improvements, Changes. |
| `Header.tsx` NAV_ITEMS | No change to labels/hrefs (Portfolio is already there). Consider visual emphasis on Portfolio as primary. |

### 5.3 Layout Structure

The product lifecycle home uses a Next.js layout at `/portfolio/product/[id]/layout.tsx`:

```tsx
// apps/web/app/(shell)/portfolio/product/[id]/layout.tsx
export default async function ProductLayout({ params, children }) {
  const product = await getProduct(params.id);
  if (!product) notFound();

  return (
    <div>
      <ProductHeader product={product} />
      <ProductTabNav productId={product.id} />
      {children}
    </div>
  );
}
```

The current `/portfolio/product/[id]/page.tsx` content (business model + roles) moves to the `team` sub-route. The `page.tsx` becomes the Overview tab.

---

## 6. Data Requirements

### 6.1 Seed Changes

**New seed record**: The portal application as a DigitalProduct.

```typescript
// In packages/db/prisma/seed.ts or seed script
{
  productId: "dpf-portal",
  name: "Digital Product Factory Portal",
  portfolioId: foundationalPortfolio.id,
  taxonomyNodeId: platformServicesNode.id,
  lifecycleStage: "operate",
  lifecycleStatus: "active",
  version: "1.0.0",  // or read from package.json
  description: "The Digital Product Factory platform itself — portal application, AI workforce, monitoring, and administration.",
}
```

### 6.2 Schema Changes

**None required.** All necessary relationships already exist:
- `DigitalProduct.backlogItems` (BacklogItem[])
- `DigitalProduct.eaElements` (EaElement[])
- `DigitalProduct.inventoryEntities` (InventoryEntity[])
- `DigitalProduct.changeItems` (ChangeItem[])
- `DigitalProduct.featureBuilds` (FeatureBuild[])
- `DigitalProduct.versions` (ProductVersion[])
- `DigitalProduct.serviceOfferings` (ServiceOffering[])
- `DigitalProduct.businessModels` (ProductBusinessModel[])
- `DigitalProduct.observationConfig` (Json)

The existing schema already supports product-centric views. The gap is entirely in the UI layer.

### 6.3 Query Patterns

Each product tab requires a filtered query. Examples:

```typescript
// Backlog tab
prisma.backlogItem.findMany({
  where: { digitalProductId: productId },
  orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
});

// Inventory tab
prisma.inventoryEntity.findMany({
  where: { digitalProductId: productId },
  orderBy: { name: "asc" },
});

// Changes tab
prisma.changeItem.findMany({
  where: { products: { some: { id: productId } } },
  orderBy: { createdAt: "desc" },
});
```

These are straightforward filtered versions of queries already used in the cross-cutting views.

---

## 7. System Health Abstraction

### 7.1 Current State

`SystemHealthDashboard.tsx` currently shows:
- Container status (Docker-specific)
- Database connectivity
- Vector store (Qdrant) status
- AI inference routing
- Resource utilization

### 7.2 Target State

The Health tab must present **service-level abstractions**:

| Current (Infrastructure) | New (Service-Level) |
|--------------------------|---------------------|
| "postgres container running" | "Database: Connected, 23ms latency" |
| "qdrant container healthy" | "Knowledge Store: Available" |
| "docker model runner loaded" | "AI Inference: Local model active" |
| Container CPU/memory stats | "Platform Resource Utilization: Normal" |
| Docker commands to restart | (removed — platform self-manages) |

### 7.3 Scoped Health for Non-Portal Products

For products other than the portal, the Health tab shows:
- **Observation config** (if defined via `observationConfig` JSON field)
- **SLA compliance** (from `ServiceOffering` targets vs actual metrics)
- **Backlog health** (open bug count, overdue items)
- **Dependency health** (are products this one depends on healthy?)

This is a placeholder for Phase 2 — initially, only the portal product has a meaningful Health tab. Other products show a "Configure health monitoring" prompt.

### 7.4 Graph-Based Impact Analysis (Future Integration)

Health monitoring spans three layers that connect through the Neo4j dependency graph:

```text
Provider Health          AI Coworker Health         Product Health
(latency, availability)  (success rate, tokens)     (SLA compliance, bugs)
        │                        │                         │
        └────────┬───────────────┘                         │
                 ▼                                         │
         Neo4j Dependency Graph                            │
    (provider → agent → product → offering → consumer)     │
                 │                                         │
                 └─────────────────────────────────────────┘
                           Impact Analysis
```

When a provider degrades, the graph traces impact: **provider** → agents that route through it → **products** those agents serve → **service offerings** affected → **consumers** impacted. This is the IT4IT Operate value stream's impact analysis capability.

Provider and AI Coworker health monitoring is being built in a parallel thread. The product Health tab should:

1. **Consume** upstream dependency health signals from the graph layer (not duplicate the monitoring)
2. **Display** a "Dependency Health" section showing the health status of providers and agents this product relies on
3. **Link** to the graph visualization for full impact analysis when available

The graph-based impact analysis is a key differentiator — it connects the operational monitoring layer (providers, agents) to the business accountability layer (products, offerings, SLAs) through the same Neo4j graph used for EA modeling and inventory relationships.

---

## 8. Implementation Phases

### Phase 1: Product Lifecycle Home (Core)

**Goal**: Every Digital Product gets a tabbed lifecycle view.

1. Create `/portfolio/product/[id]/layout.tsx` with `ProductHeader` + `ProductTabNav`
2. Move current product page content to Overview tab
3. Move business model + role panel to Team tab
4. Create Backlog tab (filter existing backlog view by `digitalProductId`)
5. Create Inventory tab (filter existing inventory view by `digitalProductId`)
6. Create Changes tab (filter change items by product relation)
7. Create Versions tab (list `ProductVersion` records)
8. Create Offerings tab (list `ServiceOffering` records)
9. Create Architecture tab (filter `EaElement` by `digitalProductId`)

### Phase 2: Portal as Digital Product + Health

**Goal**: The portal is a first-class product; System Health moves to its Health tab.

1. Seed the portal as a `DigitalProduct` record
2. Abstract `SystemHealthDashboard` to remove infrastructure references
3. Create Health tab component
4. Wire portal product Health tab to abstracted dashboard
5. Remove `/ops/health` route, add redirect
6. Remove "System Health" from `OpsTabNav`

### Phase 3: Taxonomy as Reference Model + Progressive Disclosure

**Goal**: Full taxonomy viewable under EA Reference Models; Portfolio sidebar shows only what's relevant.

1. Register the APQC taxonomy as a Reference Model entry in `/ea/models`
2. Create a detail view at `/ea/models/apqc` that renders the full 481-node tree for exploration and governance
3. Add `pruneEmpty` parameter to `buildPortfolioTree()`
4. Add flatten logic for orgs with < ~20 products
5. Add product search to `PortfolioTree` sidebar
6. Add "Show all nodes" toggle for taxonomy admins
7. Persist preference (localStorage or user setting)
8. Design the data model extension for multi-taxonomy support (source/modelSlug discriminator on `TaxonomyNode`) — implementation deferred until a second industry model is needed

### Phase 4: Cross-Cutting View Integration

**Goal**: Aggregate views link back to product lifecycle homes.

1. Add "View in product" links to backlog items in `/ops`
2. Add "View in product" links to inventory entities in `/inventory`
3. Add "View in product" links to EA elements in `/ea`
4. Add product filter/grouping controls to aggregate views
5. Consider product-grouped default view for backlog (group by product, then by status)

---

## 9. Migration & Backwards Compatibility

### 9.1 No Breaking URL Changes (Phase 1-2)

- All existing routes continue to work
- `/ops/health` gets a redirect (not a 404)
- `/portfolio/product/[id]` gains tabs but the URL still works (it becomes the Overview tab)
- Cross-cutting views (`/ops`, `/inventory`, `/ea`) remain fully functional

### 9.2 Data Migration

None required. All relationships exist in the schema. Products that don't have attributed backlog items, inventory entities, or EA elements simply show empty tabs with helpful prompts.

### 9.3 Permission Model

Product lifecycle tabs inherit the capability check from the parent route:
- Viewing any product tab requires `view_portfolio`
- Specific tabs may additionally check `view_operations` (Health), `view_inventory` (Inventory), `view_ea_modeler` (Architecture)
- This is additive — no existing permissions are removed

---

## 10. Out of Scope

| Item | Reason |
|------|--------|
| **Financial management tabs** (P&L, chargeback) | Requires Finance integration not yet built; future phase |
| **Contract lifecycle views** | `ServiceOffering` exists but contract management (W205) is not yet implemented |
| **Dependency graph visualization** | Neo4j graph data exists but interactive visualization is a separate epic |
| **Multi-product comparison views** | Useful for portfolio managers but not part of the per-product home |
| **Custom tab configuration** | Product types may need different tab sets; defer until usage patterns emerge |
| **APQC as formal EA Reference Model** | The current taxonomy incorporates APQC-derived capability descriptions, but APQC is a process classification framework. Until the platform has explicit process entities (not just capabilities), surfacing it as a reference model would be misleading. Defer until process modeling is implemented. |
| **Importing additional industry taxonomies** (BIAN, TM Forum, etc.) | The architecture supports it (Section 3.5) but actual import is a separate epic per industry model. Industry models like BIAN are more useful when the platform can represent processes, not just capabilities. |
| **Mobile/responsive layout** | Platform is desktop-first; responsive is a separate concern |

---

## 11. Success Criteria

1. A user can click into any Digital Product from the Portfolio tree and see all lifecycle aspects in one tabbed view
2. The portal application appears as a product under Foundational/Platform Services with System Health as its Health tab
3. No Docker commands, container names, or monitoring stack internals appear in any user-facing UI
4. Small organizations (< 20 products) see a clean, sparse taxonomy tree — not 481 empty nodes
5. All existing cross-cutting views continue to work, with added links to product-specific views
6. No schema migrations required — the refactoring is purely UI/routing
7. The full APQC taxonomy is browseable as a Reference Model under EA Modeler, and the architecture supports adding industry-specific taxonomies (BIAN, TM Forum, etc.) as additional reference models

---

## 12. IT4IT Alignment Verification

| IT4IT Requirement | How This Spec Addresses It |
|------|--------|
| **Digital Product as unit of management** (G252 S2.1) | Product lifecycle home makes each product the anchor for all management activities |
| **Portfolio-aware governance** (G252 S4) | Products are accessed through their portfolio placement; governance varies by portfolio type |
| **Full lifecycle visibility** (W205 Figure 5) | Tabs span from Evaluate (Overview) through Operate (Health, Inventory) |
| **Product Manager accountability** (G252 S2.3) | Team tab assigns business model roles; Overview shows lifecycle stage and status |
| **Dependency awareness** (W205 S3.4) | Architecture tab shows EA elements and dependencies; Inventory shows discovered infrastructure |
| **Service Offer formalism** (W205 S2.2) | Offerings tab surfaces ServiceOffering records with SLA targets and pricing |
| **Seven value streams** (G252 S5) | Each tab maps to one or more value streams (see Section 3.3 table) |

---

## 13. Appendix: Current vs New Navigation Flow

### Current: Managing a Product's Backlog
```
Portfolio (nav) → Tree sidebar → Find node → See product in list → Click product →
See metadata only → Go back → Backlog (nav) → Find items for that product (if you can)
```

### New: Managing a Product's Backlog
```
Portfolio (nav) → Tree sidebar → Find node → Click product → Backlog tab
```

### Current: Checking Platform Health
```
Backlog (nav) → System Health tab → See Docker containers and monitoring stack
```

### New: Checking Platform Health
```
Portfolio (nav) → Foundational → Platform Services → DPF Portal → Health tab →
See service-level health (no infrastructure details)
```
