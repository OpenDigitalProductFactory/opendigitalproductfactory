# Proposed CSDM 6 Standard: Digital Product Meta-Model and Ontology

**Status:** Draft  
**Date:** 2026-03-21  
**Track:** Standards proposal and reference-implementation design  
**Backlog status:** `EP-ONTOLOGY` is referenced as the working epic name, but no live `Epic` row exists for `EP-ONTOLOGY` in the platform database as of 2026-03-21. This document is therefore a draft standards proposal and backlog candidate, not a live epic record.  
**Primary audience:** Standards bodies and SMEs across CSDM, IT4IT, DPPM, TBM, TOGAF, ArchiMate, ITIL, DevOps, and enterprise architecture communities  
**Secondary audience:** Architects, platform teams, and operators implementing the model in real systems  
**Reference implementation:** Open Digital Product Factory (`DigitalProduct`, `Portfolio`, `BacklogItem`, `Epic`, `InventoryEntity`, `EaElement`, `ProductVersion`, `ServiceOffering`, `Agent`, `ChangePromotion`, and related models)  

## Overview

This document proposes a product-centric evolution of the Common Service Data Model for CSDM 6. Its core claim is that `Digital Product` should become a first-class CSDM entity and the stable governed thing visible across strategy, planning, architecture, build, delivery, operations, consumption, and audit.

The proposal is intentionally dual-audience:

- For standards readers, it defines a normative meta-model and a product-centric vocabulary that can converge CSDM, IT4IT, and the emerging four-portfolio taxonomy.
- For implementers, it explains how that meta-model maps into an ontology suitable for graph traversal, impact analysis, lifecycle visibility, AI agent governance, and model-based systems engineering.

This platform is treated as the reference implementation proving that the proposed model is implementable rather than merely conceptual.

---

## Problem Statement

CSDM 5 significantly improved service-related modeling, lifecycle guidance, and cross-product consistency, but it still does not make `Digital Product` the first-class, end-to-end entity that modern organizations actually manage.

That gap creates practical fragmentation:

- CSDM users see service, application, CI, and portfolio concerns, but not one stable product-centric governed thing spanning all of them.
- IT4IT provides value-stream visibility, but the entity being managed is not modeled consistently enough across all phases for implementation and impact analysis.
- DPPM and the four-portfolio taxonomy define a business-operating language for digital products, but not a broadly adopted operational meta-model.
- TOGAF and ArchiMate provide architecture viewpoints and artifacts, but they are not product-centric by default.
- ITIL v5 and DevOps practices are increasingly product-centric operationally, but they do not by themselves define a durable data and knowledge model.
- AI agents expose an additional gap: they are no longer well represented as simple service accounts, applications, or CIs.

The result is that organizations often maintain disconnected models for:

- portfolio and funding
- architecture and design
- operational services and infrastructure
- compliance and governance
- change and release management
- AI identities, autonomy, and RBAC

This proposal resolves that fragmentation by making `Digital Product` the anchor of a normative meta-model and by defining an ontology mapping that makes the model analyzable in implementation.

---

## Goals

1. Introduce `Digital Product` as a first-class CSDM 6 entity.
2. Define a normative product-centric meta-model usable across conceptual, logical, and actual realization stages.
3. Converge CSDM, IT4IT, DPPM, and the four-portfolio taxonomy into a coherent body of work.
4. Provide a mapping path for TOGAF, ArchiMate, ITIL v5, DevOps, APQC, and TBM communities.
5. Make lifecycle visibility and impact analysis implementable from actual operational data.
6. Treat AI agents as modern governed things with identity, role, lifecycle, accountability, and RBAC implications.
7. Show that the model is implementable through the Open Digital Product Factory reference implementation.

## Non-Goals

- Replacing all existing framework vocabulary with one new vocabulary overnight
- Defining a full formal OWL or JSON-LD serialization in this phase
- Providing a complete product-specific implementation guide for every tooling ecosystem
- Forcing non-digital products into a digital-only model
- Replacing ArchiMate, TOGAF, ITIL, IT4IT, TBM, or APQC as independent bodies of work

This proposal is digital-product centric, not product exclusive. Non-digital and hybrid products may still participate where relevant, but the focal gap being solved is the modeling of digital products and their realizations.

---

## Why CSDM 6 Needs a Product-Centric Evolution

The central design insight is simple: modern enterprises manage software-powered outcomes, not isolated services, apps, or CIs in isolation.

`Digital Product` is the stable governed thing that organizations fund, design, build, operate, support, evolve, secure, audit, and retire. In most enterprises, it is also the point where multiple concerns meet:

- value and outcomes
- architecture
- lifecycle management
- cost and portfolio allocation
- service and support commitments
- infrastructure and dependencies
- information and regulatory obligations
- change, release, and operational evidence
- human and AI accountability

Without a first-class product-centric model, lifecycle visibility breaks, architecture becomes disconnected from downstream use, and graph-based analysis degrades into generic transitive closure instead of semantically valid traversal.

This proposal positions CSDM 6 as the operationally grounded standard that closes that gap.

---

## Research & Benchmarking

### Standards and systems compared

This proposal was informed by the following reference materials and systems:

**Standards and guidance sources**

- `docs/Reference/CSDM 5.pdf`
- `docs/Reference/IT4IT v3.0.1.pdf`
- `docs/Reference/digital_product_portfolio_mgmt.txt`
- `docs/Reference/shift_to_digital_product.txt`
- `docs/Reference/EALab_ArchiMate-4.pdf`
- `docs/Reference/Introducing_ITIL_5.pdf`

**Open source implementations reviewed**

- Backstage Software Catalog, for kind-plus-relation modeling of software systems and ownership
- OpenMetadata, for first-class entity, glossary, lineage, classification, and governance patterns
- iTop, for explicit CMDB class modeling and relationship discipline

**Commercial implementations reviewed**

- ServiceNow CSDM 5, for service-related domain modeling and lifecycle guidance
- BMC Helix CMDB Common Data Model, for CI class and relationship rigor across operational domains
- LeanIX, for enterprise meta-model and relation-driven architecture governance

### What was learned

**From ServiceNow CSDM 5**

- Strong service-related definitions and domain framing are valuable.
- Lifecycle language and table/relationship discipline matter.
- The model still lacks a first-class `Digital Product` anchor spanning all phases and contexts.

**From IT4IT and DPPM**

- Lifecycle visibility depends on a stable backbone object.
- The four-portfolio taxonomy is practical and implementable.
- Product-centric operating language is a better bridge between business and technology than service-only language.

**From Backstage**

- A compact entity and relation model is easier to adopt than a large, exhaustive taxonomy.
- Ownership, dependency, and system context should be explicit.
- Software-catalog patterns alone are too narrow for governance, audit, and portfolio concerns.

**From OpenMetadata**

- Information objects, lineage, and governance cannot remain implicit.
- Entity-plus-classification-plus-relationship patterns support downstream analysis well.
- Data/metadata platforms demonstrate the value of treating semantic meaning separately from storage schema.

**From iTop and BMC Helix**

- CMDBs work best when classes and relationships are explicit and governed.
- Generic connectivity without semantic discipline becomes hard to trust.
- Operational models alone are insufficient for product, portfolio, and architecture concerns.

**From LeanIX**

- Meta-model discipline helps architects work consistently across capability, application, process, and interface concerns.
- Enterprise architecture readers understand the term `meta-model` and respond well to a small, stable set of concepts.
- EA tooling still typically lacks a product-centric central anchor suitable for operational realization and lifecycle evidence.

### Adopted patterns

- A small normative set of entity categories
- Explicit relationship types with defined semantics
- Stage-aware refinement from conceptual to logical to actual
- Product-centric classification through the four-portfolio taxonomy
- First-class information-object and governance modeling
- Relation-aware analysis rather than unrestricted graph traversal

### Rejected patterns

- Treating `Digital Product` as only a synonym for business application
- Treating the ontology as merely a serialization or documentation layer
- Allowing arbitrary graph edges without semantic traversal rules
- Using service accounts as a sufficient model for AI agents
- Letting actual operational detail exist without traceable conceptual and logical parents

### Anti-patterns to avoid

- **Entity ambiguity:** one term used for multiple levels of abstraction
- **Lifecycle discontinuity:** the governed thing changes name between strategy, design, and operations
- **Information blindness:** products and applications modeled without explicit information objects
- **Graph sprawl:** every node connected to everything else with no valid-traversal discipline
- **Control detachment:** controls and obligations modeled separately from the governed things they apply to
- **Agent flattening:** AI agents treated as ordinary apps or service accounts with no identity and authority semantics

The anti-pattern list above is partly drawn from the reviewed systems and partly inferred from how those systems constrain modeling. That inference is deliberate and should be preserved as an explicit standards-design rationale.

---

## Normative Design Backbone

Sections below are intended to define the future-state model first, then map legacy concepts into it. The proposal should not read as a patchwork compromise between older frameworks. It should define a coherent future-state and then provide an orderly transition path for existing SMEs.

### Core normative claims

1. `Digital Product` is a first-class CSDM 6 entity.
2. The standard is digital-product centric and realization-aware.
3. The normative core is a `meta-model`.
4. The ontology is the semantic layer that makes the meta-model analyzable.
5. Conformance depends on traceability from conceptual to logical to actual realization.
6. The four-portfolio taxonomy is canonical in product-first language.
7. AI agents are first-class governed entities in the modern model.

---

## Normative Definitions

### Digital Product

An abstract, first-class entity representing something that uses software to deliver outcomes and requires active lifecycle management. A Digital Product is not defined by one specific implementation form.

### Digital Product Realization

A concrete manifestation of a Digital Product in a given portfolio and lifecycle context. Realization patterns vary, but identity remains traceable to the same abstract Digital Product.

### Portfolio Type

A canonical product-first classification indicating the operating context of the Digital Product:

- `Foundational`
- `Manufacture and Delivery`
- `For Employees`
- `Products & Services Sold`

### Conceptual Model

The intentional, minimal representation of what is being managed: outcomes, actors, product type, portfolio context, and governed concerns.

### Logical Model

The architected structure elaborating the conceptual model: entities, relationships, controls, information objects, services, dependencies, roles, and lifecycle semantics.

### Actual Model

The operational reality refining the logical model: systems, code assets, applications, infrastructure, teams, policies, agents, telemetry, evidence, and observed relationships.

### Meta-Model

The normative structure of allowed entity types, relationship types, and lifecycle semantics.

### Ontology

The semantic layer that gives the meta-model meaning across conceptual, logical, and actual stages and enables reasoning, traceability, traversal, and impact analysis.

### Governed Thing

An ontology-level designation for any entity that carries lifecycle, ownership, accountability, policy, control, obligation, authorization, or audit semantics.

---

## Model Refinement Rule

This proposal adopts a staged realization model rather than requiring fully accurate models upfront.

### Conceptual

Minimal and stable. Enough to identify:

- the Digital Product
- its portfolio context
- key actors
- intended outcomes
- high-level governed concerns

### Logical

Elaborates conceptual intent into:

- capabilities
- information objects
- controls and obligations
- ownership and accountability
- services and offers
- dependencies and lifecycle semantics

### Actual

Refines logical design into operational reality:

- applications
- infrastructure and environments
- agents and identities
- implemented controls
- work records
- telemetry and evidence

### Normative rule

The same governed thing remains identifiable across conceptual, logical, and actual stages. Each stage adds precision without breaking identity. This one-way elaboration path is mandatory for conformance and for trustworthy impact analysis.

---

## Core Meta-Model Categories

The top-level `types of things` should remain small and stable:

- `Digital Product`
- `Portfolio`
- `Actor`
- `Capability`
- `Service / Offer`
- `Work`
- `Information Object`
- `Resource`
- `Control`
- `Event / Evidence`

### Cross-cutting semantics

- `Governed Thing` may apply to Digital Product, Actor, Capability, Service / Offer, Work, Information Object, Resource, or Control.
- `Realization Stage` applies to conceptual, logical, and actual forms of the same governed thing.

### Why `Information Object` is first-class

Information objects are central to downstream regulatory and audit use. For example, understanding which information objects are used by a business application or Digital Product determines what control, privacy, regulatory, and evidence expectations must apply. Treating this as explicit model structure is one of the strongest value drivers for the ontology.

---

## Normative Relationship Classes

Relationship semantics should be organized by purpose.

### 1. Refinement relationships

Used to preserve identity across stages and framework transitions.

- `elaborates` - conceptual to logical
- `refines` - logical to actual
- `realizes` - actual to logical or conceptual intent
- `mapped-from` - legacy framework concept to normative concept

### 2. Structural relationships

Used to describe enduring design structure.

- `classified-in`
- `composed-of`
- `depends-on`
- `uses-information`
- `enables`

### 3. Operational relationships

Used to describe runtime and execution context.

- `serves`
- `operated-by`
- `changes-through`
- `deployed-to`
- `observed-in`

### 4. Governance relationships

Used to describe accountability and constraint.

- `owned-by`
- `governed-by`
- `constrained-by`
- `requires-evidence`
- `authorized-through`

### 5. Evidence relationships

Used to support audit, health, and impact analysis.

- `evidenced-by`
- `attests-to`
- `impacts`
- `triggers`

### Relationship discipline

Traversal in the ontology is not generic graph walking. Valid analysis depends on relationship class, governed-thing semantics, and stage-aware rules. This prevents the model from collapsing into arbitrary connectivity.

---

## Four-Portfolio Taxonomy as Realization Context

The four portfolios are not ad hoc categories. They are the canonical product-first realization contexts of the model. They are grounded in the four-portfolio reference spreadsheet and informed by current APQC and TBM alignment work.

### Canonical portfolio names

- `Foundational`
- `Manufacture and Delivery`
- `For Employees`
- `Products & Services Sold`

These business-language names should remain canonical. Legacy CSDM and adjacent framework concepts should map to them, not replace them.

### Portfolio role in the standard

Each portfolio defines:

- typical Digital Product realization patterns
- expected actor patterns
- common governance concerns
- dominant value and cost perspectives
- mapping anchors into existing framework vocabulary

### Initial CSDM 5 alignment

The current working alignment is:

- `Foundational` -> closest to Technology Management Service concerns
- `For Employees` -> closest to Business Service concerns
- `Manufacture and Delivery` -> closest to Service Instance and product-delivery concerns
- `Products & Services Sold` -> not first-class in CSDM 5 and therefore a major target for CSDM 6 evolution

This mapping should be presented as a bridge, not as a forced equivalence. The proposal's point is to move from service-centric partial matches to a coherent product-centric model.

---

## Lifecycle Visibility and IT4IT Alignment

The proposal addresses a persistent lifecycle-visibility problem: the governed thing often changes name, abstraction, or context as work moves from strategy to design to build to operate.

### Lifecycle anchor

`Digital Product` is the stable governed thing visible across all lifecycle contexts.

### Stage-aware refinement

The modeling path is:

- conceptual
- logical
- actual

### Operational lifecycle

Actual realizations then move through states such as:

- planned
- designed
- built
- deployed
- operated
- changed
- retired

### IT4IT contribution

IT4IT contributes lifecycle visibility across value-stream concerns. This proposal makes that visibility implementable by ensuring the same Digital Product remains traceable across those concerns.

### Key claim

The model resolves lifecycle visibility by combining:

- a stable product anchor
- explicit refinement stages
- explicit operational evidence
- portfolio-aware context

This is stronger than status tracking. It is continuous visibility of the same governed thing through multiple management viewpoints.

---

## Ontology and Analysis Semantics

The ontology exists to make the meta-model useful for knowledge representation and analysis.

### Main function

It constrains traversal semantics so that the graph supports expected answers rather than arbitrary transitive closure.

### Why this matters

When actual operational details are linked back to logical and conceptual structures, the graph can support meaningful analysis such as:

- what products are impacted if a resource changes or fails
- which information objects place a Digital Product under specific obligations
- which actors are authorized to operate or change a product
- which services, consumers, and portfolios are affected by an outage
- what evidence proves current lifecycle, control, or operational state

### Practical analytical value

This is where architecture work becomes visibly useful downstream:

- compliance and audit
- change impact analysis
- incident response
- portfolio governance
- access and authority reasoning
- AI agent oversight

Generic graph models often lose this value because they allow unrestricted connectivity. The ontology restores it by defining semantically valid traversal patterns.

---

## AI Agents, Identity, and RBAC

AI agents require a stronger model than classic service accounts.

### Why they matter

An AI agent may simultaneously be:

- a Digital Product
- a component of another Digital Product
- an Actor performing work and operational actions

That combination makes agent identity, authority, and accountability materially different from traditional non-human identities.

### Three views of an AI agent

#### Agent as Digital Product

The agent itself may be the outcome-delivering product.

#### Agent as Product Component

The agent may be part of another product's realization.

#### Agent as Actor

The agent may operate systems, perform work, trigger controls, produce evidence, and require authorization.

### Normative modeling implications

The proposed standard should support:

- agent identity
- role and assignment
- authority scope
- governed autonomy
- operational action traceability
- evidence of those actions
- relationship to information objects and controls

### Why RBAC alone is insufficient

RBAC remains necessary, but it is not enough on its own. The model must also represent:

- lifecycle maturity
- accountability chain
- product/component context
- operational evidence
- governed autonomy boundaries

This chapter should be treated as one of the main reasons a product-centric CSDM 6 is required.

---

## Legacy-to-Future Mapping

This section is for SMEs with existing mental models. It should show where familiar concepts fit without pretending all concepts are equivalent.

### What the mapping section must do

1. Show the closest fit of legacy concepts in the new model
2. Explain what changes in meaning
3. Explain what gap the new model resolves

### Framework mapping lanes

#### CSDM 5 to proposed CSDM 6

Map service, application, CI, lifecycle, product-model, and portfolio concepts into the Digital Product-centered model.

#### IT4IT and DPPM to proposed CSDM 6

Map the Digital Product backbone, value-stream visibility, and four portfolios into the normative model.

#### TOGAF to proposed CSDM 6

Map requirement-centric ADM artifacts so that requirements are explicitly tied to a Digital Product or to a portfolio-scoped governed thing rather than floating independently.

#### ArchiMate to proposed CSDM 6

Map actor, capability, service, application, information, and technology concerns into the product-centric meta-model and ontology roles.

#### ITIL v5 and DevOps

Map product-centric operating practice concerns into Work, Service / Offer, Event / Evidence, Control, and lifecycle evidence patterns.

#### APQC and TBM

Map process, value, cost, and operating-taxonomy concerns into capability, portfolio, service, governance, and realization contexts.

### Tone of the section

The section should help experts in older frameworks see where they fit in the future model and why the future model is more implementable and analytically useful.

---

## Reference Implementation in Open Digital Product Factory

This platform demonstrates that the proposed standard can be implemented.

### Current implementation signals in the platform schema

The current schema already expresses several important aspects of the proposal:

- `DigitalProduct` with lifecycle and portfolio association
- `BacklogItem` and `Epic` for work and grouped initiative context
- `ProductVersion` and `ChangePromotion` for release/change visibility
- `ServiceOffering` for delivered value commitments
- `InventoryEntity` and `InventoryRelationship` for operational realization
- `EaElement` and `EaRelationship` for architecture representation
- `Agent` for AI workforce modeling

### Reference-implementation role

The platform should be presented as proof that:

- Digital Product can remain the stable governed thing
- portfolio classification can be implemented consistently
- conceptual, logical, and actual concerns can be linked
- information objects, controls, work, and evidence can support downstream analysis
- AI agents can be represented as governed entities with identity and authority implications

The main body should stay at implementation-pattern level. Detailed schema-to-standard mappings can live in appendices or companion material.

---

## Conformance and Adoption

Adoption should be incremental.

### Suggested adoption path

1. Classify Digital Products in the four-portfolio taxonomy
2. Establish conceptual models for key governed things
3. Elaborate logical relationships and governance structures
4. Connect actual operational data as realizations
5. Add evidence and control traceability
6. Add AI-agent identity and authority semantics where relevant

### Conformance principle

Conformance should be traceability-based, not table-count based. The key test is whether an organization can preserve identity and governed semantics from conceptual intent through logical structure to actual operational realization.

---

## Open Issues and Evolution Path

This proposal is intentionally forward-looking.

### Open issues

- exact normative treatment of external sold Digital Products in CSDM 6
- maturity model for governed AI autonomy
- deeper standard mappings for TOGAF and ArchiMate
- formal ontology serialization and exchange mechanisms
- additional sector-specific extensions

### Evolution model

The proposal should evolve through:

- standards work
- implementation learnings
- reference-implementation feedback
- cross-framework collaboration with CSDM, IT4IT, TBM, APQC, TOGAF, ArchiMate, ITIL, and DevOps communities

---

## Recommendation

Proceed with a proposed CSDM 6 standard centered on:

- `Digital Product` as a new first-class entity
- a compact, normative product-centric meta-model
- an ontology mapping for knowledge representation and analysis
- four portfolios as canonical realization contexts
- explicit lifecycle visibility across IT4IT-aligned stages
- first-class modeling of information objects, controls, evidence, and AI agents
- this platform as the reference implementation

This is the smallest proposal that still resolves the main gaps in CSDM 5 while creating a credible bridge to adjacent standards and modern operating realities.

---

## Appendix A: Initial Mapping Hypotheses to Validate

These are early working hypotheses and should be validated with standards SMEs during publication drafting:

| Future-state concept | Initial mapping hypothesis | Note |
|---|---|---|
| `Foundational` | Closest to Technology Management Service concerns | Bridge, not equivalence |
| `For Employees` | Closest to Business Service concerns | Bridge, not equivalence |
| `Manufacture and Delivery` | Closest to Service Instance and delivery-system concerns | Needs precise wording |
| `Products & Services Sold` | New explicit CSDM 6 concern | Core proposal gap |
| `Digital Product` | Stable governed thing across lifecycle | New first-class entity |
| `Governed Thing` | Cross-cutting semantic role | Needed for policy, evidence, RBAC, audit |

## Appendix B: Reference Sources

- [CSDM 5](/h:/OpenDigitalProductFactory/docs/Reference/CSDM%205.pdf)
- [IT4IT v3.0.1](/h:/OpenDigitalProductFactory/docs/Reference/IT4IT%20v3.0.1.pdf)
- [Digital Product Portfolio Management](/h:/OpenDigitalProductFactory/docs/Reference/digital_product_portfolio_mgmt.txt)
- [The Shift to Digital Product](/h:/OpenDigitalProductFactory/docs/Reference/shift_to_digital_product.txt)
- [ArchiMate 4 preview material](/h:/OpenDigitalProductFactory/docs/Reference/EALab_ArchiMate-4.pdf)
- [Introducing ITIL 5](/h:/OpenDigitalProductFactory/docs/Reference/Introducing_ITIL_5.pdf)
