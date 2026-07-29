# Spatial scene contract — implementation plan

**Backlog item:** BI-EA4B8638  
**Epic:** EP-SPATIAL-OPERATIONAL-VIEWS  
**Parent plan:** [2026-07-21-spatial-operational-views-plan.md](2026-07-21-spatial-operational-views-plan.md)  
**Design:** [2026-07-21-spatial-operational-views-design.md](../specs/2026-07-21-spatial-operational-views-design.md)  
**Date:** 2026-07-29

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Give every physical operational-twin template one derived coordinate-space classification and publish a renderer-neutral, pure TypeScript `SceneLayout` contract. The result is the compile-time boundary used by the persisted-layout and renderer BIs that follow; this BI adds no UI, persistence, runtime service, or dependency.

## Existing substrate

- `packages/storefront-templates/src/twin-profile.ts` is the single source of truth for template selection, physical classification, leaf overrides, and all archetype-to-twin derivation.
- `packages/storefront-templates/src/twin-profile.test.ts` already proves totality over every seeded archetype and validates template/physical invariants.
- `packages/storefront-templates/src/index.ts` is the package public surface.
- No `SceneLayout`, `SpaceKind`, or equivalent geometry contract exists in `packages/storefront-templates` or `apps/web`.
- The parent design assigns FLOOR, STORE, BAYS, BOOK, ROOMS, VENUE, COUNTER, DOCK, and YARD to `cartesian-interior`; TERRITORY to `geographic`; future factory/topology work uses `node-graph`.

## Atomic delivery sequence

1. **Define the contract with failing tests.**
   - Add `packages/storefront-templates/src/scene-layout.test.ts`.
   - Assert the three closed `spaceKind` values, template mapping, valid cartesian/geographic/node-graph examples, immutable entity references, optional underlay, and viewport/zone/placement structure.
   - Extend the existing all-archetype totality test so every derived physical profile has the expected `spaceKind` and every board profile has none.

2. **Implement the pure package boundary.**
   - Add `packages/storefront-templates/src/scene-layout.ts`.
   - Model `SceneLayout` as a discriminated union keyed by `spaceKind`, with coordinate-space-specific zones and placements, typed `{ kind, id }` entity references, optional `underlayRef`, and a shared viewport.
   - Export the contract from `packages/storefront-templates/src/index.ts`.

3. **Derive space kind from the final template.**
   - Add a total physical-template mapping in `twin-profile.ts`.
   - Expose `spaceKind` on `TwinProfile` without adding it to `TwinProfileOverride`; operators may override a template but may not author its coordinate system.
   - Derive after applying the leaf override so an overridden template cannot retain a stale coordinate-space classification.

4. **Verify and hand off.**
   - Run the storefront-template test suite and typecheck.
   - Run the governed merged-code gate against current `origin/main`.
   - Confirm no UI, migration, runtime, or documentation beyond architecture/implementation history is affected.
   - Push the signed branch, open a ready PR, run `pr:health`, and merge through the queue.

## Acceptance criteria

- Every seeded physical archetype resolves exactly one of `cartesian-interior`, `geographic`, or `node-graph`.
- Board twins remain explicitly non-spatial and do not receive a `spaceKind`.
- A template override recomputes the coordinate-space classification from the overridden template.
- `SceneLayout` cannot mix cartesian, geographic, and node-graph geometry within one scene at compile time.
- The contract represents zones, placements, entity references, viewport, and optional underlay without React Flow, MapLibre, Prisma, or browser dependencies.
- The package exports the new contract for the persistence and renderer BIs.

## Risks and rollback

- **Stale override classification:** deriving before `applyOverride` would make template overrides lie. Mitigation: derive from the final profile and test physical-to-board and board-to-physical overrides.
- **Over-general JSON types:** untyped coordinate bags would push errors into render time. Mitigation: a discriminated union with space-specific zone and placement geometry.
- **Premature provider coupling:** importing React Flow, GeoJSON packages, or persistence models would contaminate the pure template package. Mitigation: structural primitives only and a dependency-free bundle boundary.
- **Rollback:** revert the single package/API commit. This BI adds no data, migration, stored state, or runtime side effect.

## Backlog coverage

- Decision: atomic
- Parent: `BI-EA4B8638`
- Receipt: `cms6531fc001d01o610vai1vn`
- Deliverable: `scene-contract-foundation` — derived physical `spaceKind` mapping and renderer-neutral `SceneLayout` contract
- Dependencies: none
- Rationale: the mapping and types are one compile-time boundary; neither independently enables a renderer, and splitting them would publish an intermediate API unable to express its mapped scene.

Operational-Precedent: restaurant-floor
