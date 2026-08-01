# Interactive Org Chart — Design

- **Date:** 2026-07-30
- **Backlog item:** BI-HCM-004 — Organization chart, manager scope, and approval routing
- **Status:** implemented (first slice)
- **Surface:** `/employee?view=orgchart` (People > Org Chart)
- **UX-fit evidence:** `docs/ux-fit/2026-07-30-employee-org-chart-interactive.ux-fit.json`
  (`DI-579CD2259A6F`)

## Problem

The operator's report: *"I see the org chart, but it doesn't really look like a chart, it's a list.
Also, the role governance and access is not changeable. Seems not too useful."*

Both observations were accurate, and the second was broader than reported.

### It was a list because it was coded as a list

`OrgChartView` rendered `<div>` rows with `marginLeft: depth * 24px`. There was no layout, no
connectors, no pan/zoom. Dotted-line managers were rendered as an italic text label rather than a
second edge, so the one genuinely graph-shaped relationship in the data was flattened away.

### Nothing on the page could change the organization

- `assignEmployeeOrg` (`apps/web/lib/actions/workforce.ts`) is a complete governed mutation —
  medium risk band, actor-audited, writes `manager_changed` / `department_changed` /
  `position_changed` employment events. **It had zero UI callers anywhere in `apps/web`.**
- `OrgAssignmentPanel` is a server component with no form: it displayed the current placement and
  then listed the reference sets as decoration.
- The Role governance block was static cards, ordered read-only-first, and each card showed a bare
  headcount — so "who can do what" was unanswerable.
- The one editable control (`HrUserLifecyclePanel`, user→role assignment) sat inside a collapsed
  disclosure, below the fold, and was dropped entirely in simple nav mode.

The page was a viewer for data the platform could already govern and edit but never exposed. The
visual complaint was downstream of that.

## Two latent defects found while modelling the structure

1. **Cycle members vanished.** `buildTree` treated "has a manager inside the set" as
   not-a-root. In a cycle (A reports to B, B reports to A) *neither* is a root, so both — and
   everyone beneath them — silently disappeared from the chart with no warning.
2. **Nothing prevented creating a cycle.** `assignEmployeeOrg` blocked only self-management
   (`managerEmployeeId === employeeProfileId`). Two legal single-hop edits could still detach a
   whole branch from every root, at which point no accountable manager can be resolved for
   approvals — the exact capability BI-HCM-004 exists to deliver.

## Options considered

Scored with `principle_decide` (`DI-579CD2259A6F`, high confidence, margin 3.85):

| Option | Outcome |
| --- | --- |
| `interactive-chart-governed-reassign` | **Chosen.** Real chart + governed reassignment + insight overlays. |
| `chart-rendering-only-read-only` | Fixes the visual complaint only; the surface stays a viewer. |
| `reuse-assign-employee-org-directly` | Rejected — see below. The kernel independently ranked it last. |

The third option is the interesting rejection. Reusing `assignEmployeeOrg` for a manager-only edit
looks like the convergent choice, but that action rewrites department, position, work location, and
timezone from its input, and `trimOptional(undefined)` returns `null`. A drag-to-reassign wired to
it would silently clear four unrelated fields on every drop.

## Design

### Reuse, not new substrate

Rendering uses `@xyflow/react` and `dagre`, both already platform dependencies already used by
`EaCanvas`, `ProcessGraph`, and `CartesianSceneCanvas`. No layout or graph library was added.

`computeOrgChartLayout` (`apps/web/lib/graph/layout-org-chart.ts`) is a sibling of the existing
`layout-hierarchical.ts` rather than an extension of it, because `computeHierarchicalLayout` is
bound to `GraphData` — a network/CI shape carrying `color`, `size`, and `osiLayer` — which does not
describe a workforce.

Status colour resolves through report-kit's intent registry via a new `workforceStatus` domain in
`statusColors.ts`. The previous implementation hardcoded `bg-green-500` / `bg-amber-400`, which
ignored theming and branding (AGENTS.md §12).

### Pure model, testable without React

`apps/web/lib/workforce/org-chart-model.ts` holds the reporting-structure maths — edges, per-person
metrics, roots, cycle members, eligible managers, and `wouldCreateManagerCycle`. It is structural
over `OrgReportingRow` (`{ id, managerEmployeeId, dottedLineManagerId? }`) rather than bound to
`EmployeeDirectoryRow`, so the server action can run the cycle guard from a two-column Prisma select
instead of loading the full directory.

### Reassignment is governed, and narrow

New action `reassignEmployeeManager` uses the same `withGovernedWorkforceAction` wrapper, risk band,
and `manager_changed` employment event as `assignEmployeeOrg`, but touches only the reporting line —
avoiding the collateral-nulling hazard above. Only the solid line writes an employment event; a
dotted line is advisory.

The cycle guard is applied in three places, deliberately:

- the **picker**, which never offers an illegal manager (`eligibleManagers`);
- the **drag handler**, for immediate feedback with a named reason;
- the **action**, which is the actual guarantee — the UI checks are for feedback only.

`assignEmployeeOrg` also gained the guard, since it remains a manager-writing path.

### Interaction decisions worth keeping

- **Filters dim rather than remove.** Removing filtered people would leave reporting lines that
  appear to re-parent someone onto a grandparent. Dimming keeps the true structure visible.
- **Dotted lines do not affect ranking.** They are advisory; ranking on them drags people out of
  their real management layer.
- **A drop on empty canvas snaps back.** It does not detach the person — an accidental drag must not
  silently remove a reporting line.
- **The dialog is awaited outside `startTransition`.** A dialog helper called inside a transition
  never renders interactively and wedges the control (AGENTS.md §12).
- **The list survives as a density toggle.** It is genuinely better for scanning a large workforce;
  the defect was that it was the *only* mode, not that it existed.

### Permission

The page resolves `manage_user_lifecycle` and passes `canReassign`; without it the chart renders
read-only with disabled pickers rather than offering controls that would fail server-side.

## Governance block

Within the existing progressive disclosure, the actionable half now leads: the access control first,
then role definitions labelled read-only, each naming its holders (derived from the users already
loaded — no extra query) and flagging any role nobody holds.

Role *definitions* remain read-only: no action in the codebase mutates `PlatformRole`, and adding
one is new substrate warranting its own risk-band decision and admin-scope check. That gap is
recorded as follow-up rather than smuggled into this change.

## Addendum — 2026-07-31: placement editing, and the hazard fixed at source

The first slice routed *around* `assignEmployeeOrg` rather than repairing it, which left
department, position, and work location uneditable anywhere in the portal — the same defect
this spec was written to fix, one field over. `assignEmployeeOrg` still had zero callers.

`assignEmployeeOrg` now has **PATCH semantics**: an absent key means "leave this field alone",
an explicit `null` or `""` means "clear it". The distinguishing logic lives in
`apps/web/lib/workforce/patch-optional.ts` — outside the `"use server"` action module, which
may only export async functions, so a sync helper could not be exported from it for testing.

That removes the hazard at its source instead of asking every caller to defend against it. The
org chart's detail panel now carries Team, Role, and Location pickers, each sending exactly one
field.

Scored at `DI-85C62D7D17CE` against a modal alternative and against keeping the
rewrite-everything action and passing all current values from the client. The kernel ranked
that last option last, for the same reason it ranked the equivalent option last in the original
decision: a client that must remember to resend four unrelated fields will eventually forget.

`reassignEmployeeManager` stays. It is still the right shape for drag-to-reassign — one field,
one employment event, one cycle check — and it is what the drag handler calls.

## Not in this slice

BI-HCM-004 also covers approval routing and delegated approval driven by the org service. This slice
delivers the trustworthy chart and the reporting-line service beneath it — the prerequisite — plus
the cycle invariant that approval routing depends on. Editing role definitions is a separate change.

## Verification

- `apps/web/lib/workforce/org-chart-model.test.ts` — 18 tests, including regressions for both
  latent defects.
- `apps/web/lib/graph/layout-org-chart.test.ts` — 8 tests covering ranking, peers, dotted-edge
  exclusion, and the centre-point→top-left origin conversion.
- Affected suites: 38 files / 236 tests green.
