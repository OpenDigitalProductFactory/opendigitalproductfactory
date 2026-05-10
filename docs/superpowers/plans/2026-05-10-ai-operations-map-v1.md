# AI Operations Map V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only Software Platform Operations Map at `/platform/ai/operations-map` that projects from the platform's canonical runtime sources, gates with the existing capability vocabulary, and links out to the real audit/coworker surfaces.

**Architecture:** Add a code-owned map template, projection layer, and read-only client surface under `apps/web/lib/ai-operations-map/` plus a new App Router route under `apps/web/app/(shell)/platform/ai/operations-map/`. Project from the canonical sources defined in the V1 spec — **no parallel event grammar, no new evidence model, no new theme tokens, no new capability keys**. Live SSE animation is feature-flagged off in V1; post-hoc projection is the default render path.

**Spec:** `docs/superpowers/specs/2026-05-10-ai-coworker-visual-control-surface-design.md` (revised 2026-05-10).

**Tech Stack:** Next.js 16 App Router (server component for the route, client component only for the inspector), Prisma via `@dpf/db`, Vitest, DPF theme CSS variables (`--dpf-*`), existing AGENTS.md §8 grant model, existing `lib/govern/permissions.ts` capabilities.

**AGENTS.md anchors:** §1 (no fabrication, fix-the-seed), §4 (PRs against `main`, DCO, branch `feat/ai-operations-map-v1`, worktree-per-session), §5 (build gate: vitest + typecheck + `next build` + UX exercise), §6 (query existing epics first; specs live in `docs/superpowers/specs`), §8 (grant intersection, `ToolExecution` columns), §11 (`Principal`/`PrincipalAlias` after 2026-05-09), §12 (no hardcoded colors).

---

## File Structure

**Create:**

- `apps/web/lib/ai-operations-map/types.ts` — view-layer types: `MapTemplate`, `MapLine`, `MapStation`, `MapProjection`, view DTOs (`ToolExecutionView`, `ToolExecutionReceiptView`, `BacklogItemActivityView`, `ExternalEvidenceRecordView`), `ActorRef`.
- `apps/web/lib/ai-operations-map/templates.ts` — the software-platform template (`software-platform`) with stable line/station ids: `discover`, `backlog`, `design`, `build`, `verify`, `release`, `support`, `improve`.
- `apps/web/lib/ai-operations-map/project-events.ts` — pure functions: `projectToolExecution`, `projectToolReceipt`, `projectBacklogActivity`, `projectExternalEvidence`, `projectAgentEvent`, `synthesizeHandoff`, `deriveSeverity`, `dedupeByToolExecution`.
- `apps/web/lib/ai-operations-map/load-projection.ts` — server-side fetcher that takes `{ organizationId, since, viewerCapabilities }` and returns `MapProjection[]` from Prisma.
- `apps/web/lib/ai-operations-map/access.ts` — derives view tier (`operator | reviewer | auditor | admin`) from `EffectiveAuthContext` and applies redaction.
- `apps/web/lib/ai-operations-map/project-events.test.ts`
- `apps/web/lib/ai-operations-map/load-projection.test.ts`
- `apps/web/lib/ai-operations-map/access.test.ts`
- `apps/web/components/platform/AiOperationsMap.tsx` — keyboard-accessible client component (`"use client"`) that renders schematic + read-only inspector. No motion when `prefers-reduced-motion: reduce`.
- `apps/web/components/platform/AiOperationsMap.test.tsx`
- `apps/web/app/(shell)/platform/ai/operations-map/page.tsx` — server component: auth check (existing `getEffectiveAuthContext` / `can`), fetch projection, render component.
- `apps/web/app/(shell)/platform/ai/operations-map/page.test.tsx`

**Modify:**

- `apps/web/components/platform/platform-nav.ts` — add Operations Map under the existing "AI Operations" section's `subItems`.
- `apps/web/components/platform/AiTabNav.tsx` — add the tab so the in-AI sub-nav surfaces it.
- `apps/web/components/platform/platform-nav.test.ts` — extend to assert the new subnav entry.

**Do NOT modify:**

- `apps/web/app/globals.css` — V1 reuses existing tokens (`--dpf-error`, `--dpf-warning`, `--dpf-success`, `--dpf-info`, `--dpf-accent-soft`, `--dpf-surface-3`). **No new tokens.** Earlier draft proposed `--dpf-state-error` / `--dpf-state-warning`; deleted because those tokens already exist under their canonical names.
- `apps/web/lib/govern/permissions.ts` — V1 composes from existing capabilities; **no new permission keys**.
- `apps/web/lib/tak/agent-event-bus.ts` — no new discriminants in V1. Handoffs project from `queue:escalation` / `orchestrator:task_dispatched`. Approvals project from `task:status === "input-required" | "auth-required"`. Verification projects from `verification:*`.
- `packages/db/prisma/schema.prisma` — no migration in V1.

---

## Tasks

### Task 0 — Backlog overlap check (AGENTS.md §6)

**Goal:** Don't create a duplicate epic. Don't start a worktree on top of someone else's branch.

- [ ] Run `mcp__dpf__list_epics` and search for existing epics matching `operations map`, `coworker UI`, `AI workforce`, `visual control`. Prefer extending an existing epic; if extending, link this plan to that epic and skip the create step.
- [ ] If no fit, create an epic via `mcp__dpf__create_build_epic` with slug `EP-AI-OPSMAP` and link the spec (`docs/superpowers/specs/2026-05-10-ai-coworker-visual-control-surface-design.md`).
- [ ] Create three backlog items under the epic, one per implementation slice (Task 1 group, Task 2 group, Task 3 group below). Set `type: portfolio`, `status: open`. Mirror the acceptance criteria from the spec.
- [ ] Sweep recent main commits (`git log --since="14 days ago" --oneline main`) and open PRs (`gh pr list --state open --limit 50 --json number,title,headRefName`) for overlap with operations-map / AI workforce nav. If overlap exists, **stop and ping Mark before proceeding** — a concurrent session may be in flight.

### Task 1 — Branch, worktree, and identity scaffolding (AGENTS.md §4)

- [ ] Create the worktree if not already in one: `git worktree add ../DPF-ai-operations-map -b feat/ai-operations-map-v1`.
- [ ] Inside the worktree, seed MCP config (Windows): `scripts/seed-worktree-mcp.ps1`. (Linux/macOS: `scripts/seed-worktree-mcp.sh`.) Restart Claude Code in the worktree so the `dpf` MCP loads.
- [ ] Confirm `git branch --show-current` returns `feat/ai-operations-map-v1`. If it returns `main`, abort.
- [ ] Confirm `git config core.hooksPath` is `.githooks` (so the pre-commit typecheck runs).
- [ ] Confirm `git config commit.gpgsign` is unchanged from local default; commits will use `git commit -s` for DCO sign-off.

### Task 2 — Map template, projection, severity, access (TDD)

**Files:** `apps/web/lib/ai-operations-map/{types,templates,project-events,load-projection,access}.ts` and their `*.test.ts` siblings.

Per superpowers:test-driven-development — write the tests first, watch them fail for the right reason, then implement.

- [ ] **`project-events.test.ts`:** assert
  - software-platform template has the 8 stations and lines with stable ids; every line references existing stations
  - `deriveSeverity` is exhaustive over `TaskState` (build fails if a new state is added without a mapping)
  - `deriveSeverity` is exhaustive over the `auditClass` values used by `mcp-governed-execute.ts` (read the union from there, don't duplicate it)
  - `projectToolExecution` produces `severity = "critical"` for `success=false` + `auditClass ∈ {destructive, sensitive}`, `"warning"` otherwise for `success=false`, `"normal"` for `success=true`
  - `projectAgentEvent` covers `task:status`, `tool:start`, `tool:complete`, `verification:complete`, `queue:escalation`, `orchestrator:task_dispatched`, `async:failed`, `error`, `deliberation:degraded_diversity`
  - `dedupeByToolExecution` collapses a `tool:start` + matching `ToolExecution` row within ±2s into a single projection where `source === "tool-execution"`
  - `synthesizeHandoff` correlates `queue:escalation` + `orchestrator:task_dispatched` events by `threadId|buildId` into a single `source === "handoff"` projection
  - every projection produces working refs that resolve to a real source id (trace-integrity invariant)
- [ ] **`load-projection.test.ts`:** with Prisma mocked, assert
  - cross-organization rows are filtered (seed two orgs in fixtures; only the viewer's org appears)
  - identity resolution: every `actor.principalId` resolves through a `PrincipalAlias` row; no `Agent.id` leaks
  - source set matches the spec's §Sources table
- [ ] **`access.test.ts`:** assert
  - viewer with only `view_platform` sees `summary`-only projections (`ToolExecution.parameters` and `result` are not in the payload)
  - viewer with `view_platform` + `view_compliance` (Auditor) sees full payload
  - viewer with `view_platform` + `manage_agents` (Reviewer) sees gate state and denied calls with parameters redacted to `summary`
  - viewer with `view_platform` + `view_admin` + `manage_agents` (Admin) sees the Reviewer payload plus inspector write affordances (still no-op in V1)
- [ ] Run `pnpm --filter web exec vitest run lib/ai-operations-map` and confirm all tests fail because the modules do not yet exist.
- [ ] Implement `types.ts`, `templates.ts`, `project-events.ts`, `load-projection.ts`, `access.ts`. Implementation must:
  - reuse `TaskState` from `lib/tak/task-states.ts` (no parallel union)
  - reuse `AgentEvent` from `lib/tak/agent-event-bus.ts` (no parallel envelope)
  - resolve `actor.principalId` via a single helper (`apps/web/lib/identity/*`) so adding a new `PrincipalAlias.aliasKind` is one-line
  - keep `loadProjection` a pure server function — no React imports
- [ ] Re-run the tests; they pass.

### Task 3 — Route, component, nav, a11y (TDD)

**Files:** `apps/web/app/(shell)/platform/ai/operations-map/page.{tsx,test.tsx}`, `apps/web/components/platform/AiOperationsMap.{tsx,test.tsx}`, `apps/web/components/platform/{platform-nav.ts,platform-nav.test.ts,AiTabNav.tsx}`.

- [ ] **`page.test.tsx`:** with `@dpf/db` mocked and `getEffectiveAuthContext` stubbed to a `view_platform`-only user, assert the page heading renders, the software-platform stations render, the inspector is keyboard-reachable from the first station, and no `parameters` payload appears in the DOM. Then re-stub with `view_compliance` and assert the payload does appear.
- [ ] **`AiOperationsMap.test.tsx`:** assert
  - renders with empty projection (no events) — no errors, all stations show "Idle"
  - renders an active tool pulse from a `source: "tool-execution"` projection
  - renders a "BLOCKED" / "DEGRADED" badge with label + shape (not color alone)
  - opens inspector on station / coworker / gate / pulse selection
  - inspector exposes the deep link to `/platform/ai/history?toolExecutionId=...` (or equivalent for receipt / evidence)
  - keyboard: Tab moves between focusable elements in DOM order; Enter / Space activates; Esc closes inspector
  - reduced-motion: with `matchMedia('(prefers-reduced-motion: reduce)')` true, no animation-driving classes are applied; `aria-live="polite"` region still updates with state labels
- [ ] **`platform-nav.test.ts`:** assert the new Operations Map subnav entry exists under the AI Operations section and has `href: "/platform/ai/operations-map"`.
- [ ] Run all three test files; confirm they fail.
- [ ] Add the Operations Map subnav entry to `platform-nav.ts` and the tab to `AiTabNav.tsx`.
- [ ] Implement `page.tsx`: server component that calls `getEffectiveAuthContext`, applies `can(user, "view_platform")` (redirect to `/welcome` if denied), calls `loadProjection`, renders `<AiOperationsMap>`. Do **not** subscribe to SSE in V1 (feature-flagged off; flag default `false` for now).
- [ ] Implement `AiOperationsMap.tsx` with:
  - SVG schematic for lines/stations; `<button>` elements (not `<div onClick>`) for interactivity
  - ARIA: `role="application"` on the map container with `aria-label`, `role="button"` + descriptive `aria-label` on each station/coworker/gate, `role="dialog"` + focus trap on the inspector
  - state classes that map only to existing `--dpf-*` tokens; no inline color
  - reduced-motion guarded by a CSS `@media (prefers-reduced-motion: reduce)` block, not JS
- [ ] Re-run the three test files; they pass.

### Task 4 — Verify (AGENTS.md §5)

- [ ] `pnpm --filter web exec vitest run lib/ai-operations-map app/(shell)/platform/ai/operations-map components/platform/AiOperationsMap` (all new tests pass).
- [ ] `pnpm --filter web typecheck` (clean).
- [ ] `cd apps/web && npx next build` (clean — no TS errors that only surface here).
- [ ] **UX exercise on the running portal** (mandatory for UI work):
  - rebuild + restart the portal containers (per Mark's "no direct sandbox writes" / docker-explicit-approval rules, **list the exact commands and wait for go-ahead** before running them)
  - log in at `/login` with `admin@dpf.local`
  - navigate to `/platform/ai/operations-map`
  - verify orientation test from spec acceptance #1 (which coworkers ran in the last hour and where)
  - verify drill-down test from acceptance #2 (every pulse opens an inspector with working links)
  - tab through the map keyboard-only; activate stations and the inspector with Enter; close with Esc
  - toggle reduced motion in the OS and confirm pulses become static
  - check both light + dark theme (existing branding pipeline)
  - confirm `parameters` payload is absent for a `view_platform`-only seed user
- [ ] **Lint:** run repo lint and the no-hex-colors check; zero violations.
- [ ] **Pre-existing failures:** if vitest / typecheck / next-build reports failures **not introduced by this slice**, file them as separate backlog items with repro steps — do not paper over them, and do not block the merge on them per AGENTS.md §5 unless they are in the affected files.

### Task 5 — Commit, push, PR (AGENTS.md §4)

- [ ] `git status` — confirm no unrelated changes from concurrent sessions.
- [ ] `git add` the specific files listed in §File Structure above. **Do not** use `git add -A` (Mark's worktree feedback: another session can sweep files in).
- [ ] `git commit -s -m "feat(ai): operations map V1 (read-only)"` — DCO sign-off required.
- [ ] `git push -u origin feat/ai-operations-map-v1`.
- [ ] Open the PR via `gh pr create` against `main`. Body must include:
  - link to the spec and this plan
  - the acceptance checklist from the spec, with each item ticked or explicitly flagged
  - the UX exercise summary from Task 4
  - confirmation that no migrations, no new tokens, no new permission keys, no new event discriminants were introduced
- [ ] Tag for `pr-review-toolkit:review-pr` (or wait for ultrareview if Mark prefers to trigger it himself).
- [ ] After approval and merge: `gh pr merge <n> --squash --delete-branch`.

### Task 6 — Backlog hygiene (AGENTS.md §6)

- [ ] Mark the V1 backlog item `done` via `mcp__dpf__update_backlog_item_status`. The epic auto-closes if all items are done; if the epic remains open with items remaining, leave it open.
- [ ] Record execution evidence on the backlog item: `mcp__dpf__record_execution_evidence` with `kind: "ux_verified"` and a one-line summary linking to the merged PR.

---

## Non-Goals (explicit, deferred to V2+)

- Map editing UI.
- Live SSE-driven pulse animation (feature-flagged off in V1).
- Database persistence of map templates / nodes / assignments (code-owned in V1).
- Archetype customization UI beyond the software-platform template.
- Simulation mode.
- In-map writes (policy / grant / routing changes from the inspector).
- New `PERMISSIONS` keys.
- New theme tokens.
- New `AgentEvent` discriminants.
- Managed Service Provider archetype map (planned as the second slice; separate plan).

## Risk Watch (cross-reference to spec §Risks)

- **Parallel event grammar** — guarded by Task 2's exhaustiveness tests. If a reviewer spots a new envelope, fail review.
- **Parallel identity model** — guarded by `load-projection.test.ts` identity assertion.
- **Token / capability drift** — guarded by the "Do NOT modify" list above and the §Non-Goals section. Any PR that touches `globals.css` or `lib/govern/permissions.ts` is out of scope for this slice.
- **Scope creep** — if a reviewer asks for live SSE, simulation, or write actions, defer to V2 rather than expand this PR.
