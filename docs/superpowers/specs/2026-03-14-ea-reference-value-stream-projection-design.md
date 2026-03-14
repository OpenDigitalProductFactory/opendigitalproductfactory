# EA Reference Value Stream Projection Design

**Date:** 2026-03-14  
**Status:** Proposed  
**Scope:** Add a repeatable, in-repository workflow that projects normalized reference-model value streams into visual EA views, with IT4IT as the first supported model.

---

## Overview

The platform already stores normalized reference-model data in `EaReferenceModel` and `EaReferenceModelElement`, and it already has an EA canvas with structured value-stream rendering. What is missing is the bridge between those two capabilities: a safe, repeatable way to materialize reference-model value streams into an EA view without relying on manual canvas construction or destructive database resets.

The first MVP slice should restore a usable value-stream view for IT4IT, because that is the immediate visibility gap blocking EA assessment of the portal and factory against the standard. The design must not hard-code the product to IT4IT only, because the same mechanism will later need to support other reference architectures and uploaded reference artifacts processed by an embedded AI coworker.

---

## Problem Statement

Current live state shows:

- the normalized IT4IT reference model is present in `EaReferenceModel`
- hundreds of normalized reference-model elements are present in `EaReferenceModelElement`
- the EA workspace has generic views and structured value-stream rendering support
- no actual EA projection exists for the reference model
- no view elements have been created for the imported model

That leaves the user with reference-model metadata but no visible architecture to inspect in the EA modeler. The platform needs a deterministic projection workflow that can create or refresh a value-stream view from normalized model content.

---

## Goals

- Create a generic reference-model projection foundation for EA.
- Support a repeatable `value_stream_view` projection type as the first implemented projection.
- Materialize one visual EA view from normalized reference-model value-stream data.
- Reuse the structured value-stream canvas behavior already designed for nested chevrons.
- Make reruns safe and idempotent so the projection can be refreshed without duplicates.
- Keep ingestion and projection separate so future uploaded artifacts and agent-driven normalization can use the same projection path.
- Preserve a path for future projection of additional reference-model structures beyond value streams.

---

## Non-Goals

- Full generic projection of every reference-model structure in this phase.
- Full UI-driven artifact upload and AI normalization workflow in this phase.
- Full assessment scoring or criteria visualization in the same EA view.
- Automatic agent execution in the EA page in this phase.
- Arbitrary freeform import of all reference-model content into canvas views.

This slice is focused on the first deterministic projection: normalized value streams into an EA view.

---

## Key Design Decisions

### 1. Projection and ingestion are separate concerns

Reference-model artifacts may later be uploaded in the UX and normalized by an embedded AI coworker, but that is not the same concern as visualizing a normalized model in the EA canvas.

The architecture should therefore separate:

- **Reference ingestion:** acquire artifacts and normalize them into `EaReferenceModel` and `EaReferenceModelElement`
- **Reference projection:** create or refresh EA views from normalized reference-model content

This prevents current EA visualization work from depending on unfinished agent-ingestion features.

### 2. The projection layer is generic, even though IT4IT is first

The first concrete use case is IT4IT because it is already seeded and is the immediate MVP need. The implementation should still expose a generic projection contract, not a one-off IT4IT-only script.

Recommended projection inputs:

- `referenceModelSlug`
- `projectionType`

For this phase:

- `referenceModelSlug = "it4it_v3_0_1"`
- `projectionType = "value_stream_view"`

Future standards such as BIAN, TM Forum, COBIT, or ACORD should be able to plug into the same contract.

### 3. Reference-model records are the source of truth

The projection must be derived from normalized reference-model records already persisted in the database, not from hand-authored canvas state.

The authoritative source for the projected view is:

- `EaReferenceModel`
- `EaReferenceModelElement`

The EA view is a projection of that source, not an independent manually curated model.

### 4. Value-stream views reuse structured notation behavior

The structured notation work already established:

- parent value stream
- nested ordered child stages
- implied stage sequence
- hidden stage-to-stage edges in this projection
- structural conformance warnings for broken containment

The reference-model projection should reuse that model rather than introducing a separate visual convention.

### 5. Repeatability is required

The projection must be rerunnable without:

- database resets
- duplicated EA elements
- duplicated EA view elements
- manual cleanup

The future embedded agent should call the same projection logic rather than inventing its own write path.

---

## Conceptual Architecture

### Reference ingestion lane

This lane is responsible for bringing source artifacts into normalized EA reference-model records.

Inputs may later include:

- seeded workbook and document files already in the repository
- user-uploaded artifacts in the EA UX
- AI-assisted parsing and proposal workflows

Outputs:

- `EaReferenceModel`
- `EaReferenceModelArtifact`
- `EaReferenceModelElement`

### Reference projection lane

This lane is responsible for turning normalized model content into visible EA views.

Inputs:

- a normalized reference model
- a chosen projection type

Outputs:

- `EaView`
- `EaElement`
- `EaRelationship`
- `EaViewElement`
- optional conformance warnings if projection structure is incomplete

The current phase implements the projection lane for value streams only.

---

## Projection Contract

Add a projection service with a generic entrypoint similar to:

```ts
type ReferenceProjectionType = "value_stream_view";

async function projectReferenceModel(input: {
  referenceModelSlug: string;
  projectionType: ReferenceProjectionType;
}): Promise<{
  viewId: string;
  createdView: boolean;
  createdElements: number;
  updatedElements: number;
  createdViewElements: number;
  updatedViewElements: number;
}>;
```

For this phase the only supported projection type is `value_stream_view`, but the contract should remain generic.

---

## Value Stream Projection Behavior

For a `value_stream_view` projection:

1. Resolve the reference model by slug.
2. Read reference-model elements for:
   - `kind = "value_stream"`
   - `kind = "value_stream_stage"`
3. Determine parent-child relationships from the reference-model tree.
4. Upsert one EA view for this projection.
5. Upsert one EA element for each projected value stream and stage.
6. Upsert `EaViewElement` rows so:
   - each value stream is a top-level view element
   - each stage is nested under its parent value stream
   - stage order is persisted in `orderIndex`
7. Ensure implied stage sequence relationships are synchronized in the model if the structured-canvas behavior requires them.
8. Return the target `viewId` so the UX can navigate directly to it.

Visual behavior in the canvas:

- value streams render as large parent chevrons
- stages render as smaller nested chevrons
- stage sequence is implied by order
- stage-to-stage edges remain hidden in this projection

---

## Identity and Idempotency

The projection needs stable identity rules so reruns update rather than duplicate.

Recommended approach:

- derive a stable EA element identity from:
  - reference model slug
  - projection type
  - reference model element slug
- keep a stable EA view identity from:
  - reference model slug
  - projection type

This can be implemented either through:

- a dedicated projection metadata table, or
- deterministic naming/properties stored on EA entities

For the MVP slice, storing projection metadata in EA element/view properties is acceptable if it keeps the implementation simpler and deterministic.

Minimum metadata to persist:

- `referenceModelSlug`
- `projectionType`
- `referenceElementSlug`

That metadata should be enough to find and refresh prior projected records safely.

---

## UX Behavior

The reference-model detail page should expose an explicit action to load or refresh the projection.

Recommended MVP behavior:

- show a button on the reference-model detail page:
  - `Load value stream view` if no projection exists
  - `Refresh value stream view` if a projection already exists
- on success, navigate directly to the EA view page

This keeps the workflow deterministic and visible to the user without waiting for the future embedded agent UX.

Later, the embedded agent can trigger the same server action on command.

---

## Data Model Guidance

This phase should avoid unnecessary schema expansion if current models are sufficient. Prefer using existing EA tables plus deterministic metadata first.

If existing EA entities need projection metadata, acceptable MVP locations are:

- `EaView.scopeType` / `scopeRef` where appropriate
- `EaElement.properties`
- `EaViewElement.proposedProperties` only if there is no better existing location

If a new projection registry table is introduced later, it should be because the existing metadata approach becomes insufficient for:

- multiple projections per model
- richer refresh bookkeeping
- audit of agent-generated projections

Do not overbuild this part now.

---

## Failure Handling

The projection action should fail clearly when:

- the reference model slug does not exist
- the model exists but has no value-stream elements
- the model exists but stage structure is malformed

Errors should be explicit and operator-friendly. They should not trigger destructive repair behavior such as resetting the database.

If structure is incomplete but still renderable, project what is valid and surface structural conformance warnings in the EA model instead of aborting the entire load.

---

## Testing Strategy

The first implementation should prove:

1. A normalized reference model with value streams and stages can be projected into an EA view.
2. The view contains nested ordered stages under each value stream.
3. Re-running the projection is idempotent and does not create duplicates.
4. The reference-model detail action returns a stable view target.
5. The canvas read model sees the projected value streams and stages correctly.

Tests should include:

- db-level projection service tests
- server-action tests
- read-model tests where needed

---

## MVP Success Criteria

This phase is successful when:

- the IT4IT reference model detail page can load a value-stream projection into the EA workspace
- the resulting EA view visibly shows value streams and nested stages
- rerunning the action refreshes the same view instead of duplicating it
- the workflow is repeatable from repository-backed normalized data
- no database reset is needed to restore the view

---

## Future Evolution

This projection foundation should later support:

- additional projection types beyond value streams
- user-uploaded reference artifacts
- AI-assisted normalization and proposal review
- agent-triggered projection execution
- projection of criteria, capability groups, and other structures
- portfolio-scoped and mixed reference-model comparison views

The future architecture should extend this projection framework, not replace it.
