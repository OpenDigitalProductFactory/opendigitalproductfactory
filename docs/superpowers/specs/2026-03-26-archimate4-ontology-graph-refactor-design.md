# ArchiMate 4 Completion, Ontology Graph Refactor, and Archi Import/Export

**Status:** Draft
**Date:** 2026-03-26
**Epic:** `EP-ONTOLOGY` / `EP-EA-DP`
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Backlog references:**
- `BI-ONTO-001` — Framework interoperability and import/export mapping for ontology exchange
- `EP-EA-DP` — Digital Product as EA first-class citizen

**Depends on:**
- `docs/superpowers/specs/2026-03-21-ea-digital-product-first-class-design.md`
- `docs/superpowers/specs/2026-03-21-digital-product-unified-ontology-design.md`
- `docs/superpowers/specs/2026-03-26-csdm6-digital-product-ontology-validation-framework-mapping-and-analysis-patterns-design.md`
- `docs/Reference/EALab_ArchiMate-4.pdf`
- `packages/db/prisma/schema.prisma`
- `packages/db/src/seed-ea-archimate4.ts`

---

## Overview

This spec defines three tightly coupled deliverables that must be developed together:

1. **ArchiMate 4 element catalog completion** — the 12 standard types deferred from Phase EA-1, plus 6 new ontology-extension types
2. **Ontology graph refactoring** — schema additions that make the graph support semantically bounded traversal, IT4IT-derived refinement levels, and framework mapping
3. **Archi import/export** — round-trip `.archimate` XML exchange with the open-source Archi modeling tool (MIT licensed)

These three threads are load-bearing on each other. Bounded traversal analysis requires the full element catalog. Import/export requires knowing exactly where platform extensions diverge from standard notation. The element catalog requires the schema additions to carry ontology-role and framework-mapping metadata.

---

## Architectural Position

### ArchiMate as notation skin; ontology graph as truth

The platform's `Ea*` models are **ontology-first**. ArchiMate 4 is one export format among several — not the governing data model. This is the most durable approach given the variety of framework translations required and the need to support analysis patterns that no single notation standard covers.

The `Ea` prefix is retained throughout (EA = Enterprise Architecture ontology). The existing `EaElement`, `EaRelationship`, `EaDqRule`, `EaView`, `EaConformanceIssue`, and related infrastructure are extended in place — not replaced or renamed.

### Refinement level as a process-natural property

Refinement level (conceptual / logical / actual) is **substantially derivable from where in the IT4IT value stream an element currently sits**. The natural process flow is:

```
ArchiMate modeling          →  IT4IT Evaluate / Explore    →  Integrate / Deploy    →  Release / Consume / Operate
(conceptual, future-state)     (conceptual → logical)         (logical → actual)       (actual, evidence-bearing)
```

The Digital Product Backbone is the thread that persists through this journey — the same governed entity progresses from an architectural intent to a running, auditable reality.

| IT4IT Value Stream | Inferred Refinement Level |
|---|---|
| evaluate / explore | conceptual |
| integrate | logical |
| deploy / release | logical → actual |
| consume / operate | actual |

`refinementLevel` is a nullable field — **optional, system-inferred by default**. Viewpoints that require precision (blast-radius analysis, M&A separability) surface unclassified elements as conformance issues via the existing `EaConformanceIssue` infrastructure. General modeling and Archi imports proceed without classification friction.

### AI-assisted modeling as the primary UX

The modeling canvas is explicitly deferred. The platform UX is interactive AI-agent-assisted: agents build the ontology graph in the background while users describe their architecture in natural language. The IT4IT value stream guides what questions agents ask at each stage. The six MCP tools defined in Section 6 are the agent interface to the graph.

---

## Section 1: Schema Changes

### 1.1 Fields added to `EaElement`

Three nullable fields. No existing data affected.

```prisma
model EaElement {
  // ... all existing fields unchanged ...

  refinementLevel  String?
  // conceptual | logical | actual
  // null = not yet classified
  // System infers from itValueStream when present; authors may override

  itValueStream    String?
  // evaluate | explore | integrate | deploy | release | consume | operate
  // The IT4IT value stream stage this element currently contributes to

  ontologyRole     String?
  // governed_thing | actor | control | event_evidence
  // | information_object | resource | offer
  // The element's role in the CSDM 6 ontology
}
```

### 1.2 Fields added to `EaElementType`

Three new fields making each element type self-describing for export and framework mapping.

```prisma
model EaElementType {
  // ... all existing fields unchanged ...

  isExtension         Boolean  @default(false)
  // true = platform extension beyond ArchiMate 4 standard
  // Applies to: digital_product, ai_coworker, information_object,
  //             control, event_evidence, service_offering

  archimateExportSlug String?
  // For isExtension=true types: which standard ArchiMate element type
  // to use when exporting to .archimate XML
  // e.g. digital_product → "application-component"
  //      service_offering → "product"

  ontologyCategory    String?
  // structure | behavior | motivation | information | governance
  // Groups element types for analysis pattern filtering
}
```

### 1.3 New model: `EaTraversalPattern`

Stores named, bounded analysis patterns as database records — not hardcoded in application queries.

```prisma
model EaTraversalPattern {
  id          String     @id @default(cuid())
  notationId  String
  slug        String
  name        String
  description String?
  patternType String
  // blast_radius | ma_separation | governance_audit
  // | ai_oversight | architecture_traceability | cost_rollup
  // | service_customer_impact

  steps              Json
  // Ordered array of step definitions:
  // [{
  //   "elementTypeSlugs": ["artifact", "technology_node"],
  //   "refinementLevel": "actual",          // required level at this step (null = any)
  //   "relationshipTypeSlugs": ["depends_on", "composed_of"],
  //   "direction": "outbound"               // outbound | inbound | either
  // }, ...]

  forbiddenShortcuts Json     @default("[]")
  // Array of shortcut descriptions this pattern must not take
  // e.g. "do not traverse composed_of edges across refinement levels"

  status     String    @default("active")
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  notation   EaNotation @relation(fields: [notationId], references: [id])

  @@unique([notationId, slug])
  @@index([notationId, patternType])
}
```

The `EaNotation` model must also add the back-relation field:

```prisma
model EaNotation {
  // ... existing fields unchanged ...
  traversalPatterns  EaTraversalPattern[]   // ADD THIS
}
```

### 1.4 New model: `EaFrameworkMapping`

The framework inventory from the validation spec, made queryable. One row per element-type-to-framework correspondence.

```prisma
model EaFrameworkMapping {
  id                   String        @id @default(cuid())
  elementTypeId        String
  frameworkSlug        String
  // archimate4 | csdm5 | csdm6 | it4it_v3 | itil5
  // | togaf | cobit | dora | apqc | tbm | tm_forum | bian

  nativeConceptName    String
  // Name of the corresponding concept in the native framework

  mappingType          String
  // exact | partial | approximate | no_equivalent

  semanticDisparity    String?
  // What meaning is lost or distorted in the mapping

  influenceOpportunity String?
  // Where this framework should evolve for better alignment

  exchangeOpportunity  Boolean  @default(false)
  // true = practical import/export exists or could exist

  notes                String?
  createdAt            DateTime @default(now())

  elementType  EaElementType @relation(fields: [elementTypeId], references: [id])

  @@unique([elementTypeId, frameworkSlug])
  @@index([frameworkSlug])
  @@index([elementTypeId])
}
```

The `EaElementType` model must also add the back-relation field:

```prisma
model EaElementType {
  // ... existing fields unchanged ...
  frameworkMappings  EaFrameworkMapping[]   // ADD THIS
}
```

### 1.5 Import tracking — no new model required

Archi `.archimate` imports are tracked using the existing `EaReferenceModelArtifact` (kind=`archimate_import`, authority=`archi_tool`). The existing `EaReferenceProposal` model handles staging where needed. No new model required.

### 1.6 Migration summary

| Change | Type | Impact |
|---|---|---|
| Add 3 nullable fields to `EaElement` | ALTER TABLE | None — all nullable |
| Add 3 fields to `EaElementType` | ALTER TABLE | None — nullable or defaulted |
| Create `EaTraversalPattern` | CREATE TABLE | New |
| Create `EaFrameworkMapping` | CREATE TABLE | New |

All existing seed data, views, DQ rules, conformance issues, and snapshots continue to work unchanged.

---

## Section 2: ArchiMate 4 Element Catalog Completion

### 2.1 Standard ArchiMate 4 types — Phase EA-2 (isExtension=false)

Completing the standard catalog deferred from Phase EA-1.

**Business layer — behaviour elements:**

| Slug | Name | ontologyCategory | Lifecycle |
|---|---|---|---|
| `business_process` | Business Process | behavior | FULL |
| `business_function` | Business Function | behavior | LOGICAL |
| `business_interaction` | Business Interaction | behavior | LOGICAL |
| `business_event` | Business Event | behavior | FULL |
| `business_service` | Business Service | behavior | FULL |
| `business_collaboration` | Business Collaboration | structure | LOGICAL |
| `product` | Product | structure | FULL |

Note: `product` is ArchiMate 4's native business-layer product concept. It is distinct from the platform's `digital_product` extension. On export, `digital_product` maps to `archimate:ApplicationComponent` (not `archimate:Product`) because the Digital Product spans layers beyond what the business-layer Product element captures.

**Application layer — behaviour elements:**

| Slug | Name | ontologyCategory | Lifecycle |
|---|---|---|---|
| `application_function` | Application Function | behavior | LOGICAL |
| `application_interaction` | Application Interaction | behavior | LOGICAL |
| `application_event` | Application Event | behavior | FULL |
| `application_interface` | Application Interface | structure | FULL |

**Technology layer:**

| Slug | Name | ontologyCategory | Lifecycle |
|---|---|---|---|
| `technology_function` | Technology Function | behavior | LOGICAL |

### 2.2 Ontology-extension types (isExtension=true)

Six new types beyond the ArchiMate 4 standard. Each has an `archimateExportSlug` for export compatibility and carries platform-specific `dpf:elementType` properties in exported XML for round-trip fidelity.

| Slug | Name | Domain | archimateExportSlug | ontologyCategory | Purpose |
|---|---|---|---|---|---|
| `digital_product` | Digital Product | product | `application-component` | structure | Cross-layer anchor entity bridging to `DigitalProduct` record. Spans business intent through operational delivery. |
| `service_offering` | Service Offering | product | `product` | structure | Customer-facing offer realized by a digital product. Distinct from the product itself. |
| `information_object` | Information Object | information | `business-object` | information | Governed data class with obligation semantics. Carries control requirements and evidence obligations. |
| `control` | Control | governance | `constraint` | governance | Policy, control objective, or implemented workflow gate. May be conceptual (intent) or actual (evidence-bearing). **Note:** `control` as an `EaElementType.slug` refers exclusively to the ontology graph layer. The platform also has a compliance `Control` Prisma model (for `Obligation`, `AuditFinding`, etc.) — these are separate namespaces and must not be confused in server actions. |
| `event_evidence` | Event / Evidence | governance | `business-event` | governance | Audit record, evidence artifact, or operational event. The actual-layer complement to Control. |
| `ai_coworker` | AI Coworker | product | `application-component` | structure | AI agent identity — simultaneously a product, a component within a product, and an actor with governed authority scope. |

### 2.3 Relationship rules for new types

**Digital Product (Phase EA-2 additions to existing EA-DP spec rules):**

```typescript
// Realizations through behaviour elements (requires Phase EA-2 types)
["digital_product", "business_service",      "realizes"],
["digital_product", "application_service",   "realizes"],
["digital_product", "application_function",  "composed_of"],
["business_process", "digital_product",      "accesses"],
["application_function", "digital_product",  "accesses"],

// Governance connections
["digital_product", "information_object",    "accesses"],
["digital_product", "control",               "associated_with"],
```

**Service Offering:**

```typescript
["digital_product",   "service_offering",  "realizes"],
["service_offering",  "business_actor",    "serves"],
["service_offering",  "contract",          "associated_with"],
```

**Information Object / Governance:**

```typescript
["information_object", "control",           "associated_with"],
["information_object", "event_evidence",    "realizes"],
["control",            "event_evidence",    "associated_with"],
["control",            "digital_product",   "influences"],
["control",            "information_object","influences"],
```

**AI Coworker:**

```typescript
["ai_coworker", "digital_product",      "associated_with"],
["ai_coworker", "application_component","realizes"],
["ai_coworker", "business_role",        "assigned_to"],
["ai_coworker", "control",              "associated_with"],
["ai_coworker", "event_evidence",       "associated_with"],
["business_actor", "ai_coworker",       "associated_with"],
```

**Event/Evidence terminal rules** (required to complete the `governance_audit` traversal pattern — without these rules the pattern has no valid path to a responsible actor):

```typescript
["event_evidence", "business_actor",    "associated_with"],
["event_evidence", "ai_coworker",       "associated_with"],
```

### 2.4 DQ stage-gate rules for ontology-extension types

| Element Type | Stage Gate | Rule | Severity |
|---|---|---|---|
| `digital_product` | production | Must realize at least one `service_offering` or `business_service` | error |
| `service_offering` | production | Must be realized by at least one `digital_product` | error |
| `information_object` | production | Must have at least one `associated_with` → `control` | warn |
| `ai_coworker` | production | Must be `assigned_to` a `business_role` AND `associated_with` at least one `control` | error |
| `control` | production | Must have at least one `associated_with` → `event_evidence` | warn |

---

## Section 3: Framework Mapping Inventory

Full mapping data seeded as `EaFrameworkMapping` records. Documents where each framework falls short (semantic disparity), where it could evolve (influence opportunity), and where practical exchange exists (exchange opportunity).

### 3.1 `digital_product`

| Framework | Native Concept | Mapping | Semantic Disparity | Influence Opportunity | Exchange |
|---|---|---|---|---|---|
| ArchiMate 4 | Application Component | partial | Loses business context, value proposition, portfolio position | Add Product specialisation spanning business + application layers | yes (.archimate export) |
| CSDM 5 | Business Application | partial | Loses lifecycle richness, portfolio partitioning, offer semantics | CSDM 6: elevate to first-class entity | no |
| CSDM 6 | Digital Product *(proposed)* | exact | — | This platform is the reference implementation | yes |
| IT4IT v3 | Digital Product *(backbone object)* | partial | Treated as attribute of value streams; not a persistent governed entity | Use as stable cross-stream anchor with full identity | yes |
| ITIL v5 | Digital Product *(concept)* | partial | Conceptual only — no data model defined | Push persistent entity with lifecycle and governed data | no |
| TOGAF | Application Building Block | approximate | ADM outputs not product-anchored by default | Reinterpret ADM phases through Digital Product traceability | no |
| COBIT | IT-related Asset | approximate | Governance focus; no product realization path | Map control objectives to product evidence paths | no |
| DORA | ICT Service | approximate | Regulatory obligations explicit; product identity indirect | Tie resilience evidence to Digital Product as the unit | no |
| APQC | Product / Service in taxonomy | approximate | Process taxonomy can overtake product identity | Use as scaffolding beneath product semantics, not anchor | no |
| TBM / ATUM | Service (finance roll-up) | approximate | Cost paths strong; lifecycle and identity secondary | Connect cost allocation to product realization directly | no |
| TM Forum / ODA | Product (industry-specific) | partial | Sector-shaped labels; versioned catalog semantics | Preserve layered distinctions; adopt Digital Product as cross-domain anchor | yes |
| BIAN | Business Capability area | approximate | Domain taxonomy does not convey lifecycle semantics | Import sector taxonomy; retain ontology refinement rules | no |

### 3.2 `service_offering`

| Framework | Native Concept | Mapping | Semantic Disparity | Influence Opportunity | Exchange |
|---|---|---|---|---|---|
| ArchiMate 4 | Product (business layer) | partial | Business-layer only; no realization path to Digital Product | Strengthen Product → Application realization semantics | yes |
| CSDM 5 | Service Offering / Business Service | partial | Offer and product conflated; no formal realization link | Separate offer from product; add realization FK | no |
| IT4IT v3 | Service Model / Offer | partial | Offer semantics exist in Release stream; not anchored to product identity | Tie offer lifecycle to Digital Product Backbone | yes |
| ITIL v5 | Service Offering | exact | Well-defined; lacks realization link to Digital Product | Add formal product → offer realization in v5 data model | no |
| TOGAF | Service | approximate | Architectural abstractions, not managed offerings | Frame service design output as an offer realized by a product | no |
| TM Forum / ODA | Product Offering | partial | Industry-specific layering valuable; catalog versioning differs | Preserve TM Forum layering as an overlay on platform offers | yes |
| BIAN | Service Domain | approximate | Domain-level granularity; no offer lifecycle | Import domain taxonomy as offer classification | no |

### 3.3 `information_object`

| Framework | Native Concept | Mapping | Semantic Disparity | Influence Opportunity | Exchange |
|---|---|---|---|---|---|
| ArchiMate 4 | Business Object | partial | No governance obligations or evidence requirements | Add obligation-bearing semantics to Business Object | yes |
| CSDM 5 | Data Classification | partial | Classification exists; governed obligation path weak | Add evidence and control linkage to data classes | no |
| IT4IT v3 | Information Object | partial | Present in value streams; no persistent governed-data semantics | Make information objects obligation-bearing across streams | yes |
| ITIL v5 | Information | approximate | Referenced in practices; no formal governed-data model | Push governed data class with control and evidence links | no |
| COBIT | Information | partial | Governance-rich; product realization path missing | Map information governance to product-centric evidence paths | yes |
| DORA | Data | partial | Regulatory obligations explicit; product anchor indirect | Use information object as unit tying data to product resilience | no |
| TOGAF | Data Entity | partial | Data modeling present; obligation and evidence semantics absent | Extend data entities with governance obligation layer | no |

### 3.4 `control`

| Framework | Native Concept | Mapping | Semantic Disparity | Influence Opportunity | Exchange |
|---|---|---|---|---|---|
| ArchiMate 4 | Constraint | approximate | Constraint is a restriction, not a control with evidence requirements | Add Control as a distinct motivation-layer concept | yes |
| CSDM 5 | *(not modeled)* | no_equivalent | Completely absent — controls implicit in workflows | Introduce Control as a CSDM 6 first-class entity | no |
| IT4IT v3 | Control | partial | Present but not linked to product-centric evidence paths | Anchor controls to Digital Product lifecycle gates | yes |
| ITIL v5 | Control | partial | Referenced in governance practices; no formal data model | Push control entity with evidence obligation semantics | no |
| COBIT | Control Objective | partial | Intent is exact; operational evidence path underspecified | Map control objectives to product evidence and audit paths | yes |
| DORA | Control Measure | partial | Regulatory control explicit; product identity link indirect | Use Digital Product as the unit control measures apply to | no |
| TOGAF | Constraint / Principle | approximate | No evidence requirement semantics | Connect architecture principles to implemented controls with evidence | no |

### 3.5 `event_evidence`

| Framework | Native Concept | Mapping | Semantic Disparity | Influence Opportunity | Exchange |
|---|---|---|---|---|---|
| ArchiMate 4 | Business Event | approximate | Events are triggers, not evidence artifacts | Add Evidence as a distinct implementation-layer concept | yes |
| CSDM 5 | Audit Record | approximate | Audit records exist; not linked to product identity or controls | Connect audit records to Digital Product and Control | no |
| IT4IT v3 | Event | partial | Events in Operate stream; no formal evidence semantics | Promote event to evidence artifact with control linkage | yes |
| ITIL v5 | Event / Record | partial | Well-understood operationally; no governed evidence data model | Push evidence model with timeliness and completeness obligations | no |
| COBIT | Evidence | partial | Evidence concept exists for audit; product path weak | Connect evidence to Digital Product realization and control | yes |
| DORA | Evidence Obligation | partial | Explicit timeliness requirements; product unit indirect | Use Digital Product as evidence-bearing unit for DORA reporting | no |
| TOGAF | *(not modeled)* | no_equivalent | No evidence or audit concept in architecture artifacts | Introduce evidence as output of ADM phases | no |

### 3.6 `ai_coworker`

| Framework | Native Concept | Mapping | Semantic Disparity | Influence Opportunity | Exchange |
|---|---|---|---|---|---|
| ArchiMate 4 | Application Component | approximate | Loses actor identity, oversight model, RBAC constraints, product/actor duality | Define AI Agent specialisation spanning application + motivation layers | yes |
| CSDM 5 | *(not modeled)* | no_equivalent | Completely absent | Introduce AI Coworker as a CSDM 6 first-class entity | no |
| IT4IT v3 | *(not modeled)* | no_equivalent | AI agents not addressed in value stream model | Add AI Coworker as a value-stream participant with governed identity | no |
| ITIL v5 | *(not modeled)* | no_equivalent | Service account / automation only | Push AI agent identity into ITIL v5 practice areas | no |
| COBIT | *(not modeled)* | no_equivalent | No AI actor model | Extend control objectives to cover AI coworker authorization | no |
| DORA | *(not modeled)* | no_equivalent | Resilience framework does not address autonomous AI agents | Include AI coworker scope in resilience evidence obligations | no |
| All others | *(not modeled)* | no_equivalent | Universal gap across all surveyed frameworks | Platform is the reference implementation for all frameworks | no |

`ai_coworker` is the platform's strongest differentiator in the framework landscape. Every major standard has a gap here.

### 3.7 Coverage summary

| Element Type | Exact | Partial | Approximate | None |
|---|---|---|---|---|
| `digital_product` | CSDM 6 | IT4IT v3, ITIL v5, CSDM 5, TM Forum | ArchiMate 4, TOGAF, COBIT, DORA, APQC, TBM, BIAN | — |
| `service_offering` | ITIL v5 | CSDM 5, IT4IT v3, TM Forum | TOGAF, BIAN | — |
| `information_object` | — | ArchiMate 4, IT4IT v3, COBIT, DORA, TOGAF, CSDM 5 | ITIL v5 | — |
| `control` | — | IT4IT v3, ITIL v5, COBIT, DORA | ArchiMate 4, TOGAF | CSDM 5 |
| `event_evidence` | — | IT4IT v3, ITIL v5, COBIT, DORA | ArchiMate 4, CSDM 5 | TOGAF |
| `ai_coworker` | — | — | ArchiMate 4 | All others |

---

## Section 4: Bounded Traversal Patterns

Seven `EaTraversalPattern` records seeded for the ArchiMate 4 notation. These patterns make semantically valid traversal machine-executable — not just documented intentions.

The key distinction the validation spec requires: this is not generic graph walking. Each pattern defines which element types, relationship types, refinement levels, and directions are permitted at each step. Forbidden shortcuts are explicit.

### Pattern 1: `blast_radius` — Software Supply-Chain Impact

**Purpose:** Trace a vulnerable package or component through actual dependencies to Digital Products, offers, and affected consumers.

**Canonical path:**
```
artifact / technology_node (actual)
  -[depends_on / composed_of]->
application_component (logical / actual)
  <-[realizes]-
digital_product
  -[realizes]->
service_offering
  -[serves]->
business_actor (consumer population)
```

**Refinement requirement:** Must start from `actual` layer. Stops at `service_offering` — does not traverse into portfolio or motivation layer.

**Forbidden shortcuts:**
- Do not traverse `conceptual` elements as actual deployed dependencies
- Do not assume all paths through a shared platform component imply equal customer impact
- Do not conflate `composed_of` (structural) with `depends_on` (runtime) when estimating blast radius

---

### Pattern 2: `governance_audit` — Information Governance and Audit Evidence

**Purpose:** Trace an information object through its governing controls to evidence and responsible actors.

**Canonical path:**
```
information_object
  -[associated_with]->
control
  -[associated_with]->
event_evidence (actual)
  -[associated_with]->
business_actor / ai_coworker (responsible)
```

**Refinement requirement:** `event_evidence` node must be `actual`. Control may be `logical`.

**Forbidden shortcuts:**
- Any path from `control` to a record is not audit proof unless it passes through `event_evidence` with `actual` refinement level
- Do not traverse `associated_with` generically — must follow the full `control → event_evidence` chain

---

### Pattern 3: `architecture_traceability` — Architecture to Operations

**Purpose:** Trace from a requirement or architecture concern through logical design to actual product realization and evidence.

**Canonical path:**
```
requirement / constraint / principle (conceptual)
  -[influences]->
application_component / application_function (logical)
  -[realizes]->
digital_product (logical → actual)
  -[associated_with]->
event_evidence (actual)
```

**Refinement requirement:** Must cross all three levels — conceptual → logical → actual. Gaps in the chain surface as conformance issues.

**Forbidden shortcuts:**
- Do not jump from a conceptual requirement directly to actual evidence without a logical design element
- `realizes` is not proof of deployment — logical realization is not the same as actual production

---

### Pattern 4: `ai_oversight` — AI Coworker Authority and Oversight

**Purpose:** Trace AI coworker identity through authorization controls to permitted action scope and supervising humans.

**Authorization path:**
```
ai_coworker
  -[associated_with]->
control (RBAC / authorization)
  -[influences]->
digital_product / resource (permitted scope)
  <-[associated_with]-
business_actor (supervising human)
```

**Audit trail path:**
```
ai_coworker
  -[associated_with]->
event_evidence (actual)
  -[associated_with]->
control (evidence against authorization)
```

**Refinement requirement:** Authorization control may be `logical`; evidence must be `actual`.

**Forbidden shortcuts:**
- Do not use broad actor adjacency to infer oversight — supervision requires an explicit `business_actor → ai_coworker` edge
- Do not assume every `ai_coworker → digital_product` association implies authority to modify the product

---

### Pattern 5: `cost_rollup` — Cost and Investment Allocation

**Purpose:** Trace cost sources through capabilities and shared services to Digital Products and portfolios.

**Canonical path:**
```
resource (actual, cost source)
  -[assigned_to / composed_of]->
capability / business_service (shared)
  -[realizes / associated_with]->
digital_product
  -[bridge: digitalProductId]->
Portfolio / business model
```

**Refinement requirement:** Resource starts at `actual`; capability may be `logical`.

**Forbidden shortcuts:**
- Do not assume shared platform cost equals Digital Product cost without an explicit allocation basis
- Do not roll up costs through `composed_of` across portfolio boundaries without allocation rules

---

### Pattern 6: `ma_separation` — M&A and Divestiture Separability

**Purpose:** Determine what moves together versus what can be separated — products, dependencies, information obligations, and customer commitments.

**Canonical path:**
```
digital_product (subject of transaction)
  -[composed_of / depends_on (bidirectional)]->
digital_product / application_component / technology_node (shared dependencies)
  -[accesses]->
information_object (data obligations that travel with the product)
  -[associated_with]->
contract (customer obligations)
  <-[serves (via service_offering)]-
business_actor (customer population)
```

**Refinement requirement:** Shared dependencies must be `actual` to count as real separation blockers. `logical`-only dependencies are architectural concerns, not operational blockers.

**Forbidden shortcuts:**
- Do not assume shared `technology_node` dependencies can be cleanly separated without operational evidence
- Do not conflate customer-facing `service_offering` with enabling `business_service` — both must be traced separately
- Shared `information_object` obligations (data residency, consent) travel with the product unless a control explicitly releases them

---

### Pattern 7: `service_customer_impact` — Service and Customer Impact

**Purpose:** Trace product degradation through offers and SLAs to customer impact, including downstream products that depend on the affected product.

**Direct impact path:**
```
digital_product (degraded / at risk)
  -[realizes]->
service_offering
  -[serves]->
business_actor (impacted consumers)
```

**Indirect / downstream impact path:**
```
digital_product (degraded)
  <-[depends_on]-
digital_product (consuming products)
  -[realizes]->
service_offering
  -[serves]->
business_actor
```

**Refinement requirement:** Consumer impact only valid at `actual`. Starts at any level.

**Forbidden shortcuts:**
- Do not assume all `business_actor` nodes linked to a product are impacted customers — distinguish consumers of the offer from managers of the product
- Do not traverse `associated_with` into motivation layer elements when calculating consumer impact

---

### Traversal pattern summary

| Slug | Analysis Need | Start Type | End Type | Levels Required |
|---|---|---|---|---|
| `blast_radius` | Vulnerability / supply-chain impact | artifact / tech_node | business_actor | actual → actual |
| `governance_audit` | Audit evidence chain | information_object | business_actor | any → actual |
| `architecture_traceability` | Requirement to reality | requirement | event_evidence | conceptual → actual |
| `ai_oversight` | AI authorization scope | ai_coworker | business_actor | any → actual |
| `cost_rollup` | Finance allocation | resource | portfolio | actual → logical |
| `ma_separation` | Divestiture boundaries | digital_product | business_actor | actual → actual |
| `service_customer_impact` | Degradation impact | digital_product | business_actor | any → actual |

---

## Section 5: Archi Import / Export

Round-trip `.archimate` XML exchange. Import/export only — no modeling canvas in this phase.

The Archi tool is open-source (MIT licensed), available at `archimatetool.com` and `github.com/archimatetool/archi`. The `.archimate` format is XML-based.

### 5.1 Import pipeline

```
1. Parse       .archimate XML → in-memory element / relationship / view tree
2. Classify    ArchiMate XML types → platform element type slugs (via mapping table)
3. Stage       Create EaElement + EaRelationship records (lifecycleStatus=draft)
4. Annotate    Set defaults: refinementLevel=conceptual, itValueStream=null, ontologyRole=null
5. Track       Create EaReferenceModelArtifact (kind=archimate_import, authority=archi_tool)
```

**What gets imported:**

| Source | Imported as | Notes |
|---|---|---|
| ArchiMate elements | `EaElement` (lifecycleStatus=draft) | All standard types |
| ArchiMate relationships | `EaRelationship` | See mapping table in 5.3 |
| Diagram element list | `EaViewElement` (elementId only) | Positions deferred — canvas not in scope |
| Folder structure | `EaElement.properties.archimateFolder` | Preserved as metadata |
| Archi element IDs | `EaElement.properties.archimateId` | Preserved for round-trip identity |

**Element type ID resolution:** The importer resolves `EaElementType.id` by looking up `{ notationId: <archimate4 notation id>, slug: <mapped slug> }`. The notation is always scoped to `archimate4` (hardcoded slug). This is deterministic and safe for the single-notation phase.

**Unknown type handling:** Any ArchiMate XML type with no entry in the classification table creates an `EaConformanceIssue` (severity=warn, issueType=`unknown_archimate_type`) against the imported element. The element is created using the `object` element type (common domain, already in seed) as the deterministic fallback — never discarded. Content is never silently dropped.

**Extension type restoration:** If an imported element carries a `dpf:elementType` property (written on a previous export), the platform restores the original classification rather than defaulting to the ArchiMate export slug.

### 5.2 Export pipeline

```
1. Scope      Determine what to export: all elements in a view, a portfolio, or a digital_product scope
2. Map        Platform element type slugs → ArchiMate XML types (via mapping table)
3. Generate   Build .archimate XML document
4. Deliver    Return as file download: <scope-name>-<date>.archimate
```

**Extension type handling on export:**

Extension types use their `archimateExportSlug` to produce valid ArchiMate XML. A `properties` block preserves the platform type for round-trip fidelity:

```xml
<element xsi:type="archimate:ApplicationComponent"
         id="clxyz..." name="Customer Portal">
  <properties>
    <property key="dpf:elementType" value="digital_product"/>
    <property key="dpf:ontologyRole" value="governed_thing"/>
  </properties>
</element>
```

### 5.3 Type mapping tables

**Element types — ArchiMate XML ↔ platform slug:**

| ArchiMate XML Type | Platform Slug | Quality |
|---|---|---|
| `archimate:BusinessActor` | `business_actor` | exact |
| `archimate:BusinessRole` | `business_role` | exact |
| `archimate:BusinessCollaboration` | `business_collaboration` | exact |
| `archimate:BusinessProcess` | `business_process` | exact |
| `archimate:BusinessFunction` | `business_function` | exact |
| `archimate:BusinessInteraction` | `business_interaction` | exact |
| `archimate:BusinessEvent` | `business_event` | exact |
| `archimate:BusinessService` | `business_service` | exact |
| `archimate:BusinessObject` | `business_object` | exact |
| `archimate:Contract` | `contract` | exact |
| `archimate:Product` | `product` | exact |
| `archimate:ApplicationComponent` | `application_component` | exact |
| `archimate:ApplicationFunction` | `application_function` | exact |
| `archimate:ApplicationInteraction` | `application_interaction` | exact |
| `archimate:ApplicationEvent` | `application_event` | exact |
| `archimate:ApplicationService` | `application_service` | exact |
| `archimate:ApplicationInterface` | `application_interface` | exact |
| `archimate:DataObject` | `data_object` | exact |
| `archimate:Node` | `technology_node` | exact |
| `archimate:Device` | `device` | exact |
| `archimate:SystemSoftware` | `system_software` | exact |
| `archimate:TechnologyFunction` | `technology_function` | exact |
| `archimate:TechnologyService` | `technology_service` | exact |
| `archimate:Artifact` | `artifact` | exact |
| `archimate:CommunicationNetwork` | `communication_network` | exact |
| `archimate:Stakeholder` | `stakeholder` | exact |
| `archimate:Driver` | `driver` | exact |
| `archimate:Goal` | `goal` | exact |
| `archimate:Outcome` | `outcome` | exact |
| `archimate:Principle` | `principle` | exact |
| `archimate:Requirement` | `requirement` | exact |
| `archimate:Constraint` | `constraint` | exact |
| `archimate:Capability` | `capability` | exact |
| `archimate:ValueStream` | `value_stream` | exact |
| `archimate:CourseOfAction` | `course_of_action` | exact |
| `archimate:Resource` | `resource` | exact |
| `archimate:WorkPackage` | `work_package` | exact |
| `archimate:Deliverable` | `deliverable` | exact |
| `archimate:Plateau` | `plateau` | exact |
| `archimate:Gap` | `gap` | exact |

**Relationship types — ArchiMate XML ↔ platform slug:**

| ArchiMate XML Type | Platform Slug | Notes |
|---|---|---|
| `archimate:AssociationRelationship` | `associated_with` | exact |
| `archimate:CompositionRelationship` | `composed_of` | exact |
| `archimate:AggregationRelationship` | `composed_of` | approximate — preserved in `properties.archimateRelType` |
| `archimate:RealizationRelationship` | `realizes` | exact |
| `archimate:ServingRelationship` | `serves` | exact |
| `archimate:AccessRelationship` | `accesses` | exact |
| `archimate:AssignmentRelationship` | `assigned_to` | exact |
| `archimate:InfluenceRelationship` | `influences` | exact |
| `archimate:TriggeringRelationship` | `triggers` | exact |
| `archimate:FlowRelationship` | `flows_to` | exact |
| `archimate:SpecializationRelationship` | `associated_with` | approximate — preserved in `properties.archimateRelType` |

### 5.4 Round-trip identity

Every imported element preserves its original Archi ID in `properties.archimateId`. On re-export, this value is used as the XML `id` attribute — ensuring that a model exported from Archi, imported to the platform, modified, and re-exported back to Archi maintains element continuity. Views and relationships that reference those IDs remain intact.

---

## Section 6: AI Agent Tool Interface

Six new MCP tools forming the agent interface to the ontology graph. These enable the IT4IT-guided conversational modeling UX: agents build the graph in the background while users describe their architecture in natural language.

All tools follow the existing MCP tool patterns in `apps/web/lib/mcp-tools.ts`.

### 6.1 Tool grant categories and capability keys

**Platform RBAC (`requiredCapability`)** uses existing `CapabilityKey` values from `apps/web/lib/permissions.ts`. **Agent grant mapping** (`TOOL_TO_GRANTS` in `apps/web/lib/agent-grants.ts`) uses two new grant category strings.

New grant categories to add to `agent-grants.ts`: `ea_graph_write`, `ea_graph_read`.

| Tool name | `requiredCapability` | `TOOL_TO_GRANTS` entry |
|---|---|---|
| `create_ea_element` | `"manage_ea_model"` | `["ea_graph_write"]` |
| `create_ea_relationship` | `"manage_ea_model"` | `["ea_graph_write"]` |
| `classify_ea_element` | `"manage_ea_model"` | `["ea_graph_write"]` |
| `import_archimate` | `"manage_ea_model"` | `["ea_graph_write"]` |
| `query_ontology_graph` | `"view_ea_modeler"` | `["ea_graph_read"]` |
| `run_traversal_pattern` | `"view_ea_modeler"` | `["ea_graph_read"]` |
| `export_archimate` | `"view_ea_modeler"` | `["ea_graph_read"]` |

Agent registry entries that require `ea_graph_write` or `ea_graph_read` grants: the EA Modeler agent and any architecture-domain AI coworkers. Grant additions must be made to those agents' `config_profile.tool_grants` arrays in `packages/db/data/agent_registry.json` as part of this implementation.

### 6.2 `create_ea_element`

Creates a new ontology element. Called as the user describes components of their architecture.

**Input:**
```typescript
{
  name:             string,
  elementTypeSlug:  string,   // slug from EaElementType catalog
  description?:     string,
  refinementLevel?: "conceptual" | "logical" | "actual",  // defaults to conceptual
  itValueStream?:   string,   // evaluate | explore | integrate | deploy | release | consume | operate
  ontologyRole?:    string,   // governed_thing | actor | control | event_evidence | information_object | resource | offer
  digitalProductId?: string,
  portfolioId?:     string,
  properties?:      object,
}
```

**Output:**
```typescript
{ elementId, name, elementTypeName, refinementLevel, itValueStream }
```

### 6.3 `create_ea_relationship`

Connects two elements. Validates the relationship is permitted by `EaRelationshipRule` before creating.

**Input:**
```typescript
{
  fromElementId:        string,
  toElementId:          string,
  relationshipTypeSlug: string,
  properties?:          object,
}
```

**Output:**
```typescript
{
  relationshipId, fromElementName, toElementName, relationshipTypeName,
  validationResult: "allowed" | "warn" | "blocked",
  validationReason?: string,   // present when warn or blocked
}
```

### 6.4 `classify_ea_element`

Advances an element through the IT4IT process. Called after the user confirms what stage their work is in.

**Input:**
```typescript
{
  elementId:        string,
  itValueStream?:   string,
  refinementLevel?: string,  // override system-inferred level if needed
  ontologyRole?:    string,
}
```

**Output:**
```typescript
{ elementId, previousRefinementLevel, newRefinementLevel, itValueStream }
```

### 6.5 `query_ontology_graph`

The agent's primary read tool. Used before creating elements to avoid duplicates, and to orient the agent within an existing model.

**Input:**
```typescript
{
  elementTypeSlugs?:      string[],
  refinementLevel?:       string,
  itValueStream?:         string,
  ontologyRole?:          string,
  digitalProductId?:      string,
  portfolioId?:           string,
  nameContains?:          string,
  includeRelationships?:  boolean,   // default false
  limit?:                 number,    // default 20
}
```

**Output:**
```typescript
{
  elements: [{
    elementId, name, elementTypeName, refinementLevel,
    itValueStream, ontologyRole,
    relationships?: [{ relationshipType, direction, otherElementId, otherElementName }]
  }],
  totalCount: number,
}
```

### 6.6 `run_traversal_pattern`

Executes one of the seven seeded analysis patterns from a set of starting elements. Returns structured path results including gaps and blocked shortcuts.

**Input:**
```typescript
{
  patternSlug:     string,    // blast_radius | governance_audit | architecture_traceability
                               // | ai_oversight | cost_rollup | ma_separation | service_customer_impact
  startElementIds: string[],
  maxDepth?:       number,    // default 6
}
```

**Output:**
```typescript
{
  paths: [{
    steps: [{ elementId, elementName, elementType, refinementLevel,
               relationshipType, direction }],
    complete: boolean,
    terminationReason: string,
  }],
  summary: {
    nodesTraversed:              number,
    relationshipsFollowed:       number,
    refinementGaps:              string[],  // elements missing refinementLevel that blocked a step
    forbiddenShortcutsBlocked:   string[],
    conformanceIssuesRaised:     string[],
  }
}
```

### 6.7 `import_archimate`

Parses a `.archimate` XML file and loads it into the ontology graph as draft elements.

**Input:**
```typescript
{
  fileContent:    string,   // base64-encoded .archimate XML — maximum 1 MB base64 (~750 KB raw)
                             // Larger files must use a pre-uploaded EaReferenceModelArtifact (deferred)
  fileName:       string,
  targetScope?: {
    portfolioId?:      string,
    digitalProductId?: string,
  }
}
```

**Output:**
```typescript
{
  artifactId:              string,   // EaReferenceModelArtifact ID
  elementsCreated:         number,
  relationshipsCreated:    number,
  extensionTypesRestored:  number,   // restored via dpf:elementType property
  conformanceIssues: [{
    elementName, issueType, severity, message
  }],
}
```

### 6.8 `export_archimate`

Exports a scoped set of elements to `.archimate` XML.

**Input:**
```typescript
{
  scopeType:  "view" | "portfolio" | "digital_product",
  // "all" is intentionally excluded — use portfolio or view scope to bound the export.
  scopeRef:   string,   // required: ID of the view, portfolio, or digital product
  fileName?:  string,   // defaults to <scope-name>-<date>.archimate
}
```

**Output:**
```typescript
{
  fileContent:   string,   // base64-encoded .archimate XML
  fileName:      string,
  elementCount:  number,
  relationshipCount: number,
  extensionTypesMapped: [{ platformSlug, archimateExportSlug, count }],
}
```

### 6.9 Conversational modeling loop example

The IT4IT-guided conversational modeling flow these tools enable:

```
User: "We have a customer portal product that depends on an identity service"

Agent:
  1. query_ontology_graph(nameContains="customer portal") → not found
  2. query_ontology_graph(nameContains="identity service") → not found
  3. create_ea_element(name="Customer Portal", elementTypeSlug="digital_product",
                       refinementLevel="conceptual")
  4. create_ea_element(name="Identity Service", elementTypeSlug="application_service",
                       refinementLevel="conceptual")
  5. create_ea_relationship(fromElementId=portal, toElementId=identity,
                            relationshipTypeSlug="depends_on")
  6. Agent: "Is the Customer Portal currently in production or still being planned?"
  7. User: "It's live"
  8. classify_ea_element(elementId=portal, itValueStream="operate",
                         refinementLevel="actual")
```

---

## Implementation Sequencing

The four components should be implemented in this order within a single migration:

1. **Schema migration** — add fields and new models (Section 1)
2. **Seed expansion** — complete element catalog, add framework mappings, seed traversal patterns (Sections 2, 3, 4)
3. **Import/export** — server actions for `.archimate` parse/generate (Section 5)
4. **MCP tools** — six new tools with grant categories (Section 6)

The migration and seed are a single deployment unit — the new element types, DQ rules, and traversal patterns must be live before the tools can reference them.

---

## Non-Goals for This Phase

- Visual modeling canvas (deferred — canvas UX is a separate epic)
- Diagram position and layout import from `.archimate` (requires canvas)
- Physical layer element types (equipment, facility, distribution_network, material)
- Framework exchange beyond ArchiMate 4 (TM Forum, IT4IT tooling — separate backlog items)
- Full OWL / JSON-LD serialization of the ontology
- Multi-notation support beyond ArchiMate 4 (TOGAF ADM elements, etc.)

---

## Open Questions

1. **`EaNotation` relation on `EaTraversalPattern`** — traversal patterns are defined per notation today. If the platform adds a second notation (e.g. TOGAF), patterns may need to span notations. The current design scopes patterns to a notation; cross-notation patterns are deferred.

2. **`EaFrameworkMapping` seed completeness** — the six extension type mappings are fully specified above. Standard ArchiMate 4 type mappings (e.g. `business_actor` → CSDM Business Stakeholder) are valuable but voluminous. A follow-on backlog item (`BI-ONTO-002` — Standard element type framework mapping seed) should cover the full standard catalog. This phase seeds only the extension types.

3. **Aggregation vs Composition on import** — `archimate:AggregationRelationship` is mapped to `composed_of` with the original type preserved in properties. If analysis patterns need to distinguish aggregation from composition, a new `aggregated_by` relationship type will be required. Deferred pending evidence of need.
