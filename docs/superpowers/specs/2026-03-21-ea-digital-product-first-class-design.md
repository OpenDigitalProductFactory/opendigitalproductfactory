# Digital Product as EA First-Class Citizen

**Date:** 2026-03-21
**Status:** Draft
**Epic:** EP-EA-DP
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Depends on:**
- `docs/superpowers/specs/2026-03-12-phase-ea-modeling-foundation-design.md` (EA meta-model, element types, notations)
- `docs/superpowers/specs/2026-03-21-foundation-portfolio-operations-console-design.md` (operational graph, health probes)
- `docs/superpowers/specs/2026-03-21-change-deployment-management-design.md` (RFC, change impact)
- `docs/superpowers/specs/2026-03-21-digital-product-unified-ontology-design.md` (ontology — parallel track)
- `docs/Reference/EALab_ArchiMate-4.pdf` (ArchiMate 4 notation)
- `docs/Reference/CSDM 5.pdf` (CSDM entity taxonomy)
- `docs/Reference/Introducing_ITIL_5.pdf` (ITIL v5 Digital Product concept)

## Problem Statement

The EA modeling layer supports ArchiMate 4 notation with elements spanning business, application, technology, strategy, motivation, and common domains. Digital Product does not have a native element type in ArchiMate or any current EA notation standard:

1. **ArchiMate 4** forces Digital Product into Application Component — this loses the business layer context (value proposition, service offer, portfolio position, investment profile). An Application Component is an implementation artifact; a Digital Product spans business intent through operational delivery.
2. **CSDM 5** maps to Business Application — this is a ServiceNow-specific taxonomy that doesn't carry lifecycle richness or portfolio partitioning. CSDM 6 is expected to add Digital Product, but the specification is not yet available.
3. **ITIL v5** recognizes Digital Product conceptually but provides no modeling element — architects cannot represent it in diagrams or views.

The consequence: EA views cannot show Digital Products as first-class entities that span layers. Architects must choose between showing the business context (losing technical detail) or the technical implementation (losing business context). The ontology demands that Digital Product bridge these layers.

Additionally, the EA modeler and the operational dependency graph (EP-FOUND-OPS) are disconnected. Conceptual architecture and physical reality exist in separate views with no bridge. An architect drawing a value stream cannot see whether the infrastructure is healthy; an operator viewing the dependency graph cannot see the strategic context.

## Design Summary

Extend the EA modeling layer with:

1. **Digital Product element type** — a cross-layer element in a new `product` domain, linked to the actual `DigitalProduct` record
2. **Conceptual-to-operational bridge** — EA elements linked to inventory entities, with optional health overlay
3. **New viewpoints** — Product Landscape, Product Dependency, and Change Impact views purpose-built for Digital Product visibility
4. **Standards-aware export** — platform-native Digital Product elements map to Application Component for ArchiMate interchange

### Key Principles

- **Extend, don't fork** — the EA meta-model already supports custom element types via `EaElementType`. Digital Product is an addition to the notation, not a replacement of ArchiMate.
- **Link, don't duplicate** — EA elements reference `DigitalProduct` records; they don't copy product data. The EA view is a lens on the product, not a separate data store.
- **Bridge is optional** — not every EA element needs an operational counterpart. Conceptual-only elements (future-state architecture, proposed products) exist without operational links.
- **Standards positioning** — the platform documents where it extends beyond ArchiMate/CSDM, maintains export compatibility, and positions itself as a reference implementation for what the standards are expected to adopt.

---

## Section 1: Digital Product Element Type

### 1.1 New Element Type Definition

Added to the `EaElementType` seed data for the ArchiMate 4 notation, following the existing `ElementTypeDef` format from `seed-ea-archimate4.ts`:

**Element type definition:**
```typescript
{
  slug: "digital_product",
  name: "Digital Product",
  neoLabel: "ArchiMate__DigitalProduct",
  domain: "product",
  description: "A service, physical item, or digital item that provides an agreed outcome, incorporates software, requires active management, and is described by a formal offer. Cross-layer element spanning business context, application capabilities, and technology dependencies.",
  stages: FULL_STAGES,
  statuses: FULL_STATUSES,
}
```

**Relationship rules** (added to the `RULES` array as `[fromSlug, toSlug, relSlug]` tuples):

Initial rules targeting element types that already exist in the Phase EA-1 seed:
```typescript
// Digital Product outgoing relationships
["digital_product", "business_actor", "serves"],
["digital_product", "business_role", "serves"],
["digital_product", "application_component", "composed_of"],
["digital_product", "technology_node", "composed_of"],
["digital_product", "digital_product", "composed_of"],
["digital_product", "business_actor", "assigned_to"],
["digital_product", "business_role", "assigned_to"],
["digital_product", "value_stream", "associated_with"],
["digital_product", "capability", "associated_with"],
["digital_product", "technology_node", "depends_on"],
["digital_product", "digital_product", "depends_on"],

// Digital Product incoming relationships
["technology_service", "digital_product", "serves"],
```

Additional rules to be added when Phase EA-2 seed expansion delivers the remaining element types (`business_service`, `business_collaboration`, `business_process`, `application_function`, `application_service`, `technology_service`):
```typescript
["digital_product", "business_service", "realizes"],
["digital_product", "application_service", "realizes"],
["digital_product", "application_function", "composed_of"],
["business_process", "digital_product", "accesses"],
["application_function", "digital_product", "accesses"],
```

**Note:** The `EaElementType` model does not currently have `icon` or `color` fields. If visual differentiation is needed in the canvas, this requires either a schema migration to add these fields, or a UI-layer mapping table. Decision deferred to implementation.

### 1.2 Cross-Layer Behavior

Unlike standard ArchiMate elements that belong to a single layer, Digital Product participates across layers:

| Layer | Role | ArchiMate Equivalent |
|-------|------|---------------------|
| Business | Serves actors, realizes business services, carries value proposition | Application Component serving Business Actor (indirect) |
| Application | Contains application components and functions as capabilities | Application Component (direct equivalent) |
| Technology | Depends on technology nodes and services as infrastructure | Application Component depending on Technology Node (indirect) |
| Strategy | Associated with value streams and capabilities | Not representable in standard ArchiMate |
| Product (new) | First-class citizen with lifecycle, portfolio position, investment profile | No equivalent |

### 1.3 Link to DigitalProduct Record

When an `EaElement` has `elementTypeId` pointing to the `digital-product` type:
- `digitalProductId` field on `EaElement` (already exists in schema) links to the actual `DigitalProduct` record
- Lifecycle attributes (`lifecycleStage`, `lifecycleStatus`) are synchronized from the product record
- Portfolio and taxonomy attribution are inherited, not duplicated
- EA views can display live product data (version, health summary, backlog count) alongside the conceptual element

### 1.4 Composition Support

Digital Products can compose other Digital Products:
- A platform product may be composed of infrastructure products (Foundation) and delivery products (Manufacturing & Delivery)
- The `composed-of` relationship between `digital-product` elements mirrors portfolio cross-references
- Composition views show the product hierarchy with health rollup from operational data

---

## Section 2: Conceptual-to-Operational Bridge

### 2.1 Element-to-Entity Linking

The bridge between EA (conceptual) and operational (physical) layers:

- `EaElement` already has `infraCiKey` field — this links to `InventoryEntity.entityKey`
- For `digital-product` elements: the `digitalProductId` link provides product-level bridging
- For technology elements: `infraCiKey` provides infrastructure-level bridging
- Both links are optional — elements can exist without operational counterparts (future-state, proposed, conceptual-only)

### 2.2 Health Overlay on EA Views

**Prerequisite:** Requires EP-FOUND-OPS Phase 1 (`HealthProbe` and `HealthSnapshot` models) to be implemented. Health overlay phases (Phases 3-5 in implementation sequence) are blocked on EP-FOUND-OPS schema delivery.

When an EA view contains elements with operational links:
- Element border color can reflect health status from the latest `HealthSnapshot`:
  - Green border: all linked entities healthy
  - Amber border: one or more linked entities in warning
  - Red border: one or more linked entities in critical state
  - No border change: no operational link (conceptual-only element)
- Health overlay is togglable — architects can view with or without operational status
- Tooltip on health-overlaid elements shows: entity name, health status, last probe time

### 2.3 Drill-Through Navigation

From an EA view:
- Click a `digital-product` element with `digitalProductId` → navigate to product detail in `/inventory`
- Click any element with `infraCiKey` → navigate to entity detail in `/portfolio/foundational/ops`
- Click a `digital-product` element → option to "View operational graph" → opens the dependency graph scoped to that product's attributed entities

From the operational graph:
- If an `InventoryEntity` has an associated `EaElement`, show option to "View in architecture" → opens the EA view containing that element

### 2.4 Data Flow

```
DigitalProduct ◄──── EaElement (type: digital-product)
     │                    │
     │ attributed to      │ infraCiKey
     ▼                    ▼
InventoryEntity ◄── InventoryRelationship
     │
     │ probed by
     ▼
HealthProbe → HealthSnapshot
     │
     │ status feeds
     ▼
EA View (health overlay)
```

The bridge is read-only — EA views consume operational data but don't modify it. Changes flow through the RFC process (EP-CHG-MGMT).

---

## Section 3: New Viewpoints

### 3.1 Product Landscape Viewpoint

**Purpose:** All digital products across portfolios — the "what do we have?" view.

| Attribute | Value |
|-----------|-------|
| `scopeType` | `organization` |
| Layout | Grid grouped by portfolio archetype |
| Elements | `digital-product` elements, colored by lifecycle stage |
| Overlays | Health status (from probes), investment (from portfolio budget), backlog activity (open items count) |
| Drill-through | Click product → product detail or operational graph |

**Use case:** Portfolio review meetings — "show me everything we manage, where it is in its lifecycle, and whether it's healthy."

### 3.2 Product Dependency Viewpoint

**Purpose:** Single product's dependencies spanning technology and business layers — the "what does this product need?" view.

| Attribute | Value |
|-----------|-------|
| `scopeType` | `product` (scoped to one `digitalProductId`) |
| Layout | Hierarchical — product at center, business services above, technology below |
| Elements | The product + all related elements (serves, depends-on, composed-of, realizes) |
| Overlays | Health status on technology elements, SLA targets on service offerings |
| Drill-through | Click any element → element detail or operational graph |

**Use case:** Product owner review — "what does my product depend on, and is any of it at risk?"

### 3.3 Change Impact Viewpoint

**Prerequisite:** Requires EP-CHG-MGMT (`ChangeRequest` model and `impactReport` field) to be implemented. Phase 7 in implementation sequence is blocked on EP-CHG-MGMT schema delivery.

**Purpose:** Overlay planned RFCs onto the product landscape to visualize change risk — the "what's changing and what could break?" view.

| Attribute | Value |
|-----------|-------|
| `scopeType` | `change` (scoped to one or more RFC IDs) |
| Layout | Same as Product Landscape, with change overlay |
| Elements | All products + highlighted entities targeted by the RFC's change items |
| Overlays | Change items shown as annotations on affected elements, risk level coloring, blast radius highlighting |
| Data source | `ChangeRequest.impactReport` from EP-CHG-MGMT |

**Use case:** Change Advisory Board review — "show me what this change touches, what the blast radius is, and which products are at risk."

### 3.4 Implementation

All three viewpoints use the existing `EaView` model:
- New `scopeType` values: `organization`, `product`, `change`
- `scopeRef` carries the context: null for organization-wide, `digitalProductId` for product, `rfcId` for change
- Viewpoint definitions seeded via the existing EA notation seed process
- Canvas rendering reuses the EA Modeler's existing graph rendering engine

---

## Section 4: Standards Positioning

### 4.1 ArchiMate Interchange

For export/interchange with standard ArchiMate tools:
- `digital-product` elements map to `ApplicationComponent` with a `stereotype` annotation: `<<DigitalProduct>>`
- Cross-layer relationships are preserved as standard ArchiMate relationships where equivalents exist
- Platform-specific attributes (portfolio, lifecycle, health) are exported as property extensions
- Import: `ApplicationComponent` elements with `<<DigitalProduct>>` stereotype are recognized and typed as `digital-product`

### 4.2 CSDM Alignment

- The platform's `digital-product` element anticipates what CSDM 6 is expected to formalize
- Mapping table maintained in the ontology spec (EP-ONTOLOGY, Section 7.1)
- When CSDM 6 is published, the element type definition and mapping table will be updated to align

### 4.3 ITIL v5 Alignment

- The platform operationalizes ITIL v5's Digital Product concept with a data model and lifecycle that ITIL describes but doesn't formalize
- Change Impact viewpoint directly supports ITIL's Change Enablement practice
- Product Landscape viewpoint supports ITIL's Service Configuration Management practice

### 4.4 Documentation

Each viewpoint includes a standards note documenting:
- Which standard concept it implements or extends
- Where it deviates from the standard and why
- How it maps back for interchange/compliance

---

## Implementation Sequence

| Phase | Scope | Deliverables |
|-------|-------|-------------|
| 1 | Element type | `digital-product` element type seeded into EA meta-model. Relationship rules defined. `product` domain added. |
| 2 | Element-product linking | EA element creation for `digital-product` type auto-links to `DigitalProduct` record. Lifecycle sync. |
| 3 | Conceptual-operational bridge | Health overlay on EA views. `infraCiKey` → `InventoryEntity.entityKey` → health status resolution. Toggle control. **Blocked on EP-FOUND-OPS Phase 1.** |
| 4 | Drill-through navigation | EA view → product detail / operational graph. Operational graph → EA view (reverse). |
| 5 | Product Landscape viewpoint | Viewpoint definition, scoped rendering, portfolio grouping, lifecycle coloring, health overlay. |
| 6 | Product Dependency viewpoint | Single-product scope, hierarchical layout, dependency traversal, SLA overlay. |
| 7 | Change Impact viewpoint | RFC-scoped overlay, blast radius highlighting, CAB review workflow support. **Blocked on EP-CHG-MGMT Phase 1.** |
| 8 | Standards export | ArchiMate interchange mapping, stereotype annotation, property extensions, import recognition. |
