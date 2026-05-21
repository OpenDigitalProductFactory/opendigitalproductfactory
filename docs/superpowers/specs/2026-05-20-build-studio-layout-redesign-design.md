# Build Studio Layout Redesign — Design Spec

**Depends on:** Existing Build Studio surfaces (`apps/web/components/build/BuildStudio.tsx`, `ProcessGraph.tsx`, `PhaseIndicator.tsx`, `BuildListItem.tsx`, `BuildStudioWorkflowActionCard.tsx`, `PreviewUrlCard.tsx`, `FeatureBriefPanel.tsx`, `ReviewPanel.tsx`) and their callers in `apps/web/app/(shell)/build/page.tsx`. No new data-model changes — this is a pure UI refactor.

**Related BI:** `FB-B33E84B5` (filed, ideate phase). Captures the design intent that the live Build Studio coworker drafted (`[tool-trace] hasDesignDoc=true, docKeys=problemStatement,dataModel,existingFunctionalityAudit,proposedApproach,reusePlan,acceptanceCriteria,accessibility,reusabilityAnalysis`) but could not commit through `saveBuildEvidence` due to portal self-upgrade + MCP-unreachable cascades (`project_self_upgrade_kills_in_session_ux`).

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
│          │  │     ┌───┴────────┐  ← NodeInspector  │   │           │
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
| Active build content slot | No global tabs. Workflow graph is always visible; clicking a node opens an anchored `NodeInspector` inside the graph region. | User explicitly asked: "I would like to see it right there" (at the node). Today's `progress/topology/preview/docs` tabs hide each other. |
| Step detail position | Anchored popover inside the workflow region, never the coworker rail. Auto-flips above/below/left/right based on space. | User explicitly corrected the earlier draft that displaced the coworker panel. |
| Removed-tab content (Progress, Details, Docs) | Migrated into a new `DetailsDrawer` component reachable in ≤2 clicks (open via expand handle on the inspector or a thin tab strip on the right edge of the workflow region). | Reviewer correctly flagged: removing tabs without a migration path risks regressions. |
| Sandbox preview | Single shared `OpenSandboxButton` footer action labeled with currently-driving build. Drop the per-build Preview tab. | Per `project_self_upgrade_kills_in_session_ux`, all builds share the sandbox — per-build preview is dishonest. |
| Build list item density | One line, ≤32px height. `code · phase mini-rail · claim badge · attention dot`. | Today's 3-line items waste ~270px of horizontal that the graph could use. |
| Fleet rail width | ~150–180px (down from ~430px today). | Reclaims the room the workflow needs to be the prominent core context. |
| AI Coworker panel | Unchanged width, position, and content. | User explicitly out-of-scope. |

---

## Section 1: Zone Layout

### Left — Fleet Rail (`BuildListItem` compressed)

- One row per in-flight build. Max height 32px. Truncates by code length, not by phase.
- Row contents, left-to-right: `FB-CODE` (mono), 5-dot phase mini-rail, claim avatar/badge, attention dot (red when "needs you").
- Phase mini-rail = 5 SVG circles for `ideate → plan → build → review → ship`. Each circle gets `aria-label="{phase}: {reached|active|pending}"`, wrapper `role="img"`. Shape (filled vs. outline) carries reached/pending in addition to color — color must not be the sole conveyor (WCAG 1.4.1).
- Attention dot: shape + color (red dot with concentric ring) so it carries to color-blind users.
- Active build row uses left-border accent (4px) and bumped background; not just color.

### Center — Active Build

- 40px pinned **ActionBanner** at top: one sentence describing current state + the single primary action button. Subtext only when blocked (review-failed, awaiting decision); otherwise just the sentence.
- Below the banner, the **WorkflowCanvas** fills 100% of the remaining height. No second toolbar, no global tabs.
- The `NodeInspector` (§2) is the only thing that overlays the canvas, and only on user click.
- A thin **DetailsDrawer** tab sits on the right edge of the canvas (24px wide vertical pill). Clicking it opens the drawer (§5).

### Right — AI Coworker (unchanged)

- No content or layout changes. Width sticky.
- The `NodeInspector` provides "Ask coworker about this step" which prefills the coworker input — no panel swap, no displacement.

### Footer — Shared Sandbox

- A single `OpenSandboxButton` lives in the page footer. Label: `Open sandbox · driving: {FB-CODE | "idle"}`.
- Opens the sandbox URL in a new tab.
- Uses `<a target="_blank" rel="noopener noreferrer">` (§3).

---

## Section 2: Anchored NodeInspector

### Behavior contract

- One inspector open at a time. Re-clicking the same node closes it.
- Closes on: Esc, click outside the inspector and outside any node, navigation away from the build.
- Returns keyboard focus to the trigger node on close (`focus-return`).
- Compact default ~340×380. Expand handle in the header opens a larger overlay (caps at 80% of the workflow region, scrollable inside). **Expand never escapes the workflow region — it does not cover the coworker rail.**
- Re-anchors on window/container resize, scroll, and graph layout change (`R4` from peer review).
- ARIA: `role="dialog"`, `aria-modal="false"` (it doesn't trap the full page), labelled by the step name. (`R5` from peer review — explicitly NOT `aria-modal=true` because the coworker rail must remain reachable.)

### Coordinate-space formula

The graph container is `position: relative`; the inspector is `position: absolute` inside it. Given the clicked node's `DOMRect` (`nodeRect`) and the graph container's `DOMRect` (`containerRect`):

```
left = nodeRect.left - containerRect.left
top  = nodeRect.top  - containerRect.top + graphContainer.scrollTop
```

Then auto-flip in 4 quadrants based on available space:

- If `inspector.height` would clip below: anchor *above* the node (`top -= inspector.height + gap`).
- If `inspector.width` would clip right: anchor *left* (`left -= inspector.width + gap`).
- Combined cases handled by 4-quadrant decision tree; never let the inspector escape the canvas bounds.
- `gap = 8px` between node edge and inspector edge.
- Connector arrow (8×8 triangle) points from the inspector edge toward the node center.

### Content slots

Compact view shows:
1. Step name + status badge (`running | done | blocked | pending`)
2. Started/finished timestamps
3. One-line artifact reference (sandbox branch / commit / file count)
4. "Next gate" label (e.g. "awaits Advance to Plan")
5. Primary action button (phase-contextual: Run Verification / Approve / Retry / View Logs)
6. Two secondary actions max (always includes "Ask coworker about this step")
7. Expand handle (opens drawer-style overlay for full content)

Expanded view shows full per-step detail: logs, diffs, review verdict, decision form. Same content that today lives in Progress / Details panels.

---

## Section 3: Accessibility

Per peer-review critical risk #1 (missing dedicated section). This redesign introduces UI-heavy new components and the accessibility section is normative, not advisory.

### Roles and labels

| Component | Role | Label source |
|---|---|---|
| `ActionBanner` | `region` | `aria-label="Current build action"` |
| `WorkflowCanvas` | `application` (graph navigation needs custom keys) | `aria-label="Build workflow graph"` |
| `WorkflowCanvas` nodes | `button` | step name + status (e.g. "Ideate, completed") |
| `NodeInspector` | `dialog` | `aria-labelledby={step name node}`, `aria-modal="false"` |
| `BuildListItem` row | `button` | `{title} — {phase} — {attention?}` |
| `BuildListItem` phase mini-rail | `img` | `aria-label="Phases reached: ideate, plan"` |
| `OpenSandboxButton` | `link` | `Open sandbox, driving build {code or 'idle'}` |
| `DetailsDrawer` | `region` | `aria-label="Build details"` |

### Keyboard operability

- **NodeInspector tab order:** primary action → secondary actions (in document order) → expand handle → close. Focus trap with sentinel pair (top + bottom invisible focusable spans) — but trap only inside the inspector itself, not the page; coworker rail remains reachable via standard browser focus order.
- **Esc listener:** mounted in `useEffect` on inspector open, removed on close. Uses `keydown` capture phase to win over text inputs inside the inspector.
- **Focus return:** save `document.activeElement` on open; restore on close. Fall through to first node in canvas if the trigger is no longer present.
- **WorkflowCanvas keyboard nav:** arrow keys move focus between adjacent nodes (graph-aware, follows edges). Enter / Space opens inspector for focused node. Same Esc semantics.
- **All interactive elements have visible focus styling:** 2px outline `var(--dpf-accent)` with 2px offset. No CSS-removed focus.

### Reduced motion

- All transitions (inspector enter/exit, drawer slide, fleet row state change) gated on `prefers-reduced-motion: no-preference`. With reduced motion: hard show/hide, no slide animations.

### Color independence

- Phase mini-rail uses shape AND color (filled circle = reached, outlined = pending).
- Attention dot uses ring AND color.
- Status badges in inspector use icon AND color (✓ done, ⚠ blocked, ● running, ○ pending).

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

The Progress, Details, and Docs tabs disappear from the active-build pane. Their content moves into a single right-edge drawer reachable in ≤2 clicks.

### Trigger

- Thin 24px vertical pill on the right edge of the workflow canvas, label "Details" rotated 90°, with chevron.
- Keyboard: focusable, Enter/Space opens.
- Also opens automatically when the NodeInspector expand handle is pressed (so "see full detail for this step" is one click from the inspector).

### Content

- **Progress section** (existing `BuildProgressOperationalPanel` content): task progress, agent quiet detector, recent activity, sandbox branch summary, dispatch attempts, scoped verification.
- **Brief / Design Doc section** (existing `FeatureBriefPanel` + design doc viewer): the full ideate-phase content.
- **Review section** (existing `ReviewPanel`): when phase is review/ship/complete.
- Drawer is scrollable; sections are collapsible accordions, the section relevant to the active build's current phase is expanded by default.

### Width and overlay rules

- Drawer width: `min(480px, 40vw)`.
- Slides in from the right edge of the workflow canvas, never covers the coworker rail.
- Opens with a 200ms slide; respects `prefers-reduced-motion`.

---

## Section 6: Component Contracts

### `BuildListItem` (compact one-line variant)

```ts
type BuildListItemProps = {
  build: FeatureBuildRow;
  active: boolean;
  lifecycleLabel: string;
  needsAttention: boolean;   // ← computed: blocked, awaiting user, stalled
  onSelect: () => void;
  onDelete: () => void;
};
```

- Height ≤32px. CSS: `flex; align-items: center; gap: 8px; padding: 4px 8px`.
- Renders no `Updated May 20` text — that's chrome the fleet rail doesn't need at this density.
- `bi-cost-*` code appears as a hover tooltip on the FB code, not inline.

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

### `NodeInspector`

```ts
type NodeInspectorProps = {
  node: WorkflowNode;
  anchorRect: DOMRect;        // ← passed from the click handler
  containerRect: DOMRect;     // ← graph container rect
  containerScrollTop: number;
  onClose: () => void;
  onAskCoworker: (prefill: string) => void;
};
```

- Position computed per §2 formula.
- Re-anchors on `window.resize`, container `scroll`, and `requestAnimationFrame` after graph layout changes.
- Focus trap implemented with sentinel pair (no react-focus-lock dependency added if avoidable).

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
- Deterministic driver — the build that owns the sandbox is the one whose preview port is live; if multiple, the most-recently-active. Single source of truth, exported as a helper.

---

## Section 7: Build Plan (T1–T8)

These map to the 8 tasks the coworker drafted before MCP went unreachable. Each task carries the peer-review risks it must satisfy.

| Task | File | Risks carried |
|---|---|---|
| T1 | `apps/web/components/build/build-studio-layout.ts` — zone spec, reclaim math, breakpoint rules | — |
| T2 | `apps/web/components/build/BuildListItem.tsx` — one-line compression | R: color-only phase rail (Sec 3) |
| T3 | `apps/web/components/build/ActionBanner.tsx` (new) — 40px pinned | R: dedup heading + sentence (Sec 6) |
| T4 | `apps/web/components/build/NodeInspector.tsx` (new) — anchored popover | R4 (resize re-anchor), R5 (`role="dialog"`, `aria-modal="false"`) |
| T5 | `apps/web/components/build/OpenSandboxButton.tsx` (new) — shared surface | R1 (deterministic driver), R2 (port validation), R3 (single-link rule, `rel=noopener noreferrer`) |
| T6 | `apps/web/components/build/DetailsDrawer.tsx` (new) — migrated tab content | — |
| T7 | `apps/web/components/build/BuildStudio.tsx` — refactor: wire zones, remove `PhaseIndicator`, remove global tab selector | R6 (inline rationale comment for tab removal — link to this spec) |
| T8 | Tests + a11y snapshot: `BuildListItem`, `ActionBanner`, `NodeInspector` (positioning + focus + keyboard), `OpenSandboxButton` (rel attr), `DetailsDrawer` | — |

T1, T2, T3 can run in parallel as the first wave. T4–T6 in parallel as the second wave. T7 is sequential (depends on T1–T6). T8 follows T7.

---

## Section 8: Acceptance Criteria

A build is "done" against this spec when all of these are true:

1. `ProcessGraph` fills >70% of the active-build pane height when no inspector is open, and >50% when an inspector is anchored. Measured via Playwright + container query.
2. Phase progression is visible in exactly one place per surface: fleet mini-rail for aggregate, ProcessGraph for active detail. The `PhaseIndicator` bottom strip is removed; the "Workflow:" header pill is removed.
3. Clicking a workflow node opens an inspector anchored *inside* the workflow region. Coworker panel is never displaced. Verified by Playwright assertion on the inspector's bounding box vs. the coworker panel's bounding box (no overlap).
4. No `Preview` tab exists on individual builds. A single `OpenSandboxButton` exists in the footer, labeled with the currently-driving build or "idle".
5. `BuildListItem` row height ≤ 32px in production CSS. Verified via computed style assertion.
6. WCAG 1.4.1 (color is not sole conveyor): phase mini-rail and attention dot pass an automated axe-core check with `color-contrast` and `link-in-text-block` enabled.
7. Keyboard navigation: Tab cycles inspector primary → secondary → expand → close; Esc closes; focus returns to trigger node. Verified via Playwright keyboard scenarios.
8. Inspector re-anchors correctly on window resize, container scroll, and graph layout change. Playwright with explicit resize + scroll events.
9. `OpenSandboxButton` always emits `rel="noopener noreferrer"` when `target="_blank"`. Verified via DOM assertion.
10. `reviewDesignDoc` returns success when run against this spec (or its in-database mirror) — no critical or important risks remaining.

---

## Section 9: Out of Scope

- Sandbox isolation per build. We surface the shared-sandbox truth; we do not solve it.
- AI Coworker panel content, behavior, or width. Unchanged.
- What each phase does, or which agent runs each step. Unchanged.
- Telemetry on layout adoption / fleet rail usage. Future work.
- Mobile layout. The redesign is desktop-first; existing mobile breakpoint behavior (sidebar collapses) is preserved but not enhanced.

---

## Provenance

This spec was synthesized from:

1. The user's two explicit asks across this conversation: (a) workflow as prominent visible core context, (b) step inspector should "see it right there" at the node, not in the coworker panel.
2. The original brief filed against `FB-B33E84B5` (six redundancies, three-zone layout, anchored-inspector rules).
3. The peer-review verdict captured on the Details tab of `FB-B33E84B5` (4 critical + 4 important unresolved risks).
4. The coworker's v2 design doc summary, captured in portal `[tool-trace] NO-CALL-BUT-MENTIONED` log lines at 2026-05-20 ~19:21–19:27 UTC, when MCP became unreachable before `saveBuildEvidence` could fire.
5. The coworker's drafted 8-task build plan, captured in the same `[tool-trace]` log lines.

The spec exists in this repo because the live Build Studio pipeline could not complete its `saveBuildEvidence` → `reviewDesignDoc` cycle under the portal-restart + MCP-unreachable cascade conditions of this session (`project_self_upgrade_kills_in_session_ux`). When the environment is stable, `FB-B33E84B5` (or a successor BI) can ingest this spec via `saveBuildEvidence` to commit it as the canonical design doc.
