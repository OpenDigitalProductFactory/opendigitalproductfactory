# Workbooks Per-Surface Integration — Design

| Field | Value |
| ----- | ----- |
| Status | Draft — substrate-verified 2026-06-06 |
| Date | 2026-06-06 |
| Epic | EP-GRID-WORKBOOKS — Universal Grid & Workbooks |
| Live backlog | MCP 2026-06-06: BI-09D945C5 (feature, large — per-surface integration), BI-DFD98A2D (feature, medium — demote/relocate hub). Both `open`/`build`. |
| WWMD | `principle_decide` 2026-06-06 (external_coding_agent) → `in-place-view-toggle`, composite 11.80 vs 11.10 / 7.66, margin 0.70, high confidence, no commandment conflict |
| Operator direction | 2026-06-06: integrate the platform-data grids into each domain surface (not a standalone all-spreadsheets hub); demote the top-level Workbooks nav. AskUserQuestion → demoted hub lands **Under Platform Hub**. |

## 1. Problem

`/workbooks` is a top-level Workspace destination that presents everything as spreadsheets: a user-defined custom-tables section **plus** a "Platform data" section that lists Finance invoices, Compliance risk assessments, and Ops backlog items as grid cards linking to `/workbooks/system/[entityType]`.

Operator feedback: a standalone all-spreadsheets surface is the wrong home for the platform-data grids. The invoice grid belongs **in Finance**, the risk grid **in Compliance**, the backlog grid **in Ops** — revealed in the topic the worksheet is *for*, as integrated as possible. The top-level Workbooks entry is also too prominent for what (after the platform grids move out) is a personal power-user tool.

This is not a missing-capability problem. The grids exist and work. The gap is **placement and a consistent reveal pattern**.

## 2. Goals

1. Reveal each platform-data grid in its own domain surface, in the topic context, via one consistent pattern.
2. Make the pattern registry-driven so it's identical across surfaces and free for any future platform table.
3. Demote the standalone Workbooks: remove the top-level Workspace chip; relocate the user-tables hub under Platform Hub; the platform-data section leaves the hub.
4. Reuse the existing grid substrate; add no second grid implementation.
5. No hardcoded colors; report-kit / DPF theme tokens.

## 3. Verified Substrate

| Capability | Current substrate (verified 2026-06-06) | Design implication |
| --- | --- | --- |
| Platform-table registry | `apps/web/lib/workbooks/platform-tables.ts` — `PLATFORM_TABLES`: `{entityType,label,description,viewCapability,manageCapability}` for `invoice`, `risk_assessment`, `backlog_item`. | Extend with a `homeSurface` mapping; it becomes the integration seam. |
| Grid data fn | `getPlatformTableGridData(user, entityType)` returns schema+columns+rows+capabilities. | Call directly from each surface page — no new query code. |
| Grid components | `WorkbookGrid` / `KanbanBoard` (`apps/web/components/workbooks/`), parameterized by `source`/`tableId`/`columns`/`rows`/`capabilities`. | Embed in surface pages. The `/workbooks/system/[entityType]` page is already just a thin wrapper around these. |
| Grid/Board toggle | The system page already implements a Grid↔Board switch via `?view=board` + `defaultGroupByColumn`. | Generalize into a shared `<SurfaceViewSwitcher>`. |
| Surface targets | `/finance/invoices/page.tsx`, `/compliance/risks/page.tsx`, `/ops/page.tsx` all exist as server components with native list views + searchParams. | Add the switcher to each; native view is the default. |
| Workspace nav | `portal-navigation-model.ts` key `workbooks`, section `workspace`, `primaryOrder: 15`. | Remove the primary chip (drop `shellNav`+`primaryOrder`). |
| Platform Hub nav | `apps/web/components/platform/platform-nav.ts` (`PLATFORM_FAMILIES`). | Add a Workbooks subitem under the Overview family. |
| Capability gating | each platform table gates on its **domain** capability (`view_finance`/`view_compliance`/`view_operations`). | Per-surface grids are already correctly gated — no change. |

## 4. Decision (WWMD)

`principle_decide` (external_coding_agent, `mark-dpf-platform`, 20 commandments, strong structured coverage):

| Option | Composite | Verdict |
| --- | --- | --- |
| **in-place-view-toggle** | **11.80** | **Recommended — high confidence, margin 0.70** |
| dedicated-grid-subroute | 11.10 | Viable runner-up |
| crosslink-keep-hub | 7.66 | Rejected |

Top contributors: Research & Use Standards (0.91), No Hardcoded Colors (0.92), Single Source of Truth (0.83), Ship Real Functionality (0.75). No commandment conflict.

- **`in-place-view-toggle`** keeps the user in the topic — the spreadsheet is a *view mode* of the same page — which is exactly "as integrated in the topic as possible." Highest reuse and lowest cognitive load.
- **`dedicated-grid-subroute`** scored close but adds a navigation hop and a sub-route per surface; kept as the fallback if a surface can't host an in-place mode cleanly.
- **`crosslink-keep-hub`** is the "here, not there" the operator explicitly rejected; lowest on Proper-Fix and maintainability.

## 5. Design

### 5.1 The consistent reveal pattern

Extend the registry with a `homeSurface` per entity (`{ path, label, board }`) and embed, on each surface page, a shared pair of server components:

- **`SurfaceViewSwitcher`** — a segmented control **List · Grid · Board** that mirrors the existing system-page toggle styling, links to `?view=grid|board`, and only offers Board when the registry marks the table groupable. Drop-in above the surface content.
- **`SurfacePlatformGrid`** — fetches `getPlatformTableGridData(user, entityType)` and renders `WorkbookGrid` (or `KanbanBoard` for `view=board`, via `defaultGroupByColumn`). Rendered only when `?view` is set.

Each surface page adds two lines: render the switcher, and when `?view` is set render `SurfacePlatformGrid` instead of its native list (List remains the default — no regression). Because both read the registry, **every current and future platform table gets the identical affordance for free** — that is the "consistent" mechanism.

Targets: `invoice`→`/finance/invoices`, `risk_assessment`→`/compliance/risks`, `backlog_item`→`/ops`.

### 5.2 Nav demotion (→ Platform Hub)

- Remove the `workbooks` **primary** chip from the Workspace section (`portal-navigation-model.ts`: drop `primaryOrder` + `shellNav`; the route record stays so links still resolve).
- Add a Workbooks subitem under **Platform Hub** (`platform-nav.ts`, Overview family). The user-defined custom-tables hub lives here as power-user tooling.
- Strip the "Platform data" section from `apps/web/app/(shell)/workbooks/page.tsx` — those grids now live on the surfaces.
- Point the `/workbooks/system/[entityType]` back-link at the registry `homeSurface` so a grid reached from a surface returns to that surface.

### 5.3 What stays

The `/workbooks/system/[entityType]` route and the user-defined workbook routes remain functional (deep-links, MCP, shares). Additive placement + a nav move, not a teardown of the grid engine.

## 6. Decomposition

| BI | Size | Scope |
| --- | --- | --- |
| BI-09D945C5 | large | Registry `homeSurface`, `SurfaceViewSwitcher` + `SurfacePlatformGrid`, integration into the three surfaces. |
| BI-DFD98A2D | medium | Remove the Workspace chip, add the hub under Platform Hub, strip the hub's Platform-data section, fix the system-grid back-link. |

Both ship together here (the demotion must not strip the hub's platform-data section until the per-surface grids are live).

## 7. Research & Benchmarking

- **Airtable / Notion / Smartsheet** — a dataset has one home; grid/board/calendar are *view modes* of that dataset via an in-context switcher, never a separate destination per view. Adopted: view-mode toggle in place.
- **Linear / Jira** — the same issue list toggles list↔board in place via a header control; users stay in project context. This is the `SurfaceViewSwitcher` model.
- **Salesforce / ServiceNow** — records appear as grids *within* their object/module, gated by that module's permissions — matching DPF's per-table domain-capability gating.
- **DPF precedent** — EP-ARCH-NAV (2026-06-06): a cross-cutting capability surfaced as a view within each topic rather than a standalone destination. Same doctrine, reused for grids.

## 8. UX Fit

Decision: `fits-with-guardrails`.

- Owning areas: Finance, Compliance, Ops (grid views) + Platform Hub (demoted hub). No new top-level nav; one chip removed.
- Reuse: `getPlatformTableGridData`, `WorkbookGrid`/`KanbanBoard`, existing toggle markup; two new shared server components.
- Default view per surface unchanged (native list); Grid/Board are opt-in → no regression.
- Theme: tokens only.

## 9. Verification

- **Unit:** registry `homeSurface` resolution; switcher renders List/Grid/Board (Board gated on registry flag); nav model — `workbooks` no longer a primary/shell entry, present under Platform Hub; nav invariants (unique path, sectionSiblings ⊂ parentPath, every shell + platform-family href resolves).
- **Typecheck / Build:** `pnpm --filter web typecheck` + `build` (CI / canonical install / shared sandbox).
- **Functional (live install):** the switcher toggles native↔Grid↔Board in place on each surface; grid edits persist to the same records; the Workspace chip is gone; the hub is under Platform Hub showing only user tables; deep-links still work and breadcrumb to the home surface.
- **UX:** desktop + mobile; no hardcoded colors; honest empty states.

## 10. Risks

- **Surface page heterogeneity** — switcher is additive (native list default); fall back to `dedicated-grid-subroute` for any surface that can't host an in-place mode.
- **Capability widening** — keep each grid gated by the registry's existing domain capability; no widening.
- **Hub link rot** — sweep internal `/workbooks` links when relocating; the system back-link derives from the registry.
- **Ordering** — don't strip the hub's Platform-data section until per-surface grids are live (same PR keeps them coupled).
- **Runtime-bound verification** — worktree is source-control only; build + UX evidence from CI / canonical install / shared sandbox.

## 11. Amendment — 2026-08-05 (BI-00CB9CCC)

Two clauses of this design are superseded by operator review of `/employee`.

### 11.1 The "Grid tab" fallback is retired

The rollout plan carved out an exception for tabbed pages whose `?view=` param was
already taken (people): add a sibling **Grid tab** instead of the in-place toggle.
Operator verdict on the result: *"the grid view is in its own tab, vs being part of
the main workforce list. Seems unorthodox."*

That is precisely the "here, not there" outcome §4 scored lowest. The exception was
never a UX judgement — it was a query-param workaround, and the collision does not
actually need dodging: `grid`/`board` are simply not tab values, so a tab-nav can
resolve them to its list tab and one `?view=` param serves both roles. **§5.1's
in-place toggle is now the pattern for every surface, tabbed or not.**

### 11.2 A grid over a governed model writes through its domain action

§3 recorded that per-surface grids inherit the registry's domain capability and need
no change. That holds for *reads*. For *writes* it is not sufficient: the generic
adapter's raw-write tier goes straight to Prisma, and `EmployeeProfile` writes are
otherwise wrapped in `withGovernedWorkforceAction`, which lands an
`AuthorizationDecisionLog`. A raw grid write would have edited people's records with
no audit trail.

`GenericTableConfig` therefore gains an optional **`writeThrough`** hook. When set,
a validated edit is handed to the domain action instead of Prisma, so the grid
inherits the capability check, governance resolution, and audit entry. The raw-write
tier remains the default for models with no domain action of their own (supplier).

Corollaries now in force:
- `employee_profile.manageCapability` is `manage_user_lifecycle`, not `view_employee` —
  seeing the directory is not permission to edit it.
- Fields carrying domain rules a cell edit cannot express stay off the allow-list.
  `status` is excluded: it is a lifecycle transition guarded by
  `validateLifecycleTransition`, not a cell value.
