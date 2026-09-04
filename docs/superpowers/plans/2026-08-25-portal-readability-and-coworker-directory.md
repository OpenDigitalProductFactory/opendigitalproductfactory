---
status: binding
---

# Portal readability and coworker-directory implementation plan

**Backlog item:** `BI-6DBD3AB4`  
**Workroom:** `WC-2BD67603`  
**Design:** `docs/superpowers/specs/2026-08-24-portal-readability-and-coworker-directory-design.md`

## Delivery slice

Ship the three operator-reported regressions as one atomic repair:

1. make Operational Metrics theme-safe by composing report-kit;
2. put the AI coworker roster directly on `/workforce`;
3. make relationship canvases resolve colors from the active DPF theme.

The three phases are internal checkpoints, not independent deliverables. Acceptance is the browser-visible outcome across all three reported surfaces, and all three share the same UX-fit, theme, and verification gate.

## Baseline traceability

The atomic deliverable traces to objectives `OBJ-METRICS-READABILITY`, `OBJ-COWORKER-DIRECTORY`, and `OBJ-GRAPH-READABILITY`; contracts `docs/superpowers/specs/2026-08-24-portal-readability-and-coworker-directory-design.md` and `AGENTS.md: theme-aware styling and report-kit convergence`; flows `/platform/audit/metrics`, `/workforce`, and `/admin/graph-explorer`; and acceptance statements `AC-REGRESSION-TESTS`, `AC-THEME-SAFETY`, `AC-DIRECT-ROSTER`, and `AC-QUALITY-GATES`.

## Backlog coverage

- Decision: atomic
- Parent: `BI-6DBD3AB4`
- Repair the three reported portal usability regressions -> `BI-6DBD3AB4`
- Dependencies: none
- Receipt: `cmt8q42fr0s4a01mgheohyu1s`
- Rationale: metrics readability, direct coworker access, and graph readability share one operator-reported acceptance boundary and must pass together.

## Phase 1: Add regression coverage

### Operational Metrics

- Add `apps/web/app/(shell)/platform/audit/metrics/page.test.tsx` with mocked metric and capability data.
- Prove the page composes canonical report primitives and contains no raw hexadecimal presentation colors.
- Add `apps/web/app/(shell)/platform/audit/metrics/TopToolsTable.test.tsx` to prove tool names, counts, and token-backed success states render through `DataTable`.
- Run the two tests and capture the expected Red result before changing production code.

### AI Coworkers

- Add `apps/web/app/(shell)/workforce/page.test.tsx` with mocked roster/auth data and a thin `RosterView` test double.
- Prove the roster is rendered on arrival and that the page has no Browse-the-list link or disclosure control.
- Run the test and capture Red before changing the route.

### Canvas theme

- Add `apps/web/components/inventory/canvas-theme.test.ts` for concrete CSS-variable resolution, safe fallbacks, and alpha handling.
- Add `apps/web/components/inventory/RelationshipGraph.theme.test.tsx` with a Canvas2D harness proving light-theme label, focus-ring, and edge colors come from computed DPF tokens.
- Keep the existing focus-label and layout tests in the affected loop.
- Run the new theme tests and capture Red before adding the resolver.

## Phase 2: Make the minimum fixes green

### Operational Metrics

- Add a client-only `TopToolsTable.tsx` that accepts primitive rows and renders report-kit `DataTable` plus token-backed `StatusBadge` values.
- Replace hand-rolled KPI tiles with server-usable `StatCard` components.
- Replace the capability-sync callout with `Notice` and the recent error-rate strip with shared token-backed status presentation.
- Remove every raw hex color from the metrics route while preserving the existing data query, headings, empty state, and visible-word budget.

### AI Coworkers

- Remove `OwnerFirstDisclosure`, the redundant Browse link, and the stale source comment that describes the extra click as intentional.
- Render the existing `RosterView` immediately after the lead copy.
- Preserve query serialization, capability filtering, identity links, and the honest empty state.

### Relationship Graph

- Add `apps/web/components/inventory/canvas-theme.ts` to read active `--dpf-*` values from `getComputedStyle(canvas)` and return Canvas2D-safe concrete colors.
- Use `globalAlpha` for subdued edges and nodes; do not concatenate alpha suffixes onto CSS values.
- Repaint when the active theme/branding tokens change, without restarting cooled physics unnecessarily.

## Phase 3: Spend the bounded refactoring budget

- Move TopologyGraph's duplicated `prefers-color-scheme` palette into the shared canvas-theme resolver.
- Keep graph-domain colors and legends with their owners; centralize only CSS-theme-to-Canvas2D translation and alpha composition.
- Shrink `TopologyGraph.tsx` below its current ratchet while preserving zoom, pan, swimlanes, filters, and topology behavior.
- Keep this convergence work near 20% of the implementation effort and make no unrelated graph cleanup.

## Phase 4: Verification evidence

1. Run related-test discovery for each impacted production path and include every returned test in the loop.
2. Run targeted Vitest files for metrics, workforce, canvas theme, RelationshipGraph focus/layout/theme, and any related TopologyGraph tests.
3. Run `pnpm run check:prose-lint:test`, `pnpm run check:prose-lint`, and `node scripts/check-style-drift.mjs`.
4. Regenerate the doc index and any route-derived artifacts requested by the guard output; commit only changed generated files.
5. Record measured `docs/ux-fit/2026-08-25-portal-readability-and-coworker-directory.ux-fit.json` against the checked-in route-budget baseline.
6. Run source-local type/build checks required by the resolved impact contract.
7. Acquire the governed shared nonproduction lease and verify `/platform/audit/metrics`, `/workforce`, and `/admin/graph-explorer` in light and dark themes plus a narrow viewport.
8. Run `pnpm run pregate:preflight`, commit the exact tree with DCO sign-off, obtain independent semantic review, run `pnpm run pregate`, push, and run `pnpm pr:health` after opening the ready PR.

## Documentation impact

No route, data model, permission, prompt, or operator procedure changes. The committed design, this plan, and measured UX-fit evidence are the documentation for the presentation repair. Existing user documentation remains accurate.
