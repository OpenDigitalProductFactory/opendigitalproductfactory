# Build Studio — dual work-intake differentiation (BI-E167A8A6)

- **Epic:** EP-BS-UX-HARDENING
- **Backlog item:** BI-E167A8A6
- **Extends:** BI-86D6AD78 (dual-entry clarity, done)
- **Date:** 2026-07-05
- **Status:** design + implementation

## Problem

Build Studio exposes two doors to start work, with no stated relationship:

1. **`/build` → "Start a new build"** — a plain-English free-text textarea in the
   `BuildStudio` sidebar. Submitting calls `createFeatureBuild` → creates a
   `FeatureBuild` (phase `ideate`) and opens the AI Coworker to interview the
   operator. This is the outcome-first, non-technical intake.
2. **`/build/work` → "Plan governed work"** — a structured Title / Taxonomy
   (`feat|fix|chore|doc|clean`) / Objective form in `WorkControlPanel`.
   Submitting calls `createGovernedWorkAction` → creates a `WorkCapsule` with a
   git worktree + branch. This is the governed engineering / git substrate.

Different shapes, both reachable from the Build Studio experience, with no
explanation of when to use which. A non-technical operator cannot tell which is
correct.

### Key substrate fact — the capability mismatch

- `/build` (Build Studio) renders for **`view_platform`** → roles HR-000,
  HR-200, HR-300.
- `createGovernedWorkAction` requires **`manage_backlog`** → roles HR-000,
  HR-500 (enforced server-side).

So HR-200 / HR-300 — precisely the non-technical operators who *can* see Build
Studio — could open the "Plan governed work" form but **could not submit it**
(it throws `Unauthorized`). Door 2 is a dead door for the population the BI is
about.

`FeatureBuild` and `WorkCapsule` are related but distinct: a `FeatureBuild`
already manages its own capsule under the hood; `WorkCapsule` is the lower-level
governed git container used for hands-on development and coding agents. Unifying
them behind one router would blur two deliberately-separate layers.

## Decision

Kernel routing (`principle_decide`, population `human`, surface
`build-studio-work-intake`) found **no commandment conflict** across the three
candidate options. Scored on the `human_cognitive_load` axis it recommends
**Option C** with high confidence (composite 1.372, margin 0.459 > tie margin).

**Chosen: Option C + B (hybrid) — audience-gate door 2 to `manage_backlog`
holders, plus differentiation/relationship copy on both surfaces.**

- **A — unify into one routing entry.** Rejected: adds an intent-classification
  layer over two distinct substrates, highest blast radius, over-scoped for a
  medium BI. The real distinction is *audience / capability*, not *phrasing*.
- **B — differentiation copy only.** Necessary but insufficient alone: leaves
  both doors visible to operators who cannot use door 2.
- **C — audience-gate door 2 + copy.** Aligns the UI with the authorization the
  server already enforces; a non-technical operator sees exactly one door.

## Implementation

1. `apps/web/app/(shell)/build/page.tsx` — compute `canManageGovernedWork` and
   pass to `BuildStudio`.
2. `apps/web/components/build/BuildStudio.tsx` — new `canManageGovernedWork?`
   prop (default `false`). The "Work Control" sidebar link renders only for
   `manage_backlog` holders and carries a one-line subtitle stating its
   relationship to "Start a new build"; the primary textarea gains a purpose
   caption naming door 1.
3. `apps/web/app/(shell)/build/work/page.tsx` — compute `canCreateGovernedWork`
   and pass to `WorkControlPanel`.
4. `apps/web/components/build/work-control/WorkControlPanel.tsx` — new
   `canCreateGovernedWork?` prop (default `false`). Adds an intro paragraph
   naming the surface and linking back to "Start a new build"; the create form
   renders only for `manage_backlog` holders, otherwise an honest fallback note
   with a recovery link.

No substrate, schema, or route changes. Copy uses theme tokens only.

## Verification

- `WorkControlPanel.test.tsx` — gated create form (present with capability,
  hidden + fallback without), relationship copy, `href="/build"` link.
- `CreateGovernedWorkForm.test.tsx` — unchanged, still green.
- Live Contributor-preview viewport check of `/build` and `/build/work`.

## UX-Fit-Decision

`fits`. Owning area Products › Delivery (Build Studio). Net reduction in surface
area — removes a dead door and adds only static, theme-tokened copy. Reuses the
existing `manage_backlog` capability (single source of truth with the server
action); no new primitives; no prompt-sending controls.
