# Grid views inherit the domain page's default data lens

**Backlog item:** `BI-9DB20C39`  
**Epic:** `EP-GRID-WORKBOOKS`  
**Decision ledger:** `DI-93238917B4E0`  
**Branch:** `fix/grid-default-data-lens`

## Outcome

Switching a domain page from List to Grid or Board keeps the domain's default dataset. Operations therefore opens Grid and Board on active backlog work (`triaging`, `open`, and `in-progress`) instead of materializing done and deferred history. Compliance controls, obligations, and risks likewise retain their existing active-only List defaults; Opportunities keeps its open pipeline stages; and Customers continues to exclude superseded merge tombstones. Historical rows remain deliberately reachable through an all-records scope.

This corrects the implementation gap in the existing Universal Grid design. That design already specifies pre-configured platform grids with sensible defaults and one shared `DataSourceFilter` shape for source and view filters; this plan makes the page-to-grid boundary honor that contract.

## Substrate and research grounding

- `apps/web/app/(shell)/ops/page.tsx` defaults the List surface through `OpsClient`'s `activeOnly=true` state but calls `SurfacePlatformGrid` without a filter.
- `apps/web/components/workbooks/SurfacePlatformGrid.tsx` always calls `getAllPlatformTableRows` without scope.
- `apps/web/lib/workbooks/platform-tables.ts` is the canonical registry for each grid's home surface and already owns the shared eager-loader path.
- `apps/web/components/ops/backlogVisibility.ts` owns active-versus-terminal semantics today, but its component-layer location prevents the adapter registry from reusing it cleanly.
- `apps/web/lib/workbooks/backlog-adapter.ts` materializes the rich domain backlog read model and filters in memory.
- `getAllPlatformTableRows` currently calls an adapter once per 200-row page; for 4,316 backlog items that repeats the full read roughly 22 times.
- The existing [Universal Grid & Workbooks design](../specs/2026-03-23-universal-grid-workbooks-design.md) benchmarks Airtable and Smartsheet and adopts multiple views, shared filters, saved presentation views, and an adapter framework. This work extends those decisions rather than introducing another grid or filter model.
- The [platform usability standards](../../platform-usability-standards.md) require stable, server-readable query filters and one canonical source for shared UI behavior.

No database model, enum, migration, route family, or new grid primitive is needed.

## Architecture decision

Three grounded options were scored by the platform kernel:

1. `page-local` — pass an Ops-only filter into the grid.
2. `saved-view-default` — use a browser-personal saved grid view as the domain default.
3. `registry-data-lens` — add an optional default data lens to the canonical platform-table home-surface contract and apply it in the shared loader.

The kernel recommended `registry-data-lens` with composite `5.624`, margin `4.888`, high confidence, strong structured coverage, and no commandment conflict (`DI-93238917B4E0`). Architecture Over Shortcuts, Ground New Work in Existing Platform, and Single Source of Truth favored the registry contract. Personal saved views remain presentation state; they do not own the business meaning of a domain's default dataset.

## Design

### Domain data lens

Extend `PlatformTableHomeSurface` with an optional typed `defaultDataLens`:

- a plain-language default label;
- a plain-language all-records label;
- a `DataSourceFilter` applied before eager materialization.

Each surface whose List already has an implicit default declares that same lens: active backlog work, active compliance controls/obligations/risks, open opportunities, and current (non-superseded) customers. Tables without a declared lens continue to show all rows, which is their current List behavior.

### Page-to-grid request state

Extend the pure surface-view helper with a closed `default | all` data-scope parser and a stable URL builder. `SurfaceViewSwitcher` renders the scope choice only for Grid/Board surfaces whose registry entry declares a lens. The default URL omits the scope parameter; `dataScope=all` is the deliberate historical-data override. The namespaced key does not collide with domain filters such as Compliance's existing `scope`.

### Read path

`SurfacePlatformGrid` resolves the registry lens and passes its filter to `getAllPlatformTableRows` unless the request explicitly selects `all`. The shared eager loader asks the adapter for the whole bounded dataset once instead of repeatedly rematerializing the source in 200-row chunks. The backlog adapter uses a narrow Prisma projection and pushes the supported status lens into its query, then still runs the shared filter function as a correctness guard.

### State boundaries

- Domain data lens: server-readable, registry-owned, shared across List/Grid/Board meaning.
- Personal saved view: browser/user-owned presentation state (sort, group, columns, secondary filters).
- Explicit `dataScope=all`: URL-owned override, useful for deep links and no-JS navigation.

## Implementation phases

### Phase 1 — red tests for the contract

Add failing tests that prove:

- unknown or absent scope resolves to the default lens;
- `dataScope=all` bypasses the default lens;
- the backlog active status set excludes `done` and `deferred` and is shared by List and Grid semantics;
- the eager loader invokes its adapter once for a bounded all-row request;
- the backlog adapter translates the active status filter into a Prisma `where` clause.

### Phase 2 — shared contract and refactor

- Move backlog lifecycle visibility helpers from the Ops component folder into `apps/web/lib/` so domain UI and grid registry share one source.
- Add the typed registry data-lens contract and backlog configuration.
- Add the pure scope parser/URL builder and wire it through `PlatformGridSection`, `SurfaceViewSwitcher`, and `SurfacePlatformGrid`.
- Update `/ops` to parse and pass the closed scope value.

### Phase 3 — bounded read performance

- Replace repeated eager adapter pagination with one bounded adapter request.
- Narrow the backlog grid query to the grid's scalar projection.
- Push the active status condition into Prisma when the filter can be represented safely; retain shared in-memory filtering for exact adapter semantics.

### Phase 4 — verification and evidence

- Run the targeted Vitest files and the affected web suite.
- Run `pnpm --filter web build` in the proper compile-ready/local-CI environment.
- Exercise `/ops`, `/ops?view=grid`, `/ops?view=board`, and the `dataScope=all` override against the governed canonical/shared runtime.
- Confirm the default grid excludes done/deferred rows, the all-records view includes them, the scope control is keyboard reachable, and light/dark styling remains token-based.
- Record a measured UX-fit manifest and runtime/capsule evidence.

## Backlog coverage

- Decision: `atomic`
- Receipt: `cmsktm3xr01r601qlbia3oclf`
- Parent BI: `BI-9DB20C39`
- Rationale: the registry contract, loader optimization, surface override, and verification jointly define one user-visible invariant. Shipping any phase alone would preserve either the semantic mismatch, the unbounded load, or an unrecoverable hidden-history state.
- Internal deliverables:
  - `contract` — registry-owned default data lens and shared resolver
  - `loader` — filter-aware eager loading without repeated source materialization; depends on `contract`
  - `surface` — Operations active-only default with deliberate all-records override; depends on `contract`, `loader`
  - `verification` — regression, build, UX, and runtime evidence; depends on `surface`

## Architecture review (advisory)

- Alignment summary: aligned with important guardrails.
- `[important]` A page-local prop would make the same rule live once per route. Suggestion: declare the lens on `PlatformTableHomeSurface` and resolve it in the shared page-to-grid components.
- `[important]` A personal saved view is not a reliable business default and cannot prevent the first unbounded read. Suggestion: keep saved views presentation-only and apply the domain lens server-side.
- `[important]` Server filtering without a visible escape would make historical records appear missing. Suggestion: add the stable `dataScope=all` URL and a shared, plain-language scope control.
- `[minor]` Ops lifecycle semantics currently live under `components/`. Suggestion: move them to `lib` and have both List and Grid use the same active/terminal constants.
- Standards adopted: existing Universal Grid `DataSourceFilter`, cursor/bounded-query contract, stable query parameters, token-aware shared controls. No new external dependency or standard is required.
- Escalated decision: `DI-93238917B4E0`; high-confidence `registry-data-lens` recommendation.

## UX fit review — domain data lens across List/Grid/Board

- Decision: `fits-with-guardrails`
- Owning area: Platform substrate, surfaced in Operations
- Route family: `/ops` and existing domain home surfaces registered in `PLATFORM_TABLES`
- Primary persona: platform operator reviewing actionable work without waiting for closed history
- Navigation layer touched: local page view/scope controls only
- Reuse/convergence: extend `SurfaceViewSwitcher`, `SurfacePlatformGrid`, `PlatformGridSection`, and the existing filter contract; no new grid dialect
- Source truth: live `BacklogItem.status` plus registry-owned `DataSourceFilter`
- Empty/failure behavior: an empty active lens remains an honest zero-row grid; adapter permission/errors retain the existing plain-language message
- AI boundary: no prompt send
- Required guardrails: scope choice must be visible on Grid/Board, `dataScope=all` must be stable and server-readable, saved presentation state must not silently redefine domain scope
- Evidence before merge: pure resolver tests, adapter/filter tests, one-call eager-loader test, theme scan, UX budget measurement, and browser proof for default/all Grid and Board paths
- Captured in: this plan and the branch UX-fit manifest

## Risks and rollback

- Risk: a filter is declared against a column an adapter does not expose. Mitigation: validate lens conditions against adapter columns and fail closed with a clear error in tests.
- Risk: a saved personal filter appears to conflict with the domain lens. Mitigation: present the domain scope separately and keep saved filters secondary within the loaded dataset.
- Risk: a one-shot bounded adapter request exposes an adapter that assumes 200-row pages. Mitigation: cover the shared loader with a fake adapter and retain `MAX_GRID_ROWS` as the hard ceiling.
- Risk: Prisma push-down drifts from shared filter semantics. Mitigation: only translate the closed status `in` condition and reapply `applyFilters` to returned rows.

Rollback is a normal code revert: remove the optional registry lens and restore the paginated eager loader. There is no migration or persisted data change.

## Documentation impact

Update the Universal Grid design's embedded-domain section to state that a domain's default data lens is registry-owned, server-applied before materialization, and distinct from personal saved view state. No user-guide route changes are needed; the control is self-describing and the URLs remain under the existing home routes.
