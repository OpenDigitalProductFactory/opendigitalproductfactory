# EA Reference Model Assessment Foundation Design

**Date:** 2026-03-13  
**Status:** Draft  
**Scope:** Establish a generic Enterprise Architecture reference-model assessment framework in `/ea`, with portfolio-first scoring and IT4IT as the first seeded model.

---

## Overview

The platform needs a durable way to compare its current operating model against formal reference models, not just for IT4IT but later for industry-specific models such as BIAN, TM Forum, COBIT, and ACORD. This is a standard Enterprise Architecture activity: compare current-state capabilities, structures, and responsibilities against an external reference model, assess coverage, and make the gaps actionable.

The first version should be a **generic EA reference-model framework** with these characteristics:

1. **Generic, not IT4IT-only** - the data model must support multiple reference models, multiple versions, and multiple models active against the same assessment scope over time.
2. **Portfolio-first** - the first supported assessment scope is the four digital product portfolios, because that is how the platform is currently being shaped and how maturity needs to be judged for MVP.
3. **Normative vs advisory separated** - formal criteria used for scoring stay distinct from descriptive/advisory guidance used by AI coworkers for recommendations.
4. **Authoritative vs proposed separated** - approved reference-model content is the scoring source of truth; AI coworkers can ingest artifacts and propose model structures, mappings, and guidance, but those proposals require human review before promotion.
5. **EA-native home** - the working surface lives in `/ea`, because reference-model comparison, value-stream alignment, and cross-model contrast are core EA functions.

IT4IT is the first seeded model because the platform already uses its portfolio and value-stream framing. The Digital Product Portfolio Management guide and related white-paper material are not the normative scoring basis, but they are a valuable advisory source for AI coworkers.

---

## Problem Statement

Today the platform has portfolio structure, taxonomy, backlog, EA modeling, identity/governance, and infrastructure discovery foundations, but it lacks a formal way to answer:

- which reference-model criteria are in MVP
- which required criteria are already implemented
- which criteria are partially implemented, planned, or absent
- which value streams and value-stream stages are represented in the EA model
- which portfolio is responsible for each criterion or gap
- what advice an AI coworker should give based on descriptive guidance, not just missing controls

Without this framework, the platform can continue to accumulate useful features but still lack a legible answer to whether it is becoming a viable digital product factory aligned to recognized enterprise patterns.

---

## Goals

- Create a reusable EA reference-model framework that can support multiple models over time.
- Make the four portfolios the first-class assessment scopes in version 1.
- Seed IT4IT functional criteria and value-stream activities as the first authoritative reference model.
- Support scoring semantics suitable for MVP gap tracking.
- Distinguish normative criteria from advisory guidance topics.
- Allow AI coworkers to ingest mixed-format source artifacts and stage proposed reference-model content for review.
- Provide a path to link reference-model content to portfolios, taxonomy, EA elements, backlog items, humans, and AI agents.
- Prepare the EA workspace for richer value-stream and value-stream-stage visualization in a follow-on phase.

---

## Non-Goals

- Full UI-driven document upload and import workflow in this phase.
- Full generic scope support for teams, taxonomy nodes, digital products, or enterprises in this phase.
- Automatic promotion of AI-proposed model content into the authoritative registry.
- Full BIAN, TM Forum, COBIT, or ACORD implementations in this phase.
- Final portal coworker orchestration for employee or customer portals.
- Final value-stream-stage diagram UX in this phase.

This phase establishes the framework and the first seeded reference model. Richer visual and workflow features are separate follow-on phases.

---

## Key Design Decisions

### 1. Reference models are a generic EA concern

Reference-model comparison is not a one-off portfolio feature. It belongs in the EA workspace because architects routinely compare the enterprise against formal models, standards, and industry patterns.

### 2. The first scope type is the four portfolios

The framework should support more scope types later, but version 1 uses only:

- `foundational`
- `manufacture_and_delivery`
- `provided_internally`
- `provided_externally`

This keeps scoring aligned to the platform's current operating model and MVP decisions.

### 3. Normative scoring must stay separate from advisory guidance

For IT4IT, the workbook criteria and value-stream activity criteria are the basis for scoring. The Digital Product Portfolio Management guide and similar papers are descriptive and should inform recommendations, heuristics, and AI coworker advice, not pass/fail scoring.

### 4. AI coworkers should assist import, not replace governance

The platform should support AI-assisted acquisition and normalization of reference-model content from `XLSX`, `PDF`, `DOCX`, and `TXT`, but proposals must be reviewable and explicitly promoted into the authoritative model set.

### 5. Multi-model overlap is a first-class future requirement

The framework must not assume one enterprise maps to one reference model. The same enterprise or scope may later be assessed against IT4IT, COBIT, BIAN, TM Forum, ACORD, or others simultaneously.

---

## Assessment Semantics

### Priority semantics

For IT4IT and similar imported models, criteria language should be normalized into a machine-readable priority class:

- `required` - derived from `must` and `shall`
- `recommended` - derived from `should`
- `optional` - derived from `may`

This avoids underweighting `shall` criteria and gives the platform a consistent scoring basis across models.

### Coverage status semantics

Each scoped assessment should support:

- `implemented`
- `partial`
- `planned`
- `not_started`
- `out_of_mvp`

These statuses are not the reference-model priority itself. They describe DPF's current posture against a criterion.

### Evidence posture

Coverage should allow evidence linkage, not just free-text claims. Evidence may later point to:

- EA elements or views
- backlog items or epics
- digital products
- taxonomy nodes
- portfolio records
- workflow/actions in the application

Version 1 can start with structured notes plus optional links, but the schema should anticipate stronger evidence later.

---

## Conceptual Data Model

### Reference-model registry

```prisma
model EaReferenceModel {
  id              String   @id @default(cuid())
  slug            String   @unique
  name            String
  version         String
  authorityType   String   // "standard" | "industry_model" | "internal_framework" | "white_paper"
  status          String   @default("draft") // "draft" | "active" | "retired"
  description     String?
  primaryIndustry String?
  sourceSummary   String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

This is the top-level registry entry for models such as IT4IT, BIAN, or COBIT.

### Model structure

```prisma
model EaReferenceModelElement {
  id               String            @id @default(cuid())
  modelId          String
  model            EaReferenceModel  @relation(fields: [modelId], references: [id])
  parentId         String?
  parent           EaReferenceModelElement?  @relation("ReferenceModelTree", fields: [parentId], references: [id])
  children         EaReferenceModelElement[] @relation("ReferenceModelTree")
  kind             String            // "domain" | "capability_group" | "function" | "component" | "criterion" | "value_stream" | "value_stream_stage" | "guidance_topic"
  slug             String
  name             String
  code             String?
  description      String?
  normativeClass   String?           // "required" | "recommended" | "optional" | null for non-criteria nodes
  sourceReference  String?           // e.g. section reference
  properties       Json              @default("{}")
  @@unique([modelId, slug])
}
```

This tree supports both functional structures and value-stream structures without requiring a separate per-model schema.

### Source artifacts

```prisma
model EaReferenceModelArtifact {
  id          String   @id @default(cuid())
  modelId      String
  model        EaReferenceModel @relation(fields: [modelId], references: [id])
  kind         String   // "xlsx" | "pdf" | "docx" | "txt"
  path         String
  checksum     String?
  authority    String   // "authoritative" | "supporting" | "advisory"
  importedAt   DateTime?
  createdAt    DateTime @default(now())
}
```

Artifacts are tracked so model imports are traceable.

### Assessment scopes

```prisma
model EaAssessmentScope {
  id          String   @id @default(cuid())
  scopeType   String   // v1: "portfolio"
  scopeRef    String   // v1: Portfolio.slug
  name        String
  description String?
  status      String   @default("active")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([scopeType, scopeRef])
}
```

Version 1 seeds four portfolio scopes only.

### Assessment records

```prisma
model EaReferenceAssessment {
  id               String   @id @default(cuid())
  scopeId          String
  scope            EaAssessmentScope @relation(fields: [scopeId], references: [id])
  modelId          String
  model            EaReferenceModel  @relation(fields: [modelId], references: [id])
  modelElementId   String
  modelElement     EaReferenceModelElement @relation(fields: [modelElementId], references: [id])
  coverageStatus   String   // implemented | partial | planned | not_started | out_of_mvp
  mvpIncluded      Boolean  @default(true)
  evidenceSummary  String?
  rationale        String?
  confidence       String?  // "low" | "medium" | "high"
  assessedById     String?
  updatedAt        DateTime @updatedAt
  createdAt        DateTime @default(now())
  @@unique([scopeId, modelElementId])
}
```

This is the actual scoring layer.

### AI proposal lane

```prisma
model EaReferenceProposal {
  id            String   @id @default(cuid())
  modelId        String?
  model          EaReferenceModel? @relation(fields: [modelId], references: [id])
  proposalType   String   // "model_element" | "mapping" | "guidance" | "assessment_update"
  sourceArtifactId String?
  payload        Json
  status         String   @default("proposed") // proposed | reviewed | approved | rejected | promoted
  proposedByType String   // "user" | "agent"
  proposedByRef  String?
  reviewNotes    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

This allows AI coworkers to work in the EA space without directly changing authoritative scoring content.

---

## IT4IT As The First Seeded Model

IT4IT should be loaded as the first active reference model using the local source set in `docs/Reference`:

- `IT4IT_Functional_Criteria_Taxonomy.xlsx`
- `IT4IT v3.0.1.pdf`
- `IT4IT v3.0.1.docx`

The first import should create:

- model entry: `it4it_v3_0_1`
- functional criteria hierarchy from the workbook
- value stream and value stream stage hierarchy from the workbook
- participation metadata from the workbook matrix
- normalized priority classes

The first advisory layer for IT4IT should be enriched by the supporting portfolio guide material:

- `digital_product_portfolio_mgmt.txt`
- `Shift to Digital Product.pdf`
- `shift_to_digital_product.txt`

Examples of advisory topics that should be extracted and stored as `guidance_topic` elements or proposal content:

- Conway's Law
- empowered teams
- accountability rooted in value streams
- provider/consumer commitment framing
- portfolio operating-model responsibilities
- product-vs-project mindset shifts

These topics are for AI coworker recommendations, not direct scoring rows.

---

## Mapping Model

Version 1 does not need a full many-to-many mapping engine for every target object, but it should be designed to support mappings from reference-model elements to:

- portfolio scopes
- taxonomy nodes
- EA elements and EA views
- backlog items and epics
- digital products
- human roles
- AI agents

In version 1, the required mappings are:

- model element to portfolio assessment scope
- value stream / stage to EA representation readiness
- guidance topic to portfolio review context

Later phases can widen mappings to the other object types.

---

## EA Product Surface

The first working surface belongs in `/ea`, not `/platform` or `/portfolio`.

Version 1 should eventually expose:

- a reference-model registry view
- a model detail view
- a portfolio assessment view per model
- score rollups by portfolio and by value stream/stage
- a review queue for proposed AI-imported content

This phase does not need the full UX, but the spec assumes the home of the feature is the EA workspace and not a separate governance module.

---

## Relationship To Existing Platform Concepts

### Portfolio

Portfolios are the first scope type because they represent the operating structure used to shape the platform's MVP:

- `Manufacture and Delivery`
- `Foundational`
- `Provided Internally`
- `Provided Externally`

### Taxonomy

Taxonomy remains the provider-side ownership map. It is not the first assessment scope in this phase, but the framework should later allow a reference-model element or assessment finding to point into taxonomy areas.

### Humans and AI agents

The framework should eventually support mapping responsibility and recommendations to:

- human roles accountable for an area
- AI coworkers capable of advising or acting in that area

That is especially important for future advisory use cases where the AI coworker should explain a gap, cite relevant guidance topics, and recommend the next action in the context of the responsible portfolio area.

### Backlog and epics

Assessment gaps should later be promotable into backlog items and epics. This phase only needs to preserve enough structure so that future automation can create backlog work from uncovered criteria or missing value-stream coverage.

---

## AI Coworker Role

The AI coworker should eventually support three roles in this feature:

1. **Reference-model analyst**
   - reads source artifacts
   - extracts candidate structure, criteria, and guidance topics
   - creates proposals for review

2. **Portfolio advisor**
   - explains what a criterion means
   - highlights likely gaps and overlaps
   - uses advisory topics such as Conway's Law to recommend improvements

3. **Assessment assistant**
   - helps update coverage status
   - suggests evidence links
   - proposes backlog work or architectural follow-ups

The coworker must not silently rewrite authoritative reference-model content or scoring results.

---

## MVP Boundary

### In scope for this foundation

- generic reference-model registry
- generic reference-model element hierarchy
- portfolio-first assessment scope
- assessment status semantics
- artifact tracking
- proposal lane for AI-imported content
- IT4IT as first seeded model
- advisory-topic handling for supporting white-paper guidance

### Out of scope for this foundation

- complete import workflow UI
- complete model comparison UI
- final value-stream diagram UX
- auto-generated backlog items from gaps
- multi-scope assessments beyond portfolios
- industry-model packs beyond IT4IT

---

## Follow-On Phases

### Phase 2: IT4IT assessment execution

- implement IT4IT import
- seed portfolio scopes
- score current platform posture
- expose initial assessment read views in `/ea`

### Phase 3: EA value-stream visualization

- add first-class IT4IT value stream and stage modeling patterns to EA
- connect value streams/stages to portfolios, backlog, and accountability context

### Phase 4: AI-guided reference-model ingestion

- support agent analysis of mixed-format artifacts
- create review queue UX for proposals

### Phase 5: Multi-model industry expansion

- BIAN
- TM Forum
- COBIT
- ACORD

This is where the generic framework begins to pay off.

---

## Risks And Mitigations

### Risk: the framework becomes IT4IT-shaped despite generic goals

Mitigation:
- keep model registry and element hierarchy generic
- treat IT4IT as seed data, not hardcoded logic

### Risk: advisory guidance becomes confused with normative scoring

Mitigation:
- separate `criterion` elements from `guidance_topic` elements
- separate assessment scoring from coworker recommendation logic

### Risk: AI-proposed imports pollute authoritative content

Mitigation:
- maintain proposal lane with explicit promotion
- require review workflow before authoritative write

### Risk: portfolio-only scope ossifies the model

Mitigation:
- encode `scopeType` generically now
- limit only the seeded instances, not the schema

---

## Recommendation

Proceed with a **generic reference-model framework with portfolio-first scope**, seed **IT4IT** as the first authoritative model, and keep **DPPM white-paper material** in the advisory layer for AI coworker guidance.

This is the smallest design that is still worth keeping long term. It supports the current need to assess MVP readiness across the four portfolios while opening a credible path to multi-model industry reference comparisons later.
