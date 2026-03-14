# Discovery Taxonomy Attribution Design

**Date:** 2026-03-14  
**Status:** Draft  
**Scope:** Extend bootstrap discovery so discovered infrastructure, runtime, product-function evidence, and software/package evidence are matched to the appropriate taxonomy descriptor with confidence, attribution method, normalization evidence, and exception handling for low-confidence cases.

---

## Overview

The platform already has:

- a loaded taxonomy with 481 nodes
- a bootstrap discovery foundation
- normalized inventory entities and relationships
- quality issue surfacing

What is missing is taxonomy-aware attribution. Today, bootstrap discovery can place an entity into the `Foundational` portfolio, but it does not assign that entity to the correct taxonomy descriptor. That leaves the graph incomplete for later impact analysis, product responsibility mapping, and quality reporting.

This slice adds a taxonomy attribution stage to discovery so each discovered entity attempts to find its best taxonomy fit. Strong matches are persisted directly. Weak or conflicting matches are preserved as proposed candidates and surfaced through a review queue rather than being silently dropped.

This same slice also needs to begin software identification. Host-installed software, OS packages, and container package evidence should be captured in a way that supports later:

- license analysis
- vulnerability analysis
- technical-debt reporting
- product/version normalization

The long-term direction is an in-platform agent that performs this attribution continuously. The MVP slice should establish the same pipeline shape now with deterministic and heuristic steps first, and a clean seam for later AI-assisted classification. For software normalization, heuristics are allowed to discover the mapping, but deterministic rules should become the durable operational path over time.

---

## Goals

1. Attempt taxonomy attribution for every discovered entity.
2. Persist both the selected taxonomy node and the evidence behind the match.
3. Support deterministic, heuristic, and future AI-assisted attribution methods.
4. Create exception issues only when confidence is low or candidates conflict.
5. Keep discovered operational entities visible in the graph even when taxonomy attribution is uncertain.
6. Make the result useful for later impact analysis, provider-side reporting, and digital product reconstruction.
7. Capture raw software/package evidence and normalized software identity without turning every package immediately into a first-class graph node.
8. Reduce future cognitive load by promoting approved heuristic results into deterministic rules.

---

## Non-Goals

- Full remote network discovery
- Freeform AI invention of new taxonomy nodes
- Automatic creation of new taxonomy descriptors
- Full digital-product reconstruction in this slice
- Automatic restoration of epics or backlog from discovery output
- Broad graph projection of every software package as an operational node in this slice

---

## Current-State Problem

Current discovery normalization in `packages/db/src/discovery-normalize.ts` can:

- derive stable discovered keys
- create normalized inventory entities
- assign foundational infrastructure to the `foundational` portfolio

Current discovery persistence in `packages/db/src/discovery-sync.ts` can:

- persist inventory entities and relationships
- mark stale entities
- create quality issues for attribution gaps

But the pipeline does not yet:

- assign `taxonomyNodeId`
- record attribution method
- record attribution confidence
- store attribution evidence or candidate taxonomy matches
- distinguish deterministic vs heuristic vs AI-proposed taxonomy fits
- capture raw software/package evidence
- normalize software product identity and version from noisy installation/package signals

As a result, discovered entities are visible operationally but not semantically grounded in the taxonomy.

---

## Chosen Approach

Three approaches were considered:

1. Deterministic-only taxonomy rules
2. AI-first taxonomy classification
3. Hybrid attribution pipeline

This design chooses **option 3**.

Reasoning:

- infrastructure and runtime entities often have obvious rule-based mappings
- product-function evidence needs broader semantic comparison to the taxonomy
- low-confidence items should become managed quality issues, not silent failures
- the same staged pipeline can later be executed by an in-platform AI coworker
- software normalization needs stable raw evidence plus a progressively improving deterministic catalog

---

## Architecture

Add a new attribution stage between normalization and persistence:

1. Collect runtime facts
2. Normalize discovered facts into stable records
3. Attribute each normalized entity to taxonomy candidates
4. Normalize software/package evidence into stable software identities
5. Persist:
   - chosen taxonomy node when confidence is sufficient
   - attribution method
   - attribution confidence
   - evidence and candidate set
   - software evidence and normalized software identity
6. Raise open quality issues for low-confidence or conflicting cases
7. Project the discovered entity and taxonomy relationship into graph/inventory views

This keeps the discovered entity as the operational source record while also attaching the provider-side semantic classification needed for analysis.

Software identification should run in the same pipeline family:

1. collect raw software/package evidence from host and container contexts
2. normalize noisy software names and versions into a stable software identity
3. attach the resulting software evidence to the discovered host/container/runtime entity
4. create review issues when normalization confidence is low

The key design rule is:

**heuristics are allowed to discover the mapping, but deterministic rules should become the durable operational path over time.**

---

## Attribution Pipeline

### 1. Deterministic Pass

Use direct evidence where the mapping is obvious:

- collector type
- process name
- container name
- image name
- known port
- runtime technology
- known platform component identifiers

Examples:

- local host, Docker runtime, Kubernetes runtime, Postgres, Neo4j
- known DPF platform services if their process or container naming is explicit

Deterministic matches should produce:

- `attributionMethod = "rule"`
- high confidence
- explicit evidence entries listing the matched signals

### 2. Heuristic Pass

For entities not resolved deterministically:

- create a normalized textual descriptor from the discovered evidence
- compare that descriptor to taxonomy node labels and relevant descriptor text
- produce ranked candidate matches
- persist the top candidates with confidence scores

Heuristics should be bounded and explainable. They should not fabricate taxonomy structure.

Heuristic matches should produce:

- `attributionMethod = "heuristic"`
- ranked candidates
- evidence such as token overlap, signature matches, and matched descriptors

### 3. AI-Assisted Proposal Pass

Only for unresolved or ambiguous entities:

- send bounded candidate sets to a classifier
- require:
  - selected taxonomy node
  - confidence
  - rationale
  - optional alternate candidates

The classifier must not invent new taxonomy nodes. It only chooses among provided candidates.

AI-assisted matches should produce:

- `attributionMethod = "ai_proposed"`
- persisted rationale/evidence
- a review issue if confidence is below threshold

### 4. Rule Synthesis And Operationalization

The platform should not remain permanently dependent on expensive heuristic or AI analysis for the same signatures.

Expected lifecycle:

1. A new discovered signature has no deterministic match.
2. Heuristic or AI-assisted analysis proposes the best taxonomy and software identity fit.
3. A human or policy-approved process accepts the result.
4. The accepted result becomes a new deterministic attribution/normalization rule.
5. Future runs use the deterministic rule first.

This progressively reduces cognitive load and operational cost over time.

### 5. Persistence Decision

- above threshold: persist selected `taxonomyNodeId`
- below threshold: persist candidates and create a quality issue
- conflicting strong candidates: create a review issue
- no candidate: mark `unmapped`

The entity itself is still persisted regardless of attribution certainty.

For software normalization:

- if normalized software identity confidence is high, persist directly
- if confidence is low, persist raw evidence plus candidates and create a review issue
- if no normalized match exists, preserve the raw discovered software evidence as unresolved

---

## Software Identification Design

Software inventory is required for later licensing, vulnerability, and technical-debt analysis, but the first slice cannot model every installed package as a first-class graph node without creating unmanageable scale.

The first slice should therefore use two layers:

### 1. Software Evidence Layer

Persist the raw software/package facts as discovered:

- discovered host or container context
- package manager or source type
- raw package name
- raw display name
- raw vendor/publisher text
- raw version string
- architecture/edition when present
- install path, image, or repository metadata
- evidence source and discovery timestamp

This layer must remain lossless and auditable.

### 2. Normalized Software Identity Layer

Resolve raw software evidence to a stable normalized identity:

- normalized vendor
- normalized product name
- normalized version
- normalized edition or package variant
- confidence
- alias/fingerprint basis

One normalized software identity may map to many raw signatures.

This structure supports:

- later SBOM and vulnerability analysis
- license normalization
- version lifecycle and technical-debt reporting
- repeated matching without reparsing the same noisy signatures each run

### First-Slice Modeling Rule

In the MVP slice:

- software evidence should be first-class in persistence
- normalized software identity should be first-class in persistence
- software evidence should relate to discovered host/container/runtime entities
- software identities should **not** yet be projected as broad first-class operational graph nodes by default

This keeps the persistence model future-safe without creating graph explosion too early.

---

## Data Model Changes

The first slice should preserve not only the taxonomy assignment, but how it was reached.

### `InventoryEntity`

Add or formalize:

- `taxonomyNodeId`
- `attributionMethod`
  - `rule`
  - `heuristic`
  - `ai_proposed`
  - `manual`
- `attributionConfidence`
- `attributionEvidenceJson`
- `candidateTaxonomyJson`

Software-related metadata may live on `InventoryEntity` only when it describes the entity itself, not package inventory. Software/package evidence should be stored separately.

### `DiscoveredSoftwareEvidence`

Add a new persistence model for raw installed software/package evidence:

- discovered entity context
- evidence source (`host_package`, `host_installed_software`, `container_package`, `container_image_layer`, etc.)
- raw vendor
- raw product name
- raw package name
- raw version
- install location or package path
- package manager type
- raw metadata JSON
- first/last seen timestamps

### `SoftwareIdentity`

Add a normalized software identity model:

- normalized vendor
- normalized product name
- normalized edition/variant
- canonical version string
- alias/fingerprint data
- confidence or source-of-normalization metadata

### `SoftwareNormalizationRule`

Add a rule model for the deterministic catalog that grows over time:

- match type
- raw alias/signature pattern
- resolved software identity
- version normalization transform
- status
- source (`seeded`, `approved_from_heuristic`, `approved_from_ai`, `manual`)

This is the durable operational layer that reduces future heuristic load.

`attributionStatus` remains the primary lifecycle signal:

- `attributed`
- `needs_review`
- `unmapped`
- `stale`

### `PortfolioQualityIssue`

Add or use issue types such as:

- `taxonomy_attribution_low_confidence`
- `taxonomy_attribution_conflict`
- `discovered_function_unmapped`
- `digital_product_match_missing`
- `software_identity_low_confidence`
- `software_version_unparsed`
- `software_alias_conflict`

These issues should remain open until resolved manually or by a later higher-confidence run.

---

## Graph Semantics

Discovery output must support later impact analysis, so the graph should preserve both operational identity and semantic classification.

For each discovered entity:

- keep the operational entity as its own node
- preserve its runtime or infrastructure relationships
- attach its taxonomy classification as an explicit relationship
- later attach digital-product mappings when those become available

This allows later traversal such as:

- runtime dependency -> discovered entity
- discovered entity -> taxonomy node
- taxonomy node -> portfolio responsibility
- discovered entity -> digital product
- discovered entity -> software evidence
- software evidence -> normalized software identity

That is the minimum needed for provider-side reporting and downstream analysis.

---

## Confidence And Review Handling

Confidence handling should be explicit:

- high confidence: persist direct attribution
- medium confidence: persist attribution and flag for review if policy requires
- low confidence: no final taxonomy assignment, create open quality issue

Low confidence is still valuable. It should become a managed queue, not discarded output.

This aligns with the broader portfolio-quality principle:

- uncertain matches are quality work
- missing future confirmations are quality work
- discovered-but-unclassified entities are quality work
- software signatures without durable normalization are quality work

---

## MVP Slice

The MVP implementation slice should do all of the following:

1. Add taxonomy attribution metadata fields to inventory entities.
2. Add a dedicated attribution module in `packages/db/src`.
3. Implement deterministic mappings for obvious platform/runtime entities.
4. Implement heuristic candidate scoring against taxonomy nodes.
5. Persist taxonomy candidates and confidence/evidence.
6. Raise low-confidence review issues.
7. Add raw software/package evidence capture for host and container contexts.
8. Add normalized software identity matching with deterministic rules first.
9. Add a path for heuristic or AI-derived matches to become approved deterministic rules.
10. Keep AI-assisted attribution behind a clean interface, but do not require it to ship this slice.

This is intentionally enough to improve discovery now without overbuilding the agent path.

---

## Expected Outcomes

After this slice:

- discovered infrastructure is not only in the `Foundational` portfolio, but tied to the right taxonomy descriptor
- ambiguous product-function discoveries can be proposed against taxonomy with confidence
- the graph becomes more useful for future impact analysis
- low-confidence cases are surfaced as quality work instead of being lost
- a future AI coworker can reuse the same attribution stages rather than replacing them
- software inventory can begin supporting later license, vulnerability, and version lifecycle analysis
- normalization effort decreases over time because approved heuristic results become deterministic rules

---

## Testing Strategy

Add focused tests for:

- deterministic rule attribution
- heuristic candidate ranking
- low-confidence review issue creation
- persistence of taxonomy metadata on inventory entities
- graph projection inputs including taxonomy assignment
- regression case: foundational host/runtime discovery remains attributed even after taxonomy logic is added
- host software evidence capture
- container package evidence capture
- software identity normalization from noisy names
- deterministic rule synthesis path from approved heuristic results

Do not rely on manual inspection alone. The attribution path needs repeatable tests because it will become part of bootstrap recovery and later agent automation.

---

## Implementation Notes

Suggested implementation areas:

- `packages/db/prisma/schema.prisma`
- `packages/db/src/discovery-attribution.ts`
- `packages/db/src/discovery-attribution.test.ts`
- `packages/db/src/discovery-sync.ts`
- `packages/db/src/discovery-sync.test.ts`
- `packages/db/src/software-normalization.ts`
- `packages/db/src/software-normalization.test.ts`
- `apps/web/lib/discovery-data.ts`
- inventory quality/read surfaces as needed

This slice should remain additive and should not attempt full product reconstruction or business-record restoration.
