# Archetype Readiness Matrix and Sales-Claim Gate

**Backlog item:** `BI-C1C706F1`
**Work capsule:** `WC-3F1BC29F`
**Branch:** `feat/archetype-readiness-matrix`
**Date:** 2026-07-28

## Goal

Turn the platform adequacy review finding into executable substrate: a typed archetype readiness ladder and a reusable claim gate that prevents template coverage from being treated as operational, connector, regulated, or sole-platform readiness.

## Current Evidence

- The existing archetype taxonomy and template substrate live in `packages/storefront-templates/src/types.ts` and `packages/storefront-templates/src/archetypes/index.ts`.
- The archetype completeness gate proves structural/template presence, not day-2 operational adequacy: `docs/superpowers/specs/2026-07-21-archetype-provisioning-playbook-design.md`.
- The vertical backlog architecture names `BI-PSC-010` as the keystone for typed archetype contributions and sequences it ahead of broad vertical execution: `docs/superpowers/specs/2026-07-24-vertical-backlog-investment-architecture-design.md`.
- Live backlog on 2026-07-28 shows `BI-PSC-010` is open under `EP-PLATFORM-SUBSTRATE-CONVERGENCE`.
- Live vertical-readiness epics exist for most current archetype categories, but they are largely open; this is evidence of a readiness lane, not evidence that the category is already ready.

## Scope

This slice is atomic for `BI-C1C706F1`. It does not close `BI-PSC-010`, add a migration, or change public marketing surfaces in this PR. Instead, it creates the typed source of truth that those surfaces can consume, and it documents the manual gating rule until UI/public copy is wired to it.

## Implementation

- Add `packages/storefront-templates/src/archetype-readiness.ts`.
- Export the readiness API from `packages/storefront-templates/src/index.ts`.
- Define the closed tier ladder:
  - `template-ready`
  - `ops-ready`
  - `connector-ready`
  - `regulated-ready`
  - `sole-platform-ready`
- Define typed evidence references for backlog items, epics, specs, plans, code artifacts, and verification artifacts.
- Define reusable tier requirements so each tier has concrete evidence expectations.
- Build an initial category-level matrix from `ALL_ARCHETYPES`, with:
  - `template-ready` claimable where the category exists in the shipped taxonomy.
  - vertical-readiness epics and `BI-PSC-010` cross-referenced as readiness dependencies.
  - higher tiers blocked unless explicit evidence is attached.
- Add `evaluateArchetypeReadinessClaim` and `assertArchetypeReadinessClaimAllowed` helpers.
- Add focused Vitest coverage proving:
  - every shipped category has a readiness record.
  - the tier ladder is ordered and closed.
  - no category can claim `sole-platform-ready` from template evidence alone.
  - sales/public claims above the current evidence are blocked with actionable missing evidence.
  - `BI-PSC-010` and existing vertical readiness epics are represented as dependencies.
- Update the architecture roadmap note with the new source file once the implementation lands.

## Refactoring Reserve

At least 20 percent of this slice is reserved for keeping the contract reusable and narrow: a pure module, no DB coupling, no UI-only logic, and helper functions that future public/docs/sales surfaces can consume directly instead of re-implementing claim rules.

## Verification

- Source-local targeted unit test: `pnpm --filter @dpf/storefront-templates exec vitest run src/archetype-readiness.test.ts`.
- Source-local package typecheck: `pnpm --filter @dpf/storefront-templates typecheck`.
- Production build is not expected to change behavior, but the PR still needs the normal DPF build gate before merge.
- No migration gate is required.
- No UX verification is required in this slice because there is no rendered UI change.

## Backlog Coverage

- Decision: atomic
- Parent: `BI-C1C706F1`
- Receipt: `cms4s3mql0t6d01rutnsjhq9l`
- Dependencies: `BI-PSC-010`; existing vertical-readiness epics referenced by the readiness matrix
- Rationale: the deliverables form one reusable claim-control substrate; splitting the tier constants, evidence matrix, claim helper, and tests would create non-functional partial states.

Deliverables:

- Typed archetype readiness tier contract.
- Evidence-backed category readiness matrix with `BI-PSC-010` and vertical-readiness dependencies.
- Reusable sales/public claim gate helpers.
- Unit tests proving coverage, blocked overclaims, and dependency cross-references.
- Roadmap/doc update pointing to the executable source of truth.
