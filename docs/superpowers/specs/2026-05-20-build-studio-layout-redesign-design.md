# Build Studio Layout Redesign — Design Spec

**Depends on:** Existing Build Studio surfaces (`apps/web/components/build/BuildStudio.tsx`, `ProcessGraph.tsx`, `PhaseIndicator.tsx`, `BuildListItem.tsx`, `BuildStudioWorkflowActionCard.tsx`, `PreviewUrlCard.tsx`, `BuildProgressOperationalPanel.tsx`, `BuildSandboxCard.tsx`, `FeatureBriefPanel.tsx`, `ReviewPanel.tsx`, `TaskInspector.tsx`, `WorkflowStageInspector.tsx`) and their callers in `apps/web/app/(shell)/build/page.tsx`. No new data-model changes - this is a UI architecture and component-boundary refactor.

**Related live records:** DPF MCP timed out during chief-architect review, so the record check used live Postgres DB fallback. As of 2026-05-21 01:48 UTC, FeatureBuild `FB-B33E84B5` is in `ideate` and has `designDoc`, `buildPlan`, `designReview`, and `planReview` present. The backlog item is the separate row titled "Build Studio layout redesign: workflow as primary canvas, anchored step inspectors, compact fleet view, shared sandbox surface", status `in-progress`, under the open epic "Build Studio UX Redesign - workflow-primary canvas, anchored inspectors, compact fleet". Do not call `FB-B33E84B5` a BI; it is the feature-build identifier.

**Origin note:** This artifact preserves the design intent that the live Build Studio coworker drafted (`[tool-trace] hasDesignDoc=true, docKeys=problemStatement,dataModel,existingFunctionalityAudit,proposedApproach,reusePlan,acceptanceCriteria,accessibility,reusabilityAnalysis`) but could not commit through `saveBuildEvidence` during the portal self-upgrade + MCP-unreachable cascade (`project_self_upgrade_kills_in_session_ux`).

## Chief Architect Review Summary

The direction is right: the workflow graph should become the operating surface, not a secondary tab. The original draft still needed four architecture corrections before implementation:

1. **Converge existing inspectors instead of adding a third inspector concept.** Current repo truth already has `TaskInspector.tsx` and `WorkflowStageInspector.tsx`, both opened from `ProcessGraph.tsx` as fixed right-side overlays. This redesign must refactor them into one anchored `WorkflowNodeInspector` family rather than introducing a parallel `NodeInspector` and leaving the old panels behind.
2. **Preserve the single-status command spine.** `BuildStudioWorkflowActionCard` and `BuildProgressOperationalPanel` were recently split into command versus evidence surfaces. The redesign must keep that invariant: one action/status banner, with progress, sandbox, dispatch, and verification signals below it as evidence.
3. **Make theme and accessibility non-negotiable implementation gates.** The graph currently contains legacy hex colors and fixed overlays. The new work must use DPF CSS variables, React Flow accessibility hooks, keyboard verification, and color-independent status marks.
4. **Reserve implementation capacity for refactoring.** At least 20% of the implementation budget is for component consolidation, layout helper cleanup, test seams, and deleting obsolete tab/preview/phase-strip code. This is not optional polish; without it the redesign will add complexity while pretending to simplify the UI.

## Research & Benchmarking

The redesign follows established workflow-observability patterns rather than inventing a dashboard from taste alone:

- **GitHub Actions** exposes a real-time visualization graph plus per-job logs and status for each step. Adopt: graph-first monitoring with drill-in logs/evidence, not a detached progress card. Reject: hiding the graph behind tabs. Source: [GitHub Docs - Monitor workflows](https://docs.github.com/en/actions/how-tos/monitor-workflows?tool=webui).
- **GitLab CI/CD** separates full dependency graphs from compact mini graphs; mini graphs are optimized for at-a-glance failure detection while full graphs expose dependencies and retry/cancel actions. Adopt: compact fleet rail for many builds, full workflow canvas for one active build. Source: [GitLab Docs - CI/CD pipelines](https://docs.gitlab.com/ci/pipelines/) and [CI/CD jobs](https://docs.gitlab.com/ci/jobs/).
- **Argo CD** keeps sync/health as status projections over real resources instead of making users infer state from logs. Adopt: preserve projection-backed `Build Status`, source-currency age, sandbox, dispatch, and verification evidence as explicit truth surfaces. Source: [Argo CD Resource Health](https://argo-cd.readthedocs.io/en/release-3.1/operator-manual/health/).
- **React Flow** already provides focusable nodes/edges, keyboard selection, ARIA configuration, automatic panning on node focus, and WCAG-oriented guidance. Adopt: use React Flow's built-in accessibility model and `ariaRole`/`domAttributes`; avoid a blanket `role="application"` unless the graph fully owns keyboard behavior. Source: [React Flow Accessibility](https://reactflow.dev/learn/advanced-use/accessibility).
- **n8n executions** preserve execution metadata such as status, timing, and node names even when sensitive execution data is redacted. Adopt: DetailsDrawer can show metadata first and defer raw logs/diffs behind explicit expansion; do not expose internal tool-call payloads by default. Source: [n8n Docs - Executions](https://docs.n8n.io/workflows/executions/).

## Goal

Make the workflow graph the prominent visible core context of each in-flight build, eliminate the three-way phase redundancy (PhaseIndicator strip + ProcessGraph + header pill), surface multiple concurrent builds in aggregate without losing detail, and stop pretending each build has its own preview when all share one sandbox.

## Architecture

Three-zone shell with the workflow graph as the canvas and everything else docking around it or anchored inside it.

```
┌──────────┬─────────────────────────────────────────────┬───────────┐
│ FLEET    │  ACTIVE BUILD                               │ COWORKER  │
│ (compact │  ┌──────────────────────────────────────┐   │ (stays    │
│  rail,   │  │ 40px pinned ActionBanner             │   │  put,     │
│  one-    │  │ one sentence + primary action        │   │  width    │
│  line    │  └──────────────────────────────────────┘   │  un-      │
│  per     │                                             │  changed) │
│  build)  │  ┌─ WORKFLOW (primary, full pane) ──────┐   │           │
│          │  │   ●→●→●→[●]→○→○                      │   │           │
│          │  │         │                            │   │           │
│          │  │     ┌───┴────────┐  ← Inspector      │   │           │
│          │  │     │ Step detail│    anchored to    │   │           │
│          │  │     │ + actions  │    clicked node,  │   │           │
│          │  │     └────────────┘    smart position │   │           │
│          │  └──────────────────────────────────────┘   │           │
└──────────┴─────────────────────────────────────────────┴───────────┘
              [Open sandbox] — single shared surface, labeled
              with currently-driving build
```

**Workflow-as-canvas principle:** the ProcessGraph is the primary surface of the active build. Everything docks around it or anchors inside it. No surface ever covers the graph except a deliberate user-initiated expand.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Phase progression rendering | Once per surface — fleet mini-rail (aggregate) + ProcessGraph (active detail). Drop `PhaseIndicator` strip. Drop "Workflow:" header pill. | Three duplicate surfaces today. Mini-rail handles "many at a glance", ProcessGraph handles "one in depth". |
| Active build content slot | No global tabs. Workflow graph is always visible; clicking a node opens an anchored `WorkflowNodeInspector` inside the graph region. | User explicitly asked: "I would like to see it right there" (at the node). Today's `progress/topology/preview/docs` tabs hide each other. |
| Inspector implementation | Refactor existing `TaskInspector` + `WorkflowStageInspector` into an anchored `WorkflowNodeInspector` family. Delete the fixed right-overlay behavior when the anchored inspector is complete. | Current repo already has two inspector surfaces opened by `ProcessGraph`; adding a third would compound the layout problem. |
| Step detail position | Anchored popover inside the workflow region, never the coworker rail. Auto-flips above/below/left/right based on space and React Flow viewport transforms. | User explicitly corrected the earlier draft that displaced the coworker panel. |
| Removed-tab content (Progress, Details, Docs) | Migrated into a new `DetailsDrawer` component reachable in <=2 clicks (open via expand handle on the inspector or a thin tab strip on the right edge of the workflow region). | Reviewer correctly flagged: removing tabs without a migration path risks regressions. |
| Sandbox preview | Single shared `OpenSandboxButton` footer action labeled with currently-driving build. Drop the per-build Preview tab. | Per `project_self_upgrade_kills_in_session_ux`, all builds share the sandbox — per-build preview is dishonest. |
| Build list item density | One line, <=32px height. `code · phase mini-rail · claim badge · attention dot`. | Today's 3-line items waste horizontal space the graph needs. |
| Fleet rail width | ~150–180px (down from ~430px today). | Reclaims the room the workflow needs to be the prominent core context. |
| AI Coworker panel | Unchanged width, position, and content. | User explicitly out-of-scope. |
| Status and action authority | Keep `BuildStudioWorkflowActionCard` semantics as the single command/status source, rendered as a compact `ActionBanner`. Keep `BuildProgressOperationalPanel` content as evidence in the drawer. | Preserves the 2026-05-19 single-status command-spine fix and prevents a new split-brain status surface. |
| Refactor budget | 20% minimum. Deletes obsolete tab state, fixed inspectors, duplicate phase indicators, and preview-tab code after replacements are wired. | The point is a simpler operating surface, not a new layer sitting on top of the old one. |
| Queue surface (concurrency cap) | The fleet rail and each `BuildListItem` must visibly reflect each build's **queue state** (running / queued@N / blocked / idle). A platform-wide queue indicator lives in the fleet rail header showing the concurrency cap and how many slots are taken. | DPF Build Studio enforces a concurrency cap on coworker-driven feature builds (Mark, 2026-05-21: "concurrency issue with BS, separate thread working on that"). Without visual queue state the operator cannot tell whether an in-flight build is silent because it's working, blocked, or waiting in queue. |

---

## Section 1: Zone Layout

### Left — Fleet Rail (`BuildListItem` compressed)

- One row per in-flight build. Max height 32px. Truncates by code length, not by phase.
- Current repo truth: `BuildListItem.tsx` is a comfortable card (`min-h-[88px]`, `max-h-[128px]`) with title, build id, originator chip, phase, updated date, lifecycle label, product metadata, and delete affordance. T2 must introduce a compact density without breaking any caller that still needs the comfortable card.
- Row contents, left-to-right: `FB-CODE` (mono), 5-dot phase mini-rail, claim avatar/badge, attention dot (red when "needs you").
- Phase mini-rail = 5 SVG circles for `ideate → plan → build → review → ship`. Each circle gets `aria-label="{phase}: {reached|active|pending}"`, wrapper `role="img"`. Shape (filled vs. outline) carries reached/pending in addition to color — color must not be the sole conveyor (WCAG 1.4.1).
- Attention dot: shape + color (red dot with concentric ring) so it carries to color-blind users.
- Active build row uses left-border accent (4px), `aria-current="true"`, and bumped background; not just color.
- Delete remains reachable but is visually secondary. At 32px density it should be an icon button shown on hover/focus, not permanent text or a large trailing column.
- **Queue state badge** sits between the claim badge and the attention dot. Values: `running` (filled play glyph), `queued@N` (numbered hourglass; N is the queue position, 1-indexed), `blocked` (paused glyph), `idle` (no badge). The badge carries both shape and color so color is not the sole conveyor (WCAG 1.4.1). On hover/focus it surfaces a tooltip with the reason (`"Waiting on 2 builds ahead"`, `"Blocked: review failed — Refine the plan"`, `"Running step 4 of 8 — Generate code"`).
- **Fleet rail header** shows a compact platform-wide indicator: `Builds: {running}/{cap} · {queuedCount} queued`. Clicking it opens the DetailsDrawer scrolled to the BS Queue section (§5). The indicator uses a `role="status"` live region so a queue-cap change is announced.
- The fleet rail sort order is: running → blocked → queued (by position) → idle. The user can override sort via the header menu, but queue-aware order is the default so the operator's eye lands on what needs attention.

### Center — Active Build

- 40px pinned **ActionBanner** at top: one sentence describing current state + the single primary action button. It is a compact rendering of the existing workflow-action derivation, not a new status model.
- Subtext only when blocked (review-failed, awaiting decision); otherwise just the sentence.
- Below the banner, the **WorkflowCanvas** fills 100% of the remaining height. No second toolbar, no global tabs.
- The `WorkflowNodeInspector` (§2) is the only thing that overlays the canvas, and only on user click.
- A thin **DetailsDrawer** tab sits on the right edge of the canvas (24px wide vertical pill). Clicking it opens the drawer (§5).
- `ProcessGraph.tsx` already owns graph normalization and relay state (`normalizeBuildSnapshot`, active task titles, `progressVisibility`). The redesign should keep that data seam and change layout/interaction, not move graph derivation back into `BuildStudio.tsx`.

### Right — AI Coworker (unchanged)

- No content or layout changes. Width sticky.
- The `WorkflowNodeInspector` provides "Ask coworker about this step" which prefills the coworker input — no panel swap, no displacement.

### Footer — Shared Sandbox

- A single `OpenSandboxButton` lives in the page footer. Label: `Open sandbox · driving: {FB-CODE | "idle"}`.
- Opens the sandbox URL in a new tab.
- Uses `<a target="_blank" rel="noopener noreferrer">` (§3).
- The footer is outside the active-build tab/drawer model. It represents the shared sandbox runtime, not an artifact owned by one build card.

---

## Section 2: Anchored WorkflowNodeInspector

### Behavior contract

- `WorkflowNodeInspector` is the shared interaction contract for both task nodes and phase nodes. It replaces the current fixed `TaskInspector` and `WorkflowStageInspector` overlays once feature-equivalent.
- One inspector open at a time. Re-clicking the same node closes it.
- Closes on: Esc, click outside the inspector and outside any node, navigation away from the build.
- Returns keyboard focus to the trigger node on close (`focus-return`).
- Compact default ~340×380. Expand handle in the header opens a larger overlay (caps at 80% of the workflow region, scrollable inside). **Expand never escapes the workflow region - it does not cover the coworker rail.**
- Re-anchors on window/container resize, scroll, and graph layout change (`R4` from peer review).
- ARIA: compact inspector uses `role="dialog"`, `aria-modal="false"`, and is labelled by the step or phase name. It is explicitly NOT `aria-modal=true` because the coworker rail and graph controls must remain reachable.
- Existing fixed overlays use `position: fixed`, full-page dim layers, and high z-index. Those patterns must be removed from the final path because they contradict the "see it right there" requirement.

### Coordinate-space formula

The graph container is `position: relative`; the inspector is `position: absolute` inside it. Given the clicked node's `DOMRect` (`nodeRect`) and the graph container's `DOMRect` (`containerRect`):

```
left = nodeRect.left - containerRect.left + graphContainer.scrollLeft
top  = nodeRect.top  - containerRect.top  + graphContainer.scrollTop
```

Then auto-flip in 4 quadrants based on available space:

- If `inspector.height` would clip below: anchor *above* the node (`top -= inspector.height + gap`).
- If `inspector.width` would clip right: anchor *left* (`left -= inspector.width + gap`).
- Combined cases handled by 4-quadrant decision tree; never let the inspector escape the canvas bounds.
- `gap = 8px` between node edge and inspector edge.
- Connector arrow (8×8 triangle) points from the inspector edge toward the node center.
- React Flow zoom/pan transforms are already reflected in `DOMRect`, so the anchoring layer must measure the rendered DOM node after React Flow layout, not recompute positions from untransformed graph coordinates.

### Content slots

Compact task-node view shows:
1. Step name + status badge (`running | done | blocked | pending`)
2. Started/finished timestamps
3. One-line artifact reference (sandbox branch / commit / file count)
4. "Next gate" label (e.g. "awaits Advance to Plan")
5. Primary action button (phase-contextual: Run Verification / Approve / Retry / View Logs)
6. Two secondary actions max (always includes "Ask coworker about this step")
7. Expand handle (opens drawer-style overlay for full content)

Compact phase-node view shows:
1. Phase name + status badge
2. The same `deriveWorkflowStageGuidance` result used by current `WorkflowStageInspector`
3. Related artifact count: brief/design doc/build plan/task results/review/UX evidence as applicable
4. Current gate or next approval label
5. Primary action when the workflow-action derivation allows one
6. Expand handle for the phase's DetailsDrawer section

Expanded view shows full per-step or per-phase detail: logs, diffs, review verdict, decision form, dispatch history, and sandbox/source-currency evidence. Same content that today lives in Progress / Details panels, but grouped under the selected node first.

---

## Section 3: Accessibility

Per peer-review critical risk #1 (missing dedicated section). This redesign introduces UI-heavy new components and the accessibility section is normative, not advisory.

### Roles and labels

| Component | Role | Label source |
|---|---|---|
| `ActionBanner` | `region` | `aria-label="Current build action"` |
| `WorkflowCanvas` | `region` around React Flow; React Flow owns node/edge focus | `aria-label="Build workflow graph"` |
| `WorkflowCanvas` nodes | React Flow wrapper role via `ariaRole`, usually `button` only when the node itself opens an inspector | step name + status (e.g. "Ideate, completed") |
| `WorkflowNodeInspector` | `dialog` | `aria-labelledby={step or phase name node}`, `aria-modal="false"` |
| `BuildListItem` row | `button` | `{title} — {phase} — {attention?}` |
| `BuildListItem` phase mini-rail | `img` | `aria-label="Phases reached: ideate, plan"` |
| `OpenSandboxButton` | `link` | `Open sandbox, driving build {code or 'idle'}` |
| `DetailsDrawer` | `region` | `aria-label="Build details"` |

### Keyboard operability

- **React Flow accessibility:** keep `nodesFocusable={true}`, `edgesFocusable={true}`, and `disableKeyboardA11y={false}` unless a test proves a conflict. Configure `ariaLabelConfig` and node `ariaRole`/`domAttributes` instead of wrapping the whole canvas in `role="application"`.
- **WorkflowNodeInspector tab order:** primary action → secondary actions (in document order) → expand handle → close. Compact inspector is non-modal and must not trap focus; coworker rail remains reachable via standard browser focus order. Expanded inspector may use a local focus boundary only if it is visually modal within the workflow region and still keeps close/Esc reliable.
- **Esc listener:** mounted in `useEffect` on inspector open, removed on close. Uses `keydown` capture phase to win over text inputs inside the inspector.
- **Focus return:** save `document.activeElement` on open; restore on close. Fall through to first node in canvas if the trigger is no longer present.
- **WorkflowCanvas keyboard nav:** Tab reaches nodes and edges via React Flow. Enter / Space opens inspector for focused nodes. Do not remap arrow keys until there is an explicit graph-aware navigation implementation and Playwright coverage; React Flow already uses keyboard movement semantics when nodes are draggable/focusable.
- **All interactive elements have visible focus styling:** 2px outline `var(--dpf-accent)` with 2px offset. No CSS-removed focus.

### Reduced motion

- All transitions (inspector enter/exit, drawer slide, fleet row state change) gated on `prefers-reduced-motion: no-preference`. With reduced motion: hard show/hide, no slide animations.

### Color independence

- Phase mini-rail uses shape AND color (filled circle = reached, outlined = pending).
- Attention dot uses ring AND color.
- Status badges in inspector use icon AND color (✓ done, ⚠ blocked, ● running, ○ pending).
- Touched components may not introduce hardcoded text/background/border/accent colors. Graph status and role colors must be exposed as CSS variables or token-derived values. If existing `PHASE_COLOURS` hex constants remain in legacy code, this slice may adapt them at the graph boundary but must not spread them into new inline styles.

---

## Section 4: Alternatives Considered

Per peer-review important risk #2 (no alternatives documented).

| Approach | Rejected because |
|---|---|
| **Keep global tabs, just compress the cards** | Doesn't solve the "workflow buried" complaint. Tabs still hide the graph behind Progress/Details. |
| **Side-panel inspector (slides in from right)** | Displaces the coworker. User explicitly corrected this: "I would like to see it right there" at the node. |
| **Modal overlay inspector (centered)** | Loses spatial linkage to the clicked node. User has to mentally remap. |
| **Replace ProcessGraph entirely with a Kanban-style phase board** | Loses sub-step / gate detail that the graph carries. The graph is the user's preferred lens; this redesign promotes it, not replaces it. |
| **Keep PhaseIndicator strip as a redundant safety surface** | The whole point is killing redundancy. The graph already shows phase; doubling it adds chrome without info. |
| **Per-build Preview tab with sandbox isolation work** | Out of scope. Sandbox isolation is its own major effort. This redesign surfaces the shared-sandbox truth honestly via a single Open Sandbox action. |

---

## Section 5: DetailsDrawer (migration target)

The Progress, Details, and Docs tabs disappear from the active-build pane. Their content moves into a single right-edge drawer reachable in <=2 clicks.

This drawer is an evidence surface, not a second command/status narrator. It must not reintroduce an "Operational status" heading or an alternate operator-action sentence that conflicts with the `ActionBanner`.

### Trigger

- Thin 24px vertical pill on the right edge of the workflow canvas, label "Details" rotated 90°, with chevron.
- Keyboard: focusable, Enter/Space opens.
- Also opens automatically when the WorkflowNodeInspector expand handle is pressed (so "see full detail for this step" is one click from the inspector).

### Content

- **Progress section** (existing `BuildProgressOperationalPanel` content): task progress, agent quiet detector, recent activity, sandbox branch summary, dispatch attempts, scoped verification.
- **Brief / Design Doc section** (existing `FeatureBriefPanel` + design doc viewer): the full ideate-phase content.
- **Review section** (existing `ReviewPanel`): when phase is review/ship/complete.
- Drawer is scrollable; sections are collapsible accordions, the section relevant to the active build's current phase is expanded by default.
- **Sandbox evidence subsection** comes from `BuildSandboxCard` / progress projection source-currency data. It shows branch, diffstat, expected-file reality, and checked age. It does not become another preview launcher.
- **Dispatch / verification subsections** preserve the current projection-backed history and scoped verification cards; do not move this logic into ad hoc local state.
- **BS Queue subsection** (new) shows the platform-wide concurrency cap, the current running set, and the FIFO queue with each waiting build's position, requested-at timestamp, and a reason (`"capacity"` / `"waiting on dependency"`). Each row links to its `BuildListItem` (focus the build in the fleet rail). The clicked-fleet-header indicator scrolls the drawer here. This subsection is **read-only** in this redesign — queue management actions remain on the existing admin/diagnostics route until the concurrency thread lands its own UI.

### Width and overlay rules

- Drawer width: `min(480px, 40vw)`.
- Slides in from the right edge of the workflow canvas, never covers the coworker rail.
- Opens with a 200ms slide; respects `prefers-reduced-motion`.
- On viewports where `40vw` would leave less than 720px for the workflow canvas, the drawer switches to a bottom sheet constrained to the active-build pane. The coworker rail still does not move.

---

## Section 6: Component Contracts

### `BuildListItem` (compact one-line variant)

```ts
type BuildQueueState =
  | { kind: "running"; stepLabel: string | null }
  | { kind: "queued"; position: number; reason: "capacity" | "dependency"; ahead: number }
  | { kind: "blocked"; reason: string }
  | { kind: "idle" };

type BuildListItemProps = {
  build: FeatureBuildRow;
  active: boolean;
  index: number;
  lifecycleLabel: string;
  isDevEnvironment: boolean;
  needsAttention: boolean;   // ← computed: blocked, awaiting user, stalled
  queueState: BuildQueueState; // ← new: drives the queue-state badge between claim badge and attention dot
  density?: "comfortable" | "fleet";
  onSelect: () => void;
  onDelete: () => void;
};
```

- Fleet density height <=32px. CSS: `flex; align-items: center; gap: 8px; padding: 4px 8px`.
- Comfortable density may preserve the current title/metadata card for any non-rail caller until the migration is complete.
- Fleet density renders no `Updated May 20` text — that's chrome the fleet rail doesn't need at this density.
- `bi-cost-*` code appears as a hover tooltip on the FB code, not inline.
- Delete button is icon-only, focusable, and disabled in dev environments exactly as today. It must not expand row height.
- Queue-state badge: render a 14×14 inline SVG with shape that matches `queueState.kind` (filled play, numbered hourglass, paused, none-when-idle). The tooltip reads from the discriminated union. The badge never expands the row past 32px. When `queueState.kind === "queued"`, render the position number inside the hourglass with role="img" and `aria-label="Queued, position {position}"`.

### `ActionBanner`

```ts
type ActionBannerProps = {
  state: "ready" | "running" | "blocked" | "review_failed" | "complete";
  sentence: string;          // ← one sentence, no repetition of state name
  primaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  detail?: string;           // ← only shown when state is "blocked" or "review_failed"
};
```

- Height: 40px fixed.
- No duplicate heading + sentence. The sentence IS the heading.
- Primary action right-aligned, `min-width: 120px`.
- Internally consumes the same workflow-action derivation as `BuildStudioWorkflowActionCard`; this is a presentation variant, not a second source of action truth.

### `WorkflowNodeInspector`

```ts
type WorkflowNodeInspectorProps = {
  node: WorkflowNode;         // phase or task node
  kind: "phase" | "task";
  anchorRect: DOMRect;        // ← passed from the click handler
  containerRect: DOMRect;     // ← graph container rect
  containerScrollTop: number;
  containerScrollLeft: number;
  onClose: () => void;
  onAskCoworker: (prefill: string) => void;
  onOpenDetails: (section: "progress" | "brief" | "review" | "sandbox") => void;
};
```

- Position computed per §2 formula.
- Re-anchors on `window.resize`, container `scroll`, and `requestAnimationFrame` after graph layout changes.
- Compact mode does not trap focus. Expanded mode may use a local focus boundary only after keyboard tests prove coworker/graph access remains sane.
- `TaskInspector.tsx` and `WorkflowStageInspector.tsx` should become thin content renderers or be deleted after their content is moved into this shared shell.

### `OpenSandboxButton`

```ts
type OpenSandboxButtonProps = {
  drivingBuildCode: string | null;   // ← null when no build is driving
  sandboxUrl: string;
};
```

- Renders `<a target="_blank" rel="noopener noreferrer">` — `rel` is not optional. (Reviewer R8.)
- Label format: `Open sandbox · driving: ${drivingBuildCode ?? "idle"}`.
- Disabled (visually + `aria-disabled="true"`) when `sandboxUrl` is empty.
- Deterministic driver — the build that owns the sandbox is the one whose preview port is live; if multiple, the most-recently-active. Single source of truth, exported as a pure helper and covered by tests.
- If the helper cannot determine a driver from current data, render `idle` rather than implying the active build owns the sandbox.

---

## Section 7: Refactoring Budget

The implementation plan must reserve at least 20% of engineering capacity for refactoring and deletion. The tracked refactor work is:

1. Collapse `TaskInspector.tsx` and `WorkflowStageInspector.tsx` into one anchored inspector shell with task/phase content renderers.
2. Remove `buildView` tab state from `BuildStudio.tsx` after the workflow canvas and details drawer are feature-equivalent.
3. Delete the bottom `PhaseIndicator` rendering path from active desktop Build Studio once the fleet mini-rail + ProcessGraph coverage exists. Keep `PhaseIndicator.tsx` only if another caller or mobile fallback still uses it.
4. Move layout math into `build-studio-layout.ts` or a sibling pure helper so Playwright and unit tests can assert widths/heights without depending on brittle DOM prose.
5. Replace new inline style/color work with CSS variables and token classes. Do not add more hardcoded hex/status color spread while touching ProcessGraph.
6. Add stable test IDs for the fleet rail, active workflow canvas, inspector, drawer, coworker rail, and sandbox footer.

This budget is a gate: if a PR delivers the new UI but leaves fixed overlays, duplicate tabs, duplicate phase strips, or untested layout math in place, the slice is not done.

## Section 8: Build Plan (T1-T8)

These map to the 8 tasks the coworker drafted before MCP went unreachable, amended by this chief-architect pass. Each task carries the peer-review risks it must satisfy.

| Task | File | Risks carried |
|---|---|---|
| T1 | `apps/web/components/build/build-studio-layout.ts` — zone spec, fleet width, canvas min/max, drawer breakpoint rules, test IDs | Prevent viewport-coupled sizing; make layout testable |
| T2 | `apps/web/components/build/BuildListItem.tsx` — `density="fleet"` one-line compression plus mini phase rail | Color-independent phase rail, keyboard/focus, no row-height creep |
| T3 | `apps/web/components/build/ActionBanner.tsx` (new) — compact presentation variant over existing workflow-action derivation | Preserve single-status command spine; no duplicate heading/sentence |
| T4 | `apps/web/components/build/WorkflowNodeInspector.tsx` (new shell) + refactor `TaskInspector.tsx` / `WorkflowStageInspector.tsx` content into it | Resize re-anchor, `aria-modal="false"`, no coworker overlap, no fixed full-page overlay |
| T5 | `apps/web/components/build/DetailsDrawer.tsx` (new) — migrated progress/brief/review/sandbox evidence | Progress is evidence-only; preserves source labels and projection-backed cards |
| T6 | `apps/web/components/build/OpenSandboxButton.tsx` (new) + pure driver helper | Deterministic driver, port validation, single shared link, `rel="noopener noreferrer"` |
| T7 | `apps/web/components/build/BuildStudio.tsx` — wire zones, remove global tab selector, remove active desktop `PhaseIndicator`, remove per-build Preview tab | Inline rationale comment for tab removal linking to this spec; no old/new parallel UI |
| T8 | Tests + a11y/visual verification: `BuildListItem`, `ActionBanner`, `WorkflowNodeInspector` (positioning + focus + keyboard), `OpenSandboxButton`, `DetailsDrawer`, `BuildStudio` layout integration | Machine-check acceptance; Playwright bounding boxes for canvas/inspector/coworker/sandbox |

T1, T2, and T3 can run in parallel as the first wave. T4-T6 can run in parallel as the second wave if they agree on shared test IDs and layout helper contracts. T7 is sequential and owns deletion. T8 follows T7, but unit tests for pure helpers/components should land with each task rather than waiting for a final test-only sweep.

---

## Section 9: Acceptance Criteria

A build is "done" against this spec when all of these are true:

1. `ProcessGraph` fills >70% of the active-build pane height when no inspector is open, and >50% when an inspector is anchored. Measured via Playwright + container query.
2. Phase progression is visible in exactly one place per surface: fleet mini-rail for aggregate, ProcessGraph for active detail. The `PhaseIndicator` bottom strip is removed; the "Workflow:" header pill is removed.
3. Clicking a workflow node opens an inspector anchored *inside* the workflow region. Coworker panel is never displaced. Verified by Playwright assertion on the inspector's bounding box vs. the coworker panel's bounding box (no overlap).
4. No `Preview` tab exists on individual builds. A single `OpenSandboxButton` exists in the footer, labeled with the currently-driving build or "idle".
5. `BuildListItem` fleet row height <= 32px in production CSS. Verified via computed style assertion.
6. WCAG 1.4.1 (color is not sole conveyor): phase mini-rail and attention dot pass an automated axe-core check with `color-contrast` and `link-in-text-block` enabled.
7. Keyboard navigation: Tab cycles inspector primary → secondary → expand → close; Esc closes; focus returns to trigger node. Verified via Playwright keyboard scenarios.
8. Inspector re-anchors correctly on window resize, container scroll, and graph layout change. Playwright with explicit resize + scroll events.
9. `OpenSandboxButton` always emits `rel="noopener noreferrer"` when `target="_blank"`. Verified via DOM assertion.
10. `BuildStudioWorkflowActionCard` / `ActionBanner`, `WorkflowNodeInspector` phase-node content (preserving the current `WorkflowStageInspector` guidance while it exists), and `BuildProgressOperationalPanel` remain consistent with the progress projection precedence rule from the single-status command-spine spec.
11. DetailsDrawer contains migrated Progress, Brief/Design Doc, Review, and Sandbox evidence sections. No old `progress/topology/preview/docs` tab selector remains in the desktop active-build pane.
12. Touched UI uses theme-aware DPF CSS variables for text, background, border, accent, focus, and status. Any remaining legacy `PHASE_COLOURS` usage is isolated behind an adapter and not expanded into new inline styles.
13. Focused component tests cover `BuildListItem`, `ActionBanner`, `WorkflowNodeInspector`, `OpenSandboxButton`, `DetailsDrawer`, and `BuildStudio` layout integration.
14. Verification gates: focused Vitest for touched files, `pnpm --filter web typecheck`, `pnpm --filter web exec next build`, and a production-path `/build` UX exercise against the Docker-served app after rebuild.
15. `reviewDesignDoc` returns success when run against this spec (or its in-database mirror) — no critical or important risks remaining.
16. Each `BuildListItem` in fleet density renders the queue-state badge corresponding to the build's runtime state (running / queued@N / blocked / idle). Color is not the sole conveyor — verified by an axe-core run with color filters and by a snapshot assertion on the shape glyph for each `kind`. The fleet rail header renders `Builds: {running}/{cap} · {queuedCount} queued` and announces changes via `role="status"`.
17. DetailsDrawer's BS Queue subsection lists running and queued builds, ordered FIFO with explicit position, requested-at timestamp, and a reason. Each row focuses its `BuildListItem` on click. The subsection is read-only — queue mutation actions belong to the concurrency thread, not this layout work.

---

## Section 10: Out of Scope

- Sandbox isolation per build. We surface the shared-sandbox truth; we do not solve it.
- AI Coworker panel content, behavior, or width. Unchanged.
- What each phase does, or which agent runs each step. Unchanged.
- Telemetry on layout adoption / fleet rail usage. Future work.
- Mobile layout. The redesign is desktop-first; existing mobile breakpoint behavior (sidebar collapses) is preserved. The only mobile-adjacent requirement here is that the desktop drawer degrades without covering the coworker rail on narrower screens.
- Build Studio process modeling via EaView. The workflow canvas may remain React Flow over existing `process-graph-builder` data. Model-driven Build Studio remains a separate north-star track.
- **BS queue mutation / scheduler logic.** A separate thread owns the concurrency-cap implementation: the dispatcher, queue store, and any operator actions to promote/cancel queued builds. This layout spec only describes the **surface** that displays whatever runtime state that thread produces. If the queue thread changes the discriminated union shape of `BuildQueueState`, this spec updates to match, not the other way around.

---

## Provenance

This spec was synthesized from:

1. The user's two explicit asks across this conversation: (a) workflow as prominent visible core context, (b) step inspector should "see it right there" at the node, not in the coworker panel.
2. The original brief filed against `FB-B33E84B5` (six redundancies, three-zone layout, anchored-inspector rules).
3. The peer-review verdict captured on the Details tab of `FB-B33E84B5` (4 critical + 4 important unresolved risks).
4. The coworker's v2 design doc summary, captured in portal `[tool-trace] NO-CALL-BUT-MENTIONED` log lines at 2026-05-20 ~19:21–19:27 UTC, when MCP became unreachable before `saveBuildEvidence` could fire.
5. The coworker's drafted 8-task build plan, captured in the same `[tool-trace]` log lines.
6. Chief-architect repo review on 2026-05-21 against current `BuildStudio.tsx`, `ProcessGraph.tsx`, `BuildListItem.tsx`, `TaskInspector.tsx`, `WorkflowStageInspector.tsx`, `build-studio-layout.ts`, `process-graph-builder.ts`, the single-status command-spine spec, and live DB fallback for `FB-B33E84B5` / the linked backlog item.
7. External workflow UI benchmarks cited in Research & Benchmarking: GitHub Actions, GitLab CI/CD, Argo CD, React Flow, and n8n.

The spec exists in this repo because the live Build Studio pipeline could not complete its `saveBuildEvidence` → `reviewDesignDoc` cycle under the portal-restart + MCP-unreachable cascade conditions of this session (`project_self_upgrade_kills_in_session_ux`). When the environment is stable, `FB-B33E84B5` (or a successor FeatureBuild) can ingest this spec via `saveBuildEvidence` to commit it as the canonical design doc.
