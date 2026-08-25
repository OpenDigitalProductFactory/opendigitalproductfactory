---
status: binding
---

# Portal readability and coworker-directory repair

**Backlog item:** `BI-6DBD3AB4`  
**Workroom:** `WC-2BD67603`  
**Status:** Design ready for implementation planning

## Outcome

Repair three operator-visible regressions without adding a new visual dialect:

- **OBJ-METRICS-READABILITY:** `/platform/audit/metrics` remains readable in light and dark themes.
- **OBJ-COWORKER-DIRECTORY:** `/workforce` exposes its primary directory immediately, without an expand step.
- **OBJ-GRAPH-READABILITY:** `/admin/graph-explorer` renders legible canvas labels and relationships in the active theme.

The repair keeps the existing data sources, routes, and interaction contracts. It changes presentation and disclosure only.

## Demand and reproduction evidence

The operator supplied three screenshots from the development install. They are linked to the BI as governed demand evidence:

- `DME-789D859F4163`: on `/platform/audit/metrics`, light-theme Top Tools rows have a near-black background while tool names and counts inherit dark text. Expected: every row value remains readable in both themes.
- `DME-58E718CC1425`: on `/workforce`, the page's only useful task is behind Browse the list followed by a closed All coworkers disclosure. Expected: search and roster are usable on arrival.
- `DME-A10E107E545A`: on `/admin/graph-explorer`, labels and edges are nearly white on a white canvas. Expected: graph structure and labels remain legible in both themes.

Dark-theme browser inspection of the metrics route measured a valid dark-row contrast, which isolates the defect to theme mismatch rather than missing data. The screenshot and DOM data both show that tool names and counts exist.

## Source research

### Metrics

`apps/web/app/(shell)/platform/audit/metrics/page.tsx` hand-rolls reporting UI. Its Top Tools rows hard-code `background: "#1a1a2e"` while the foreground uses `var(--dpf-text)`. The light theme defines `--dpf-text` as the same dark family, producing dark-on-dark content. The route also hard-codes card and status accents even though `StatCard`, `DataTable`, `StatusBadge`, and `Notice` already exist in report-kit.

### AI coworker directory

`apps/web/app/(shell)/workforce/page.tsx` wraps the sole `RosterView` in a closed `OwnerFirstDisclosure`. The source comment calls this intentional progressive disclosure, but the disclosure hides primary content rather than secondary complexity. Browse the list does not complete the task; it merely moves focus to another control that must be opened.

### Graph Explorer

`apps/web/components/inventory/RelationshipGraph.tsx`, shared by inventory and Graph Explorer, hard-codes dark-canvas fallbacks for edges, focus rings, and labels, including white label/focus colors. It also appends alpha text to legend colors, although legend colors may be CSS custom-property expressions that Canvas2D cannot resolve itself.

`apps/web/components/inventory/TopologyGraph.tsx` already contains canvas palette logic, but it derives theme from `prefers-color-scheme` and carries its own hard-coded palette. The reusable seam is a small canvas-theme resolver that reads computed DPF CSS variables from the actual canvas and supplies Canvas2D-safe color strings.

## Standards and substrate fit

- `docs/platform-usability-standards.md`: use theme tokens and reserve progressive disclosure for complexity that is not the primary task.
- `docs/superpowers/plans/2026-05-26-portal-ux-simplification-spine.md`: reduce operations-to-outcome and first-viewport cognitive load.
- `apps/web/components/ui/report-kit/README.md`: reporting surfaces compose shared stat, table, status, and notice primitives.
- Kernel: `no-hardcoded-colors`, `compose-report-kit-for-reporting-ux`, `single-source-of-truth`, and `preserve-the-model-disclose-complexity-progressively`.

No model, API, route, enum, permission, or new UI framework is required. The canonical substrate already exists: report-kit for metrics, `RosterView` for the directory, and DPF CSS variables for theme state.

## UX fit review

- **Decision:** fits-with-guardrails.
- **Owning areas:** Platform for metrics and Graph Explorer; Business for AI Coworkers.
- **Primary persona:** an operator scanning system health or opening a coworker.
- **Navigation:** no global or section navigation changes.
- **Reuse/convergence:** report-kit, the existing roster, and one shared canvas-theme resolver.
- **Source truth:** `getToolExecutionMetrics`, `loadRoster`, and existing graph actions remain authoritative.
- **Empty/failure states:** retain the current honest empty states; use report-kit Notice where applicable.
- **AI boundary:** no prompt is sent and no coworker action semantics change.
- **Evidence:** focused regression tests, theme scan, measured UX-fit manifest, and browser verification at desktop and narrow viewport.

The kernel comparison `DI-32EFBD2643CA` returned insufficient structured signal because no scoreable feature map was available. The operator's explicit judgment and the measured operations-to-outcome decide the disclosure question: render `RosterView` directly. Keeping a default-open disclosure retains a meaningless collapse control; keeping it closed preserves the reported defect.

## Design

### 1. Converge Operational Metrics on report-kit

- Replace hand-rolled stat tiles with `StatCard` and semantic intents.
- Render the capability-sync warning and recent error-rate summary with theme-safe shared primitives.
- Move Top Tools into a small client table wrapper backed by `DataTable`; use `StatusBadge` or token-backed text for success-rate intent.
- Keep the server page responsible for fetching and serializing metrics.
- Add a regression test that rejects raw hex styling and asserts the shared primitives/table output.

### 2. Make the roster the page's primary content

- Remove `OwnerFirstDisclosure` and the redundant Browse the list anchor.
- Render `RosterView` directly after concise lead copy.
- Preserve search query serialization, capability filtering, identity links, and empty-state behavior.
- Add a route/component regression test proving the roster is present without a details/disclosure control.

### 3. Resolve canvas colors from the active theme

- Add a shared inventory canvas-theme helper that resolves CSS custom properties through `getComputedStyle(canvas)` and returns Canvas2D-safe text, muted-text, border, surface, and focus colors.
- Use `globalAlpha` for translucent links instead of string-concatenating alpha onto arbitrary CSS color syntax.
- Apply the helper to `RelationshipGraph`; converge `TopologyGraph` where its palette overlaps so two canvases do not drift independently.
- Repaint on active theme changes, not only on initial OS preference.
- Add pure helper tests plus canvas draw assertions for light and dark token fixtures.

### Refactoring budget

Roughly 20% of the implementation is reserved for convergence work rather than symptom-only edits: extracting the shared Canvas2D theme resolver, removing duplicated canvas theme derivation, and replacing the metrics route's local report widgets with report-kit. This refactor is bounded by the three reported surfaces and introduces no unrelated cleanup.

## Risks and rollback

- A client `DataTable` wrapper adds a server-to-client serialization boundary. Keep its row type primitive-only and test rendering.
- Canvas theme observation can cause unnecessary redraws. Observe only actual theme attributes/media changes, cancel listeners on unmount, and retain the existing cooled simulation behavior.
- Showing the full roster increases first-viewport content, but it removes two operations from the primary outcome and exposes existing filters immediately. UX-budget evidence must confirm no new buried action or control-density regression.
- Rollback is a normal revert of the UI commit; no data migration or stored state changes are involved.

## Acceptance and verification

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-REGRESSION-TESTS | OBJ-METRICS-READABILITY, OBJ-COWORKER-DIRECTORY, OBJ-GRAPH-READABILITY | First-failing tests reproduce all three regressions, then targeted tests pass after the fixes and convergence refactoring. |
| AC-THEME-SAFETY | OBJ-METRICS-READABILITY, OBJ-GRAPH-READABILITY | No raw hex color is introduced in the changed UI paths, metrics hard-coded presentation colors are removed, and browser verification covers both themes. |
| AC-DIRECT-ROSTER | OBJ-COWORKER-DIRECTORY | The coworker search, filters, and roster are usable on arrival without a details or disclosure control, including at a narrow viewport. |
| AC-QUALITY-GATES | OBJ-METRICS-READABILITY, OBJ-COWORKER-DIRECTORY, OBJ-GRAPH-READABILITY | Source-local checks, the measured UX-fit manifest, exact-tree semantic review, local-CI evidence, DCO sign-off, and a ready-for-review PR all pass. |

## Architecture review

**Alignment summary:** well aligned with the existing presentation substrate.

- No schema or source-of-truth change is proposed.
- Reporting convergence removes a bespoke dialect instead of adding one.
- The canvas helper centralizes only theme-to-Canvas2D translation; domain legends and graph data remain local to their owners.
- Scale characteristics are unchanged: graph caps, force simulation, metrics query bounds, and roster loading are outside this presentation repair. The existing graph scale ceiling remains the current route cap; lifting it belongs to its existing graph/inventory roadmap rather than this BI.

No advisory finding requires a new substrate or separate delivery item.
