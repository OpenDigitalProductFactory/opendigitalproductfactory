# Fold value-stream + lifecycle STRUCTURE onto Work Rooms — Implementation Plan

**Epic:** EP-WORKROOM-COMMS (structure fold) · **Date:** 2026-08-14 · **Scope:** platform (WWMD)
**Design of record:** `docs/superpowers/specs/2026-08-12-work-model-convergence-addendum-common-work-formula-design.md` §2 (a Work Room is collaborative *within a structure*)
**Reuses:** the VSL substrate (EP-VSL-SURFACE) — OVSM value stream + lifecycle grammars. Folded on, **not rebuilt**.

## Why

A Work Room is collaborative, but collaboration needs a frame: the *subject* the room is
formed around sits somewhere in a value stream and follows a lifecycle. The founder's
vision — "they need structures: a value stream, lifecycles for the subject they are
formed around" — plus the parallel EP-VSL-SURFACE loose ends (OVSM stage resolvers,
lifecycle-grammar backbone) folded onto the room projection so a room shows *where its
subject is* and *what it takes to advance*, keeping the collaboration on-task.

## What the substrate already gives us (reused verbatim)

- **OVSM value stream** — `accountStatusToOvsmStage` / `opportunityStageToOvsmStage` /
  `ovsmStageLabel` (`apps/web/lib/crm/account-value-stream.ts`) map a subject's stored
  status/stage to one of the 6 OVSM stages.
- **Lifecycle grammars** — `CUSTOMER_ACCOUNT_GRAMMAR`, `OPPORTUNITY_GRAMMAR` +
  `resolveCustomerAccountPoint` / `resolveOpportunityPoint`
  (`apps/web/lib/lifecycle-grammars.ts`) resolve a subject to a `(stage, state)` point.
- **The advancement gate** — `canAdvance(grammar, from, toStage)` + `getStage`
  (`apps/web/lib/lifecycle-grammar.ts`) yield, for the current stage, a typed allow/refuse
  per legal onward target.

## The fold (this slice)

No schema change, no boundary-gap touch, `buildWorkRoomView` stays pure/DB-free.

1. **`apps/web/lib/work-management/room-structure.ts` (pure)** — `resolveWorkRoomStructure(subject)`
   folds a subject descriptor (`{kind:"opportunity",stage}` | `{kind:"customer-account",status}`)
   onto `{ valueStream:{stage,label}, lifecycle:{grammarKey,stage,state,band,nextGates[]} }`.
   `nextGates` = for each `getStage(...).advancesTo`, `canAdvance(...)`. Plus
   `workRoomStructureSubjectFor({sourceType, opportunityStage?, accountStatus?})` — the
   per-source → subject mapping (a plain side-function, **not** the source-registry, to
   avoid the `satisfies` exhaustiveness drift).
2. **`WorkRoomView.structure`** (`room-types.ts`) — new field, `WorkRoomStructure | null`.
3. **`buildWorkRoomView`** (`room-read-model.ts`) — takes `structure` pre-resolved as
   input (like `sourceHealth`) and sets it; the build stays pure.
4. **`room-structure.server.ts`** — `resolveWorkRoomStructureForCase({sourceType,sourceId})`
   fetches the subject's stored stage/status with full prisma and calls the pure resolver.
   First slice resolves the **opportunity** subject (a clean, direct source→subject map).
5. **Loader injection** — `loadWorkspaceWorkCaseDetail` gains an optional `structureLoader`
   (mirrors the existing `participantLoader` injection); the page wires
   `resolveWorkRoomStructureForCase`. Keeps the loader's narrow prisma client off the CRM models.
6. **UI** — `WorkRoomStructurePanel` renders the value stream, lifecycle stage/state
   (health-banded), and advancement gates (locked/unlocked with the refusal reason) in the
   room header; renders nothing when structure is null.

## Deliberately deferred (paved, additive — no contract change)

- **Account-backed sources** (engagement / activity / booking → `CustomerAccount.status`):
  `workRoomStructureSubjectFor` already accepts `accountStatus`; wiring is an additive
  branch in `resolveWorkRoomStructureForCase` once the source→account resolution lands.
- **Platform-development subjects** (backlog-item / work-capsule / task-node): fold onto
  the platform's *own* delivery value stream + a work lifecycle — a separate grammar.
- Structure on the room LIST projection and as a filter/rollup dimension.

## Verification

- Pure resolver unit tests (`room-structure.test.ts`): opportunity + customer-account fold,
  null subject, gate derivation with typed allow/refuse.
- Panel render test (`WorkRoomStructurePanel.test.tsx`): value stream + lifecycle + gates
  surfaced; null renders nothing.
- Existing room read-model / detail-view / loader tests updated for the new field and green.
- `tsc --noEmit` clean; full local-CI gate before PR.
