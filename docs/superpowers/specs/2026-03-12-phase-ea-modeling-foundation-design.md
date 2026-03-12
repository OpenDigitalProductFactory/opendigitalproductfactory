# Phase EA-1 — EA Modeling Foundation Design

**Date:** 2026-03-12
**Status:** Draft
**Scope:** Establish the data model foundation for Enterprise Architecture modeling — a notation-agnostic, meta-model-driven graph layer that spans from strategic intent to operational reality, with ArchiMate 4 as the first notation.

---

## Overview

The EA route (`/ea`) is repurposed from an agent registry card grid into the platform's Enterprise Architecture modeling surface. The agent registry moves to an administrative configuration area in a future phase, where it belongs alongside HITL orchestration design.

The EA modeling layer is a **hybrid, view-based graph** built on three principles:

1. **Meta-model as data** — notation rules (element types, relationship validity, lifecycle constraints) live in the database. Adding ArchiMate 4 is a seed file. Adding UML or BPMN later is more seed data, no code changes.
2. **Postgres authoritative, Neo4j queryable** — all EA data is written to Postgres via Prisma; a fire-and-forget sync projects it into Neo4j with dual labels for performant graph traversal at CMDB scale (12M+ nodes).
3. **Lifecycle-native** — EA elements carry the same `lifecycleStage` / `lifecycleStatus` vocabulary as `DigitalProduct`. Multiple EAs can co-model the same entity at different lifecycle stages, enabling current-state and future-state architecture to co-exist in the same graph without conflict.

Phase EA-1 delivers the **data model foundation only**: schema, seed data, validation, sync, server actions, and tests. The graph canvas and visual modeling UI are Phase EA-2.

---

## Named Use Cases This Enables

- **Current vs. future state overlay** — views filtered by `lifecycleStage` show what exists today vs. what is being designed.
- **Change collision detection** — two design-stage elements bridging the same `DigitalProduct` flags two change programmes with conflicting assumptions about the same asset.
- **CSDM traceability** — a single graph traversal spans from `BusinessCapability → ApplicationComponent (DigitalProduct) → TechnologyNode (InfraCI)`, preserving the intent-to-operations lineage that CSDM established.
- **Multi-EA collaboration** — all elements within a view's scope are visible to all authorized EAs; `createdById` provides attribution without restricting access.

---

## Data Model

### Meta-model layer (Postgres — notation registry)

The meta-model is the engine's rulebook. Adding a new notation = inserting rows. No code changes required.

```prisma
model EaNotation {
  id           String               @id @default(cuid())
  slug         String               @unique  // "archimate4" | "uml2" | "bpmn2"
  name         String               // "ArchiMate 4"
  version      String               // "4.0"
  elementTypes EaElementType[]
  relTypes     EaRelationshipType[]
  dqRules      EaDqRule[]
  views        EaView[]
}

model EaElementType {
  id                     String               @id @default(cuid())
  notationId             String
  notation               EaNotation           @relation(fields: [notationId], references: [id])
  slug                   String               // "business_capability"
  name                   String               // "Business Capability"
  neoLabel               String               // set explicitly in seed — see neoLabel convention below
  domain                 String               // "business"|"application"|"technology"|"strategy"|"motivation"|"common"
  description            String?
  validLifecycleStages   String[]             // ["plan","design","production"]
  validLifecycleStatuses String[]             // ["draft","active"] — "inactive" excluded for logical entities
  elements               EaElement[]
  dqRules                EaDqRule[]
  fromRules              EaRelationshipRule[] @relation("FromType")
  toRules                EaRelationshipRule[] @relation("ToType")
  @@unique([notationId, slug])
}

model EaRelationshipType {
  id            String               @id @default(cuid())
  notationId    String
  notation      EaNotation           @relation(fields: [notationId], references: [id])
  slug          String               // "realizes"
  name          String               // "Realizes"
  neoType       String               // "REALIZES"
  description   String?
  rules         EaRelationshipRule[]
  relationships EaRelationship[]
  @@unique([notationId, slug])
}

model EaRelationshipRule {
  id                 String             @id @default(cuid())
  fromElementTypeId  String
  fromElementType    EaElementType      @relation("FromType", fields: [fromElementTypeId], references: [id])
  toElementTypeId    String
  toElementType      EaElementType      @relation("ToType", fields: [toElementTypeId], references: [id])
  relationshipTypeId String
  relationshipType   EaRelationshipType @relation(fields: [relationshipTypeId], references: [id])
  // Note: uniqueness is guaranteed per-notation because EaElementType IDs are notation-scoped.
  // Two notations can define element types with the same slug but they will have different IDs.
  @@unique([fromElementTypeId, toElementTypeId, relationshipTypeId])
}

model EaDqRule {
  id              String         @id @default(cuid())
  notationId      String
  notation        EaNotation     @relation(fields: [notationId], references: [id])
  // Nullable: null = applies to all element types in the notation; set = scoped to one element type
  elementTypeId   String?
  elementType     EaElementType? @relation(fields: [elementTypeId], references: [id])
  name            String
  description     String?
  lifecycleStage  String         // rule fires when element advances to this stage
  // "error" blocks the advance; "warn" is advisory — returned alongside canProceed: true
  // Stored as String; callers narrow to "error" | "warn" via the DqViolation type
  severity        String         @default("error")
  rule            Json           // JSON DSL — see DQ Rule DSL section below
}
```

### Instance layer (Postgres — actual EA model data)

```prisma
model EaElement {
  id              String             @id @default(cuid())
  elementTypeId   String
  elementType     EaElementType      @relation(fields: [elementTypeId], references: [id])
  // notationId is NOT stored directly — derive via elementType.notation when needed.
  // This avoids the cross-FK consistency risk of denormalizing notationId here.
  name            String
  description     String?
  properties      Json               @default("{}")
  lifecycleStage  String             @default("plan")   // plan|design|build|production|retirement
  lifecycleStatus String             @default("draft")  // draft|active|inactive — valid subset per elementType
  createdById     String?

  // Bridge fields to the manifestation layer (all optional — element may be a pure EA construct)
  // digitalProduct, portfolio, taxonomyNode have Prisma FK relations.
  // infraCiKey is a plain string (no FK) because InfraCI has no Prisma model yet — it stores the
  // Neo4j ciId value directly. The sync function creates the EA_REPRESENTS edge using this value.
  digitalProductId String?
  digitalProduct   DigitalProduct?   @relation(fields: [digitalProductId], references: [id])
  infraCiKey       String?           // stores InfraCI.ciId (Neo4j-side key); no @relation
  portfolioId      String?
  portfolio        Portfolio?        @relation(fields: [portfolioId], references: [id])
  taxonomyNodeId   String?
  taxonomyNode     TaxonomyNode?     @relation(fields: [taxonomyNodeId], references: [id])

  fromRelationships EaRelationship[] @relation("FromElement")
  toRelationships   EaRelationship[] @relation("ToElement")
  viewElements      EaViewElement[]
  syncedAt          DateTime?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
}

model EaRelationship {
  id                 String             @id @default(cuid())
  fromElementId      String
  fromElement        EaElement          @relation("FromElement", fields: [fromElementId], references: [id])
  toElementId        String
  toElement          EaElement          @relation("ToElement", fields: [toElementId], references: [id])
  relationshipTypeId String
  relationshipType   EaRelationshipType @relation(fields: [relationshipTypeId], references: [id])
  // Denormalized slug for query efficiency — stores EaNotation.slug (NOT EaNotation.id / cuid).
  // Named notationSlug to distinguish from the FK-style notationId fields elsewhere in the schema.
  // Derived by the createEaRelationship action from relationshipType.notation.slug — NOT caller input.
  notationSlug       String
  properties         Json               @default("{}")
  createdById        String?
  syncedAt           DateTime?
  createdAt          DateTime           @default(now())
}

model EaView {
  id          String          @id @default(cuid())
  notationId  String
  notation    EaNotation      @relation(fields: [notationId], references: [id])
  name        String
  description String?
  layoutType  String          // "graph"|"swimlane"|"matrix"|"layered"
  // scopeType controls how the view's element set is bounded:
  //   "portfolio" — scopeRef is a Portfolio.slug; view auto-includes elements linked to that portfolio
  //   "domain"    — scopeRef is a TaxonomyNode.nodeId; view includes elements in that capability subtree
  //   "custom"    — scopeRef is null; elements are managed exclusively via EaViewElement records
  scopeType   String
  scopeRef    String?
  createdById String?
  elements    EaViewElement[]
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
}

model EaViewElement {
  viewId    String
  view      EaView    @relation(fields: [viewId], references: [id])
  elementId String
  element   EaElement @relation(fields: [elementId], references: [id])
  x         Float     @default(0)
  y         Float     @default(0)
  width     Float?
  height    Float?
  // Composite PK prevents an element appearing more than once per view.
  // This is correct for graph and layered layouts (Phase EA-2).
  // Matrix and swimlane views that need repeated element placement are deferred —
  // they will require a migration to add a serial position discriminator.
  @@id([viewId, elementId])
}
```

### neoLabel convention

The `neoLabel` value on `EaElementType` is set **explicitly in the seed file** — it is not mechanically derived from the notation slug. The convention is:

`{NotationShorthand}__{ElementTypeName}` in PascalCase

where `NotationShorthand` is the human-readable abbreviation of the notation name (not the slug). Examples:

| Notation slug | NotationShorthand | Element type name | neoLabel |
|---|---|---|---|
| `archimate4` | `ArchiMate` | Business Capability | `ArchiMate__BusinessCapability` |
| `archimate4` | `ArchiMate` | Application Component | `ArchiMate__ApplicationComponent` |
| `uml2` | `UML` | Class | `UML__Class` |
| `bpmn2` | `BPMN` | Process | `BPMN__Process` |

The seed file is the authoritative source of `neoLabel` values. The rebuild script reads `neoLabel` from the database — there is no code that derives labels from slugs.

### Lifecycle semantics

The lifecycle vocabulary (`lifecycleStage` / `lifecycleStatus`) is universal across all entity types. Valid combinations are **constrained per element type** by `EaElementType.validLifecycleStages` and `validLifecycleStatuses`.

Key distinction:
- **Logical entities** (e.g. `BusinessCapability`): lifecycle = **design intent**, driven by plans and roadmaps. Valid stages: `plan | design | production`. Valid statuses: `draft | active`. Does not include `inactive` or `retirement` in the operational sense — capabilities are superseded, not decommissioned.
- **Manifested instances** (e.g. `TechnologyNode` wrapping an InfraCI): lifecycle = **operational reality**. Full stage/status range applies.

**Stage advance behaviour:** When `advanceEaLifecycle` transitions an element to a new stage, `lifecycleStatus` resets to `"draft"` if `"draft"` is in `EaElementType.validLifecycleStatuses` for the element type; otherwise it takes the first value in `validLifecycleStatuses`. The EA practitioner explicitly moves it to `"active"` once work at the new stage is ready.

Multiple EAs can create elements at different lifecycle stages referencing the same `DigitalProduct`. They co-exist in the graph. Views filter by stage/status to show current state, future state, or both overlaid.

---

## Neo4j Sync Strategy

### Dual-label nodes

Every `EaElement` synced to Neo4j receives two labels:

```cypher
(:EaElement:ArchiMate__BusinessCapability {
  elementId:       "clxxx...",
  notationId:      "archimate4",   // denormalized at sync time from elementType.notation.slug
  elementType:     "business_capability",
  name:            "Order Management",
  lifecycleStage:  "production",
  lifecycleStatus: "active",
  syncedAt:        datetime()
})
```

- `:EaElement` — stable, never changes with meta-model updates. Used for operational queries, rebuild, audit.
- `:ArchiMate__BusinessCapability` — set from `EaElementType.neoLabel`. Enables label-indexed graph traversal at 12M+ node scale (O(1) vs O(log n) for property index).

### Typed relationship edges

```cypher
(from:EaElement)-[:REALIZES {
  relationshipId:   "clyyy...",
  notationId:       "archimate4",
  relationshipType: "realizes",
  syncedAt:         datetime()
}]->(to:EaElement)
```

Relationship type comes from `EaRelationshipType.neoType`.

### Cross-layer bridge edges

When an `EaElement` has a bridge field set, the sync adds an `EA_REPRESENTS` edge to the existing operational node:

- `digitalProductId` → `(:DigitalProduct {productId: $digitalProductId})`
- `infraCiKey` → `(:InfraCI {ciId: $infraCiKey})`
- `portfolioId` → `(:Portfolio {slug: $portfolioSlug})`
- `taxonomyNodeId` → `(:TaxonomyNode {pgId: $taxonomyNodeId})`

```cypher
(ea:EaElement)-[:EA_REPRESENTS]->(dp:DigitalProduct {productId: $digitalProductId})
```

This enables full intent-to-operations traversal in a single Cypher query:

```cypher
MATCH (cap:ArchiMate__BusinessCapability)
  -[:REALIZES]->(app:ArchiMate__ApplicationComponent)
  -[:EA_REPRESENTS]->(dp:DigitalProduct)
  -[:DEPENDS_ON]->(ci:InfraCI)
WHERE cap.lifecycleStage = "production"
RETURN cap, app, dp, ci
```

### Sync functions (`packages/db/src/neo4j-sync.ts` additions)

```ts
syncEaElement(element, elementType)   // upsert dual-label node + EA_REPRESENTS edges for set bridge fields
syncEaRelationship(rel, relType)      // upsert typed relationship
deleteEaElement(elementId)            // remove node + all its EA edges
deleteEaRelationship(relId)           // remove single relationship
```

All fire-and-forget. Postgres is always authoritative.

### Rebuild script

`packages/db/src/neo4j-rebuild-ea.ts` — drops all `:EaElement` nodes and their EA edges, reconstructs from a full Prisma query.

```
pnpm --filter @dpf/db neo4j:rebuild-ea
```

Upgrade procedure: run Prisma migration → run `neo4j:rebuild-ea`. No manual Neo4j schema work.

---

## Constraint Validation

Validation runs in the server action layer before any Prisma write. Three levels:

### Level 1 — Relationship validity

Before `createEaRelationship`: looks up `EaRelationshipRule` for `(fromElementTypeId, toElementTypeId, relationshipTypeId)`. Rejects if no matching rule exists.

```ts
// packages/db/src/ea-validation.ts
export async function validateEaRelationship(
  fromElementId: string,
  toElementId: string,
  relationshipTypeId: string,
): Promise<{ valid: true } | { valid: false; reason: string }>
```

### Level 2 — Lifecycle validity

Before `createEaElement` or `updateEaElement`: checks that `lifecycleStage` and `lifecycleStatus` are in `EaElementType.validLifecycleStages` and `validLifecycleStatuses`.

```ts
export async function validateEaLifecycle(
  elementTypeId: string,
  lifecycleStage: string,
  lifecycleStatus: string,
): Promise<{ valid: true } | { valid: false; reason: string }>
```

### Level 3 — DQ rule check

On-demand, before advancing lifecycle stage. Evaluates all `EaDqRule` entries matching `(notationId, elementTypeId OR elementTypeId IS NULL, lifecycleStage)` for the target stage. Returns structured violations.

The `advanceEaLifecycle` action enforces `error` severity as a hard gate; `warn` severity is returned alongside a `canProceed: true` flag, allowing the EA to acknowledge and proceed.

```ts
export type DqViolation = {
  ruleId: string;
  name: string;
  description: string | null;
  severity: "error" | "warn";  // narrowed from the DB string at call site
};

export async function checkEaDqRules(
  elementId: string,
  targetStage: string,
): Promise<DqViolation[]>
// Queries EaDqRule where (notationId matches element's notation AND lifecycleStage = targetStage)
// AND (elementTypeId IS NULL OR elementTypeId = element.elementTypeId)
```

### DQ Rule DSL (JSON, extensible without schema changes)

```jsonc
// Requires at least one ApplicationComponent realizing this element before entering design
{ "requires": { "relationshipType": "realizes", "toElementType": "application_component", "minCount": 1 } }

// Requires a bridge field to be set before entering build
{ "requires": { "bridge": "digitalProductId" } }

// Warns if another design-stage element bridges the same DigitalProduct (change collision)
{ "warns": { "duplicateBridge": { "lifecycleStage": "design", "maxCount": 1 } } }

// Requires at least one TechnologyNode dependency before entering production
{ "requires": { "relationshipType": "depends_on", "toElementType": "technology_node", "minCount": 1 } }
```

---

## Collaboration Model

All `EaElement` records within a view's scope are **visible to all authorized EA practitioners**. There is no private workspace — `lifecycleStatus: "draft"` signals work-in-progress by convention, not by access control.

`createdById` on elements and relationships tracks attribution ("modeled by") for display in view UI, but carries no access restriction.

**Co-existing models:** Multiple EAs can create elements referencing the same `DigitalProduct` at different lifecycle stages. Both records are valid and co-exist in the graph. Views filter by stage to show either or both. This also enables **change collision detection** — two `design`-stage elements both bridging the same `DigitalProduct` indicates two change programmes with conflicting assumptions about the same asset, surfaced as a DQ warning. This extends naturally to operational change management: the same collision pattern detects conflicting change programmes before they hit delivery.

**Views as the collaboration surface:** An `EaView` is named, persistent, and shared. Any authorized EA can open the same view and see the same elements and layout. Views are the primary unit of collaboration.

Deferred: real-time presence, optimistic locking, change notifications.

---

## ArchiMate 4 Seed Data (Phase EA-1 scope)

The seed file populates the meta-model for ArchiMate 4. Representative entries — full catalog in `packages/db/src/seed-ea-archimate4.ts`:

**Domains and element types (42 total per ArchiMate 4 spec):**

| Domain | Element type slugs (sample) |
|---|---|
| `strategy` | `capability`, `value_stream`, `course_of_action` |
| `business` | `business_actor`, `business_role`, `business_process`, `business_function`, `business_capability` |
| `application` | `application_component`, `application_service`, `application_function`, `data_object` |
| `technology` | `technology_node`, `technology_service`, `technology_function`, `artifact` |
| `motivation` | `stakeholder`, `driver`, `goal`, `requirement`, `constraint` |
| `common` | `resource`, `capability`, `process`, `function`, `interaction`, `event`, `service`, `object` |

**Relationship types (sample):**

| Slug | Neo4j type | Meaning |
|---|---|---|
| `realizes` | `REALIZES` | Lower layer element realizes higher layer concept |
| `depends_on` | `DEPENDS_ON` | Runtime dependency |
| `assigned_to` | `ASSIGNED_TO` | Actor/role assigned to behaviour |
| `composed_of` | `COMPOSED_OF` | Structural composition |
| `associated_with` | `ASSOCIATED_WITH` | Generic association |
| `influences` | `INFLUENCES` | Motivation to strategy/business |
| `triggers` | `TRIGGERS` | Causal trigger between behaviours |
| `flows_to` | `FLOWS_TO` | Information/material flow |

**Initial DQ stage-gate rules** (each row is one `EaDqRule` record, `elementTypeId` set to the named type):

| Stage gate | Element type | Severity | Rule |
|---|---|---|---|
| `plan → design` | `business_capability` | error | Must have ≥1 `ApplicationComponent` via `REALIZES` |
| `design → build` | `application_component` | error | Must have `digitalProductId` bridge set |
| `design → build` | `application_component` | warn | Collision: another `design`-stage element bridges same `DigitalProduct` |
| `build → production` | `application_component` | error | Must have ≥1 `TechnologyNode` via `DEPENDS_ON` |

---

## Permissions

Write actions (`createEaElement`, `createEaRelationship`, `advanceEaLifecycle`, etc.) require a new `manage_ea_model` capability, following the established pattern where `view_*` capabilities gate read access and `manage_*` capabilities gate write access (cf. `manage_backlog`).

Add to `permissions.ts`:
- `manage_ea_model` — HR-000 (superuser) and HR-300 (EA practitioner roles) initially

Implementation note: `manage_ea_model` is added to the `CapabilityKey` union and the `PERMISSIONS` record only — no `ALL_TILES` entry is needed, paralleling `manage_backlog`.

Read access (viewing the `/ea` page, loading view data) continues to use `view_ea_modeler`.

---

## Server Actions

`apps/web/lib/actions/ea.ts` — all `"use server"`.

| Action | Auth capability | Validation | Neo4j sync |
|---|---|---|---|
| `createEaElement(input)` | `manage_ea_model` | Level 2 (lifecycle) | `syncEaElement` |
| `updateEaElement(id, input)` | `manage_ea_model` | Level 2 if stage/status changing | `syncEaElement` |
| `createEaRelationship(input)` | `manage_ea_model` | Level 1 (relationship rule); action derives `notationSlug` from looked-up `relationshipType.notation.slug` — not from caller input | `syncEaRelationship` |
| `deleteEaElement(id)` | `manage_ea_model` | None | `deleteEaElement` |
| `deleteEaRelationship(id)` | `manage_ea_model` | None | `deleteEaRelationship` |
| `advanceEaLifecycle(id, targetStage)` | `manage_ea_model` | Level 2 + Level 3 (DQ) | `syncEaElement` on success |
| `createEaView(input)` | `manage_ea_model` | None | — |
| `updateEaView(id, input)` | `manage_ea_model` | None | — |

All actions return `{ error: string }` on validation/auth failure. `advanceEaLifecycle` returns `{ violations: DqViolation[], advanced: boolean, canProceed: boolean }`.

---

## `/ea` Page Update (Phase EA-1)

The agent card grid is **removed**. The agent registry relocates to an administrative configuration route in a future phase, alongside HITL orchestration design — the tooling that keeps humans appropriately in the loop as agents execute work.

The updated `/ea` page shows:

```
[heading] Enterprise Architecture
[subheading] N views

[if views exist]
[list of EaView cards: name, notation name, layoutType, scopeType, createdAt]

[if no views]
[empty state] No views yet. Views will appear here once the modeling canvas is available.
```

The modeling canvas (Phase EA-2) is where views are created and populated. Phase EA-1 surfaces the views list as a foundation — it will be empty for most installs but the route is structurally correct.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `packages/db/prisma/schema.prisma` | Add 9 new models |
| `packages/db/prisma/migrations/...` | New migration |
| `packages/db/src/seed-ea-archimate4.ts` | ArchiMate 4 notation seed data |
| `packages/db/src/seed.ts` | Call `seedEaArchimate4()` |
| `packages/db/src/ea-validation.ts` | `validateEaRelationship`, `validateEaLifecycle`, `checkEaDqRules`, `evaluateDqRule` |
| `packages/db/src/ea-validation.test.ts` | Unit tests for all three validation functions |
| `packages/db/src/neo4j-sync.ts` | Add `syncEaElement`, `syncEaRelationship`, `deleteEaElement`, `deleteEaRelationship` |
| `packages/db/src/neo4j-rebuild-ea.ts` | Rebuild script |
| `apps/web/lib/permissions.ts` | Add `manage_ea_model` capability (HR-000, HR-300) |
| `apps/web/lib/actions/ea.ts` | All server actions |
| `apps/web/lib/actions/ea.test.ts` | Server action unit tests (see Testing section) |
| `apps/web/app/(shell)/ea/page.tsx` | Replace agent grid with views list |

---

## Testing

**`ea-validation.test.ts`** — Vitest unit tests, `environment: "node"`, Prisma mocked. Covers:
- `validateEaRelationship`: valid rule found → `{ valid: true }`; no matching rule → `{ valid: false }`; element not found → `{ valid: false }`
- `validateEaLifecycle`: valid stage/status for type → `{ valid: true }`; invalid stage → `{ valid: false }`; invalid status → `{ valid: false }`
- `checkEaDqRules`: all rules satisfied → empty array; unsatisfied error rule → violation with `severity: "error"`; unsatisfied warn rule → violation with `severity: "warn"`

**`ea.test.ts`** — Vitest unit tests, `environment: "node"`, Prisma and Neo4j sync mocked. Server actions are imported directly (Next.js `"use server"` is a build-time transform; Vitest resolves the module without it). Covers:
- `createEaElement`: valid input creates element; invalid lifecycle returns `{ error }`; unauthenticated returns `{ error }`
- `createEaRelationship`: valid rule passes; invalid rule returns `{ error }`
- `advanceEaLifecycle`: no violations → `{ advanced: true }`; error violation → `{ advanced: false, violations }`; warn violation → `{ advanced: true, canProceed: true, violations }`

No UI tests — Phase EA-1 page is a simple static list.

---

## What This Does Not Include

- Graph canvas / visual modeling UI (Phase EA-2)
- ArchiMate domain view rendering (Phase EA-2)
- Value stream swimlane view (Phase EA-3)
- Change collision dashboard UI (Phase EA-3)
- UML notation seed data (Phase EA-4 — data only, no code change)
- BPMN / BPEL notation (future)
- Real-time presence / optimistic locking (future)
- Scheduled DQ batch reports (future)
- Agent registry relocation to admin route (future)
- `EaViewElement` support for repeated element placement (deferred — matrix/swimlane views will require a migration adding a position discriminator)
