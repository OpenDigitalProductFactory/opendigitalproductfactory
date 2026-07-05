# Plan — Build Studio escalate-to-human terminal UI state

**BI:** BI-A2F3FA9D (large, bug) · **Epic:** EP-BS-UX-HARDENING
**Sibling:** BI-F0005EB0 (failed-inference detection) — the large reliability tail of the epic.

## Problem (verified live 2026-07-04)

When a build is escalated-to-human, `escalateBuildToHuman`
([apps/web/lib/build/escalate-build-to-human.ts](../../../apps/web/lib/build/escalate-build-to-human.ts))
sets `phase=abandoned`, writes a human-readable `abandonReason`, files an issue
report, and parks the originating BI as `deferred` — honest at the **data** layer.
But the `/build` supervision UI keeps showing **"AI Coworker: Working — watching
this stage"**. The operator the build was handed to gets no signal, no link to the
parked BI, and no resume path.

### Root cause (grounded)

`BuildPhase` ([feature-build-types.ts:483](../../../apps/web/lib/explore/feature-build-types.ts))
= `ideate|plan|build|review|ship|complete|failed` — it has **no `abandoned`
member**, yet the DB stores `phase=abandoned`. So `deriveBuildStudioWorkflowAction`
(which switches on the typed `BuildPhase`) has no branch for abandoned builds →
they fall through every `if (build.phase === …)` to the terminal
`review-only` return, whose status is **"Working"** (`statusForAction`). The
compact `ActionBanner` on `/build` then renders "Working — watching this stage".
The custodian (`build-studio-custodian.ts`) early-returns null only for
`complete|ship`, so it also has no terminal-abandoned handling.

## Definition of done (BI acceptance)

1. `BuildPhase` includes `abandoned` (type/data mismatch reconciled).
2. An abandoned build renders a **terminal state** — "Escalated to you — parked
   as `<BI>`", the `abandonReason`, at danger/attention intent — **not** "Working".
3. A **resume path** (link to the parked BI / delivery queue) is surfaced.
4. The custodian does **not** nudge on an abandoned build.
5. Change is pushed live and unit-tested.

## Substrate facts that shape the plan

- **Compile-forcing maps** — adding a `BuildPhase` member breaks four
  `Record<BuildPhase, …>` maps until each gets an `abandoned` entry:
  `PHASE_LABELS`, `PHASE_COLOURS`, `ALLOWED_TRANSITIONS`
  ([feature-build-types.ts](../../../apps/web/lib/explore/feature-build-types.ts)),
  and `PHASE_ICONS`
  ([process-graph-builder.ts:24](../../../apps/web/lib/build/process-graph-builder.ts)).
  `epic-rollup.ts` uses `Partial<Record<…>>` → no change needed.
- **Build-level abandon fields are not surfaced.** `FeatureBuildRow` exposes the
  *originator BI's* `abandonReason` (via the `originator` sub-select) but **not the
  build's own** `abandonReason`/`abandonedAt`. The escalate path writes those on
  the `FeatureBuild` row; they must be added to the type + both selects in
  [feature-build-data.ts](../../../apps/web/lib/explore/feature-build-data.ts).
  Make them **optional** (`abandonReason?: string | null`) — mirroring the
  `kind?` back-compat pattern — so the ~10 `FeatureBuildRow` test fixtures don't
  all break.
- **`originator.itemId`** (already loaded) is the user-facing `BI-XXXX` for the
  "parked as" label. **`/ops`** is the Delivery/Backlog surface where the
  deferred BI and the escalation report are worked → the resume href.
- **`failed` is NOT terminal here.** The BI groups `abandoned` + `failed` as
  "terminal", but in this codebase `failed` has a live `retry-build` recovery
  affordance and the custodian's `technicalRecovery` branch deliberately surfaces
  it. Excluding `failed` from the custodian would kill that feature. **Deviation:
  suppress the custodian for `abandoned` only** (truly terminal — WIP freed, BI
  deferred, no in-place recovery), and document the reason. This is
  evidence-before-diagnosis: the BI's grouping doesn't survive contact with the
  actual `failed`-phase recovery path.

## Phases

### Phase 1 — Type + data reconciliation (foundation, ships independently)

**Files:** `apps/web/lib/explore/feature-build-types.ts`,
`apps/web/lib/build/process-graph-builder.ts`,
`apps/web/lib/explore/feature-build-data.ts`

- Add `"abandoned"` to `BuildPhase`.
- Add `abandoned` entries to `PHASE_LABELS` (`"Abandoned"`), `PHASE_COLOURS`
  (muted grey, e.g. `#9ca3af`), `ALLOWED_TRANSITIONS` (`[]` — terminal),
  `PHASE_ICONS`. Leave `abandoned` out of `VISIBLE_PHASES` (terminal, like
  `complete`/`failed`); append to `PHASE_ORDER` after `failed`.
- Add optional `abandonReason?: string | null` + `abandonedAt?: Date | null` to
  `FeatureBuildRow`.
- Add `abandonReason: true` + `abandonedAt: true` to **both** selects
  (`getFeatureBuilds` list + `getFeatureBuildById`); the `...r` spread carries
  them into the mapped row.

**Verify:** `canTransitionPhase("abandoned", *) === false`; the four maps have an
`abandoned` key; a loaded abandoned build carries `abandonReason`. Unit tests in
`feature-build-types.test.ts`.

### Phase 2 — Guidance: escalated status + terminal action

**Files:** `apps/web/components/build/build-studio-workflow-actions.ts`

- Extend `BuildOperatorStatusKind` with `"escalated"`; `BuildOperatorStatus.label`
  with `"Escalated to you"`; intent `"danger"`.
- Add a new `BuildStudioWorkflowAction` variant `kind: "escalated-to-human"` with:
  `title`, `message` (embeds `abandonReason`), `primaryLabel: null` (no
  server-action button — terminal), `coworkerLabel`/`coworkerPrompt`, and new
  optional metadata `parkedBacklogItemId?: string | null` + `resumeHref?: string`.
- In `deriveBuildStudioWorkflowAction`, add a **first** branch
  `if (build.phase === "abandoned")` returning `escalated-to-human`, reading
  `build.abandonReason` and `build.originator?.itemId`, `resumeHref: "/ops"`.
- `statusForAction`: return the `escalated` status for `escalated-to-human`.
- `nextSentenceForAction`: add the `escalated-to-human` case
  ("Escalated to you — the parked item is waiting in Delivery.").

**Verify:** `deriveBuildStudioWorkflowAction({build: {phase:"abandoned", …}})`
returns `kind==="escalated-to-human"`, status `escalated`/`danger`, carries the
parked BI id + abandonReason, and is **not** `review-only`/"working". Unit tests
in `build-studio-workflow-actions.test.ts`.

### Phase 3 — Custodian: no nudge on abandoned

**Files:** `apps/web/components/build/build-studio-custodian.ts`

- Extend the terminal early-return: `complete | ship | abandoned` → `null`.
  (`failed` intentionally excluded — see substrate note.)

**Verify:** `deriveBuildStudioCustodianPrompt({build:{phase:"abandoned"}, …})`
returns `null` even when quiet. Unit test in `build-studio-custodian.test.ts`.

### Phase 4 — Terminal UI surface (banner + card)

**Files:** `apps/web/components/build/ActionBanner.tsx`,
`apps/web/components/build/BuildStudioWorkflowActionCard.tsx`

- `ActionBanner`: add `"escalated"` to `ActionBannerState`; danger tint in
  `stateClassName` (`--dpf-state-danger`/`--dpf-danger`); show `detail` for
  `escalated` (so `abandonReason` renders).
- `deriveActionBannerState`: `if (build.phase === "abandoned") return "escalated"`.
- In the compact-banner render path, when `action.kind === "escalated-to-human"`
  set `bannerPrimaryAction = { label: "Open parked item", onClick: () =>
  router.push(action.resumeHref ?? "/ops") }` and feed `sentence` =
  "Escalated to you — parked as `<BI>`", `detail` = `abandonReason`.
- Full (non-compact) card: render the parked-BI id + `abandonReason` block and an
  "Open parked item" link when `escalated-to-human`.

**Verify:** `deriveActionBannerState({phase:"abandoned"}) === "escalated"`;
render test — the compact banner for an abandoned build shows "Escalated to you",
the `BI-XXXX`, the abandonReason, an "Open parked item" action, and danger intent;
it does **not** show "Working". Tests in `ActionBanner.test.tsx` +
`BuildStudioWorkflowActionCard.test.tsx`.

## Risks & rollback

- **Blast radius of the type change** is bounded by the four compile-forcing maps
  (all edited in Phase 1) + optional row fields (no fixture breakage). CI tsc is
  authoritative (worktree tsc OOMs) — any missed exhaustive consumer surfaces
  there before merge.
- **`disposition=private`** on escalated builds already hides them from public
  lists; this change only affects the operator's own `/build` supervision view,
  so no external exposure risk.
- **Rollback:** revert the PR. The data layer is unchanged (escalate already
  wrote `phase=abandoned`); this PR is purely presentational + type-level, so a
  revert restores the prior (stale-"Working") behavior with no data migration.

## Out of scope

- In-place "un-abandon / resume the build" action (the build is terminal by
  design — WIP freed, BI deferred; the resume path is re-opening the BI).
- The failed-inference detection path (sibling BI-F0005EB0).
