# Digital Product Unified Ontology

**Date:** 2026-03-21
**Status:** Draft
**Epic:** EP-ONTOLOGY
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Track:** Parallel — informs all other epics, evolves from implementation learnings
**Depends on:**
- `docs/Reference/IT4IT v3.0.1.pdf` (value stream model)
- `docs/Reference/CSDM 5.pdf` (entity taxonomy)
- `docs/Reference/Introducing_ITIL_5.pdf` (practice areas, Digital Product adoption)
- `docs/Reference/digital_product_portfolio_mgmt.txt` (Open Group G252, DPPM)
- `docs/Reference/EALab_ArchiMate-4.pdf` (notation layer)

## Problem Statement

Three major IT management standards each describe part of the Digital Product reality, but none unifies the full picture:

1. **IT4IT v3.0.1** defines seven value streams (Evaluate, Explore, Integrate, Deploy, Release, Consume, Operate) that describe *what work happens* to a Digital Product — but treats it as an attribute of the value stream, not a first-class entity that participates across all seven.
2. **CSDM 5** provides an entity taxonomy (Business Service, Business Application, Technical Service, CI) with lifecycle attributes — but does not recognize Digital Product as a distinct entity. It maps awkwardly to Business Application, losing the business context (value proposition, service offer, investment portfolio). CSDM 6 is expected to address this, but the specification is not yet available.
3. **ITIL v5** introduces Digital Product as a concept and organizes practices around it — but does not define a data model or entity relationships. It describes *how things are managed* without formalizing *what the things are* at the data level.
4. **ArchiMate 4** provides notation for modeling architecture across business, application, and technology layers — but has no element type for Digital Product. It must be shoehorned into Application Component, losing cross-layer visibility.

The result: organizations implementing these standards must maintain separate, disconnected models for the same Digital Product — one for portfolio planning (IT4IT), one for CMDB (CSDM), one for service management (ITIL), and one for architecture (ArchiMate). There is no single ontology that spans design-through-operations with Digital Product as the anchor.

Additionally, **AI agent identity** is absent from all four standards. As organizations deploy AI agents as workforce members, operators, and product components, the ontology must accommodate entities that simultaneously *are part of* digital products, *operate on* digital products, and *are managed as* workforce members. No current standard addresses this.

This platform — the Open Digital Product Factory — is an exercise in implementing this unification. The ontology specification formalizes what the platform's data model embodies, creating a reference that can inform standards evolution.

## Design Summary

A formal ontology specification centered on Digital Product as the anchor entity, unifying IT4IT value streams, CSDM entity relationships, ITIL practices, and ArchiMate notation through a single coherent model. The ontology is a living artifact that evolves from implementation learnings on this platform and from real-world deployments in increasingly complex environments.

### Key Principles

- **Digital Product is the anchor entity** — every other entity in the ontology relates to Digital Product either as a component, a dependency, a consumer, an operator, or a governance mechanism.
- **Four-standard unification** — each entity has a value stream position (IT4IT), an entity classification (CSDM), management practices applied to it (ITIL), and an architectural representation (ArchiMate). The ontology maps all four simultaneously.
- **Lifecycle consistency** — the two-attribute lifecycle model (stage + status) from CSDM applies uniformly across all entity types, with valid transitions documented.
- **Portfolio boundaries are ontological** — the four portfolio archetypes (Foundational, Manufacturing & Delivery, For Employees, Products & Services Sold) define first-class partitions in the ontology, not just organizational groupings.
- **AI agent identity is a novel ontological concept** — formalized with three distinct aspects that must not be conflated.
- **Living specification** — version-controlled, promoted through the platform's own change management process, informed by implementation and deployment learnings.

---

## Section 1: Standards Landscape & Gap Analysis

### 1.1 Current Standards Coverage

| Concern | IT4IT v3.0.1 | CSDM 5 | ITIL v5 | ArchiMate 4 |
|---------|-------------|--------|---------|-------------|
| Digital Product as entity | Implicit (backbone object) | Not recognized | Conceptual only | No element type |
| Value stream lifecycle | Full (7 streams) | Not modeled | Referenced | Not modeled |
| Entity taxonomy | Functional components | Full CI/service hierarchy | Practice-oriented | Layer-based elements |
| Lifecycle model | Stage-based | Stage + Status (2-attr) | Practice-based | Not formalized |
| Portfolio partitioning | 4 archetypes defined | Not modeled | Not modeled | Grouping only |
| Dependency mapping | Functional dependencies | CI relationships | Service dependencies | Architecture relationships |
| AI workforce | Not addressed | Not addressed | Not addressed | Not addressed |

### 1.2 Unification Gap

The gap is not that standards conflict — they describe different facets of the same reality. The gap is that no standard provides the **join key** that connects these facets. Digital Product is that join key.

A Digital Product simultaneously:
- Has a **portfolio position** (IT4IT) — which value streams does work flow through?
- Has an **entity classification** (CSDM) — what is it composed of, what does it depend on?
- Has **practices applied** (ITIL) — how are changes, incidents, and service levels managed?
- Has an **architectural representation** (ArchiMate) — how is it communicated to stakeholders?

This platform's data model already embodies this unification implicitly. The ontology makes it explicit.

---

## Section 2: Entity Catalog

### 2.1 Anchor Entity

| Entity | Standard Origin | Platform Model | Description |
|--------|----------------|----------------|-------------|
| **Digital Product** | DPPM / ITIL v5 | `DigitalProduct` | A service, physical item, or digital item that provides an agreed outcome, incorporates software, requires active management, and is described by a formal offer with pricing. The anchor of the ontology. |

### 2.2 Portfolio & Governance Entities

| Entity | Standard Origin | Platform Model | Description |
|--------|----------------|----------------|-------------|
| **Portfolio** | IT4IT / DPPM | `Portfolio` | One of four archetypes partitioning the organization's digital products by purpose and audience. |
| **Taxonomy Node** | DPPM | `TaxonomyNode` | Ownership hierarchy within a portfolio. Maps accountability, not technology. |
| **Backlog Item** | IT4IT (Evaluate/Explore) | `BacklogItem` | Work item in portfolio context (strategic) or product context (delivery). |
| **Epic** | IT4IT (Integrate/Deploy) | `Epic` | Cross-portfolio initiative grouping backlog items toward a common outcome. |

### 2.3 Lifecycle & Change Entities

| Entity | Standard Origin | Platform Model | Description |
|--------|----------------|----------------|-------------|
| **Product Version** | CSDM / ITIL | `ProductVersion` | Point-in-time snapshot of a Digital Product tied to a git tag. |
| **Change Request (RFC)** | ITIL v5 | `ChangeRequest` (new) | Formal request for change to platform or customer-managed systems. Umbrella over change items. |
| **Change Promotion** | ITIL / IT4IT | `ChangePromotion` | Code-specific change item within an RFC. Approval → deployment → rollback audit trail. |
| **Deployment Window** | ITIL v5 | `DeploymentWindow` (new) | Business-aware scheduling constraint for when changes may be executed. |
| **Codebase Manifest** | Platform-native | `CodebaseManifest` | SBOM — software bill of materials for compliance and AI context. |

### 2.4 Infrastructure & Operations Entities

| Entity | Standard Origin | Platform Model | Description |
|--------|----------------|----------------|-------------|
| **Inventory Entity** | CSDM (CI) | `InventoryEntity` | Normalized infrastructure item discovered or declared. Maps to CSDM Configuration Item. |
| **Inventory Relationship** | CSDM | `InventoryRelationship` | Typed dependency between inventory entities. |
| **Discovery Run** | Platform-native | `DiscoveryRun` | Execution record of infrastructure discovery. |
| **Health Probe** | Platform-native | `HealthProbe` (new) | Periodic health check definition for an inventory entity. |
| **Health Snapshot** | Platform-native | `HealthSnapshot` (new) | Point-in-time health reading with metrics. |
| **Service Offering** | ITIL / CSDM | `ServiceOffering` | What a Digital Product offers — SLA targets, support hours, availability. |

### 2.5 Architecture Entities

| Entity | Standard Origin | Platform Model | Description |
|--------|----------------|----------------|-------------|
| **EA Element** | ArchiMate 4 | `EaElement` | Architecture modeling element with lifecycle. Cross-layer when type is `digital-product`. |
| **EA Relationship** | ArchiMate 4 | `EaRelationship` | Typed connection between EA elements. |
| **EA View** | ArchiMate 4 | `EaView` | Viewpoint-specific visualization of a subset of the architecture. |

### 2.6 AI Workforce Entities

| Entity | Standard Origin | Platform Model | Description |
|--------|----------------|----------------|-------------|
| **Agent** | Platform-native | `Agent` | AI workforce member with role, authority boundary, portfolio affiliation, and trust lifecycle. |
| **Agent Endpoint** | Platform-native | Derived from `EndpointTaskPerformance` (conceptual — no dedicated model yet) | Specific AI model capability assigned to an agent for task execution. Composite identity: `endpointId` + `taskType`. |
| **Agent Trust Level** | Platform-native | Aspirational — not yet in schema (see `AgentGovernanceProfile.autonomyLevel` for current approximation) | Learning → Practicing → Innate progression per capability. |

---

## Section 3: Relationship Taxonomy

### 3.1 Core Relationship Types

| Relationship | From → To | Cardinality | Description |
|-------------|-----------|-------------|-------------|
| **belongs-to** | DigitalProduct → Portfolio | M:0..1 | Product is managed within a portfolio archetype (nullable in schema for migration/onboarding; business rule: all products should be assigned) |
| **anchored-at** | DigitalProduct → TaxonomyNode | M:1 | Product ownership mapped to taxonomy position |
| **composed-of** | DigitalProduct → InventoryEntity | 1:M | Product is realized by infrastructure components |
| **depends-on** | InventoryEntity → InventoryEntity | M:M | Infrastructure dependency (typed) |
| **offered-by** | ServiceOffering → DigitalProduct | M:1 | Service level commitment from a product |
| **versioned-as** | ProductVersion → DigitalProduct | M:1 | Point-in-time code snapshot |
| **changed-by** | ChangeRequest → DigitalProduct | M:M | Change affects one or more products (proposed — via `ChangeItem.digitalProductId`) |
| **promoted-through** | ChangePromotion → ProductVersion | M:1 | Code deployment tied to a version |
| **represented-by** | DigitalProduct → EaElement | 1:M | Architecture model of a product |
| **monitored-by** | InventoryEntity → HealthProbe | 1:M | Health check attached to infrastructure |
| **assigned-to** | Agent → Portfolio | M:1 | Agent works within a portfolio |
| **operates-on** | Agent → DigitalProduct | M:M | Agent performs work on products (proposed — requires new `AgentProductAssignment` join table) |
| **component-of** | Agent → DigitalProduct | M:M | Agent is a functional part of a product (proposed — requires new `AgentProductAssignment` join table with `relationshipType` discriminator) |
| **grouped-by** | BacklogItem → Epic | M:1 | Work item belongs to an initiative |
| **belongs-to** | TaxonomyNode → Portfolio | M:1 | Taxonomy node is scoped to a portfolio archetype |
| **scheduled-in** | ChangeRequest → DeploymentWindow | M:1 | Change scheduled within a window |

### 3.2 Cross-Layer Traversal

The ontology enables single-query traversals that no individual standard supports:

```
Portfolio
  └── TaxonomyNode (ownership)
        └── DigitalProduct (anchor)
              ├── ServiceOffering (what it promises)
              ├── ProductVersion (what code it runs)
              │     └── ChangePromotion (how it got there)
              │           └── ChangeRequest (why it changed)
              ├── InventoryEntity (what infrastructure it uses)
              │     ├── HealthProbe → HealthSnapshot (how healthy)
              │     └── InventoryRelationship (what it depends on)
              ├── EaElement (how it's conceptualized)
              │     └── EaRelationship (architecture dependencies)
              ├── Agent [component-of] (AI capabilities within)
              ├── BacklogItem (work planned/in-progress)
              │     └── Epic (strategic initiative)
              └── Agent [operates-on] (AI workforce managing it)
                    └── EndpointTaskPerformance (capability evidence)
```

This traversal answers questions like:
- "What infrastructure supports Product X, how healthy is it, and what changes are planned?"
- "Which agents operate on products in the Foundational portfolio, and what trust level have they earned?"
- "If Container Y fails, which products are affected, what service offerings are breached, and who owns them?"

---

## Section 4: Lifecycle Model

### 4.1 Two-Attribute Lifecycle (CSDM-derived)

Currently implemented on `DigitalProduct` and `EaElement`. Target: uniform application across all lifecycle-bearing entities as the schema matures. Other entities (`ServiceOffering`, `InventoryEntity`, `BacklogItem`, `Epic`, `ChangePromotion`) currently use a single `status` field — aligning them to the two-attribute model is a schema evolution task tracked in the gap register.

| Attribute | Values | Purpose |
|-----------|--------|---------|
| `lifecycleStage` | plan \| design \| build \| production \| retirement | Where in the lifecycle is this entity? |
| `lifecycleStatus` | draft \| active \| inactive | What is its current operational status? |

Valid combinations and transitions are entity-specific but follow common rules:
- `plan/draft` → `design/draft` → `build/active` → `production/active` → `retirement/inactive`
- Entities can be `inactive` at any stage (suspended, not destroyed)
- Retirement is a stage, not deletion — entities remain for audit and analysis

### 4.2 Agent Trust Lifecycle (Platform-native)

Distinct from the product lifecycle — applies to agent capabilities:

| Level | Description | Authority |
|-------|-------------|-----------|
| **Learning** | Endpoint newly assigned, under supervised evaluation | All actions require human approval |
| **Practicing** | Demonstrated competence, expanding autonomy | Routine actions autonomous, novel actions require approval |
| **Innate** | Proven track record, full authority within scope | Autonomous within defined authority boundary |

Trust is per-endpoint, not per-agent — an agent may be Innate at conversation but Learning at code generation.

### 4.3 Change Request Lifecycle (ITIL-derived)

| Status | Description | Transitions To |
|--------|-------------|----------------|
| `draft` | Being composed, not yet submitted | submitted, cancelled |
| `submitted` | Awaiting impact assessment | assessed, rejected |
| `assessed` | Impact analysis complete, awaiting approval | approved, rejected |
| `approved` | Authorized for scheduling | scheduled, cancelled |
| `scheduled` | Assigned to a deployment window | in-progress, cancelled |
| `in-progress` | Change being executed | completed, rolled-back |
| `completed` | Change verified successful | closed |
| `rolled-back` | Change reverted | closed |
| `rejected` | Not authorized | closed |
| `cancelled` | Withdrawn | closed |
| `closed` | Terminal state — audit record preserved | — |

---

## Section 5: Portfolio Boundary Rules

### 5.1 Four Portfolio Archetypes

| Portfolio | IT4IT Origin | Scope | Owner Role | Example Products |
|-----------|-------------|-------|-----------|-----------------|
| **Foundational** | Foundational | Infrastructure, platforms, shared services that underpin all other portfolios | Platform Engineering / Infrastructure | Container runtime, database clusters, networking, security services |
| **Manufacturing & Delivery** | Manufacturing & Delivery | Internal operations for building, testing, deploying, and maintaining digital products | DevOps / Engineering Management | CI/CD pipeline, build studio, sandbox environment, coding agent |
| **For Employees** | Provided Internally | Internal-facing digital products that enable workforce productivity | IT / HR / Operations | Workspace dashboard, compliance suite, employee onboarding |
| **Products & Services Sold** | Provided Externally | Customer-facing product lines — planning, analysis, investment, rationalization, reporting | Product Management / Business | Storefront, customer portal, service catalog, billing |

### 5.2 Cross-Portfolio Rules

- A Digital Product belongs to exactly one portfolio
- An Epic can span multiple portfolios (cross-portfolio initiatives)
- An Inventory Entity can be attributed to multiple products across portfolios (shared infrastructure)
- An Agent can be assigned to one portfolio but operate on products in any portfolio (with authority rules)
- A Change Request can affect entities across multiple portfolios (impact analysis must surface all affected portfolios)

---

## Section 6: AI Agent Identity Model

### 6.1 Three Aspects of Agent Identity

AI agents in the ontology are unique because they simultaneously occupy three roles that traditional entities do not:

**Aspect 1 — Agent as Workforce Entity:**
- Has a role (COO, Analyst, Builder, etc.)
- Has authority boundaries (what it can decide vs. what requires human approval)
- Has portfolio affiliation (which domain it works in)
- Has accountability chain (reports to human accountable employee)
- Managed through HR-like lifecycle (onboarded, assigned, evaluated, retired)

**Aspect 2 — Agent as Operator:**
- Executes changes on digital products (proposes code, runs builds, promotes deployments)
- Runs discovery on infrastructure (discovers inventory entities, maps relationships)
- Approves or escalates within its authority boundary
- Participates in ITIL processes (change execution, incident response)
- Actions create audit trail entries

**Aspect 3 — Agent as Product Component:**
- Some digital products *contain* agents as functional elements (e.g., a customer-facing chatbot is an agent that is part of a storefront product)
- The agent's capabilities are part of the product's service offering
- The agent's trust lifecycle affects the product's operational readiness
- Product version changes may include agent capability changes

### 6.2 Identity Resolution Rules

- An agent's **workforce identity** is managed in the `Agent` model with portfolio affiliation
- An agent's **operator actions** are tracked through backlog items, change promotions, and audit logs
- An agent's **component relationship** to a product is a `component-of` relationship in the ontology
- These three aspects can apply to the same agent simultaneously without conflation
- The ontology must support queries like: "Show me all agents that are components of products in the Foundational portfolio AND operators on products in the Products & Services Sold portfolio"

### 6.3 Open Questions (Evolution Track)

These are explicitly unsolved and will evolve through implementation:
- **Agent autonomy boundaries** — how does the ontology represent what an agent is authorized to do vs. what it can do? Current model uses trust lifecycle per-endpoint, but organizational complexity may require finer-grained authority models.
- **Agent-to-agent relationships** — when agents collaborate (e.g., COO delegates to Builder), how is that relationship typed? Is it a workforce relationship, an operational dependency, or both?
- **Agent accountability in regulated contexts** — when an agent makes a change that requires compliance evidence, how does the ontology trace from the regulatory requirement through the agent's action to the audit record?
- **Multi-tenant agent identity** — if the platform serves multiple organizations, can an agent have different trust levels in different tenants?

---

## Section 7: Standards Mapping Tables

### 7.1 DPF Entity → Standards Equivalents

| DPF Entity | IT4IT Equivalent | CSDM 5 Equivalent | ITIL v5 Equivalent | ArchiMate 4 Equivalent |
|-----------|-----------------|-------------------|--------------------|-----------------------|
| DigitalProduct | Digital Product (backbone) | Business Application (partial) | Digital Product | Application Component (partial) |
| Portfolio | Portfolio (4 types) | — | — | Grouping |
| TaxonomyNode | Product Hierarchy (partial) | — | — | Grouping |
| InventoryEntity | — | Configuration Item | CI | Technology Node / Device |
| ServiceOffering | Service Offer | Business Service (partial) | Service | Business Service |
| Agent | — | — | — | — |
| ChangeRequest | — | — | Change Record | — |
| ChangePromotion | — | — | Change Task | — |
| EaElement | — | — | — | Element (any layer) |
| BacklogItem | Backlog Item (Evaluate/Explore) | — | — | — |
| Epic | Epic (Integrate/Deploy) | — | — | — |

### 7.2 Gap Register

| Gap | Standard | Description | DPF Resolution | Standards Implication |
|-----|----------|-------------|----------------|---------------------|
| G-001 | CSDM 5 | No Digital Product entity type | `DigitalProduct` model with 2-attr lifecycle | Expected in CSDM 6 |
| G-002 | ArchiMate 4 | No Digital Product element type | Custom `digital-product` element in `product` domain | Candidate for ArchiMate extension |
| G-003 | All | No AI agent/workforce entity | `Agent` model with 3-aspect identity | Novel — no standard addresses this |
| G-004 | IT4IT | Value streams don't cross-reference entity taxonomy | Ontology provides join via Digital Product | Unification opportunity |
| G-005 | CSDM 5 | No portfolio partitioning concept | `Portfolio` with 4 archetypes from IT4IT/DPPM | Expected in CSDM 6 |
| G-006 | ITIL v5 | Digital Product recognized but no data model | Ontology provides the data model ITIL implies | Reference implementation |
| G-007 | All | No agent trust/autonomy lifecycle | Learning → Practicing → Innate per capability | Novel |
| G-008 | All | No agent-as-operator audit model | Actions traced through backlog items + change promotions | Novel |
| G-009 | Platform | Two-attribute lifecycle only on DigitalProduct and EaElement | Other entities use single `status` field — alignment needed | Schema evolution task |
| G-010 | Platform | No Agent→DigitalProduct relationship in schema | Proposed `AgentProductAssignment` join table with `relationshipType` (operates-on / component-of) | Schema addition needed |
| G-011 | Platform | No dedicated AgentEndpoint model | Capability identity derived from `EndpointTaskPerformance` composite key | Evaluate whether dedicated model needed |

---

## Section 8: Evolution Model

### 8.1 Versioning

The ontology is a managed artifact within the platform:
- Stored in `docs/superpowers/specs/` with references to the standards documents in `docs/Reference/`
- Version-controlled in git, promoted through the platform's own change management process (EP-CHG-MGMT)
- Each version documents what changed, why, and which implementation or deployment learning triggered the change

### 8.2 Evolution Sources

| Source | Mechanism | Example |
|--------|-----------|---------|
| **Implementation learnings** | Building EP-FOUND-OPS, EP-CHG-MGMT, EP-EA-DP surfaces gaps in the ontology | "Health probes need a severity model not captured in entity catalog" |
| **Deployment learnings** | Customer installations in complex environments surface edge cases | "Multi-cloud deployments need a location/region entity" |
| **Standards evolution** | CSDM 6, future ArchiMate extensions, ITIL v5 practice guides | "CSDM 6 adds Digital Product — align ontology mapping" |
| **AI identity maturity** | Organizational understanding of AI workforce evolves | "Agent authority boundaries need role-based access control integration" |
| **Community feedback** | Other practitioners implementing similar models | "Healthcare sector needs additional compliance entity types" |

### 8.3 Evolution Process

1. **Gap identified** — from any source above
2. **Gap documented** — added to Gap Register (Section 7.2) with rationale
3. **Ontology updated** — entity catalog, relationships, or lifecycle rules modified
4. **Platform updated** — schema and implementation aligned (may spawn new backlog items)
5. **Standards feedback** — findings shared with relevant standards bodies where appropriate

### 8.4 Success Criteria

The ontology succeeds when:
- A single traversal from Portfolio → Digital Product → Infrastructure → Health answers operational questions without joining separate models
- Change impact analysis spans business context (who cares), application context (what breaks), and infrastructure context (what's affected) in one query
- AI agent actions are fully traceable through the same ontology as human actions
- The gap register shrinks as standards adopt concepts this platform pioneered
- New entity types and relationships can be added without restructuring existing ones

---

## Deliverables

1. **This specification** — living design document, updated as the ontology evolves
2. **Mapping tables** (Section 7.1) — DPF entity → IT4IT → CSDM → ITIL → ArchiMate
3. **Gap register** (Section 7.2) — where DPF extends beyond current standards, with rationale
4. **AI agent identity model** (Section 6) — three-aspect formalization
5. **Evolution log** — versioned appendix recording ontology changes with implementation rationale
6. **Machine-readable schema** (future) — JSON-LD or OWL formalization for tooling integration

---

## Appendix A: Evolution Log

| Date | Version | Change | Source | Rationale |
|------|---------|--------|--------|-----------|
| 2026-03-21 | 0.1 | Initial ontology specification | Platform implementation analysis | Formalize what the data model embodies implicitly; establish gap register against current standards |
