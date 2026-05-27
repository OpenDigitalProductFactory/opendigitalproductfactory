# Build Studio quiet-agent link — implementation plan (BI-9A7DA4AC)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make the "view last action" link in the Build Studio quiet-agent banner auto-open the most-recent dispatch attempt's collapsed `<details>` (added in #1097) plus briefly highlight that row, while preserving the existing anchor-scroll behavior so the no-JS fallback still works.

**Architecture:** Two small component touches connected by a custom DOM event (`dpf:open-last-dispatch-attempt`). `BuildProgressOperationalPanel` dispatches the event on link click; `BuildDispatchHistoryCard` listens via a `useEffect` and reacts by opening its `<details>` for the row marked `data-most-recent="true"` and toggling a `data-just-opened="true"` attribute (auto-removed after 2 seconds) that drives a highlight ring. No projection change, no API change, no schema change.

**Tech Stack:** Next.js 15 / React / TypeScript / Vitest / jsdom / pnpm.

**Spec:** [`docs/superpowers/specs/2026-05-24-build-studio-quiet-agent-link-shows-last-action.md`](../specs/2026-05-24-build-studio-quiet-agent-link-shows-last-action.md) (BI-9A7DA4AC, EP-BUILD-STUDIO).

---

## Hard constraints (carried from spec §7)

- No projection change in `apps/web/lib/build/progress-visibility.ts`.
- No new API route, no Docker-log tailing (Design C is filed as a follow-on BI if Mark still wants it).
- No schema change.
- No new "recent activity" drawer (Design B rejected — duplicates the dispatch card).
- The anchor scroll behavior MUST be preserved (no `preventDefault`).
- The custom event MUST only fire from the quiet-agent link, not from anywhere else in the panel.
- Auto-open MUST only happen on explicit user click — never on render. Older attempts stay collapsed.

Scope-violation check (before push): `git diff origin/main --stat` should touch only:
- `apps/web/components/build/BuildProgressOperationalPanel.tsx`
- `apps/web/components/build/BuildProgressOperationalPanel.test.tsx`
- `apps/web/components/build/BuildDispatchHistoryCard.tsx`
- `apps/web/components/build/BuildDispatchHistoryCard.test.tsx`
- `docs/superpowers/specs/2026-05-24-build-studio-quiet-agent-link-shows-last-action.md` (already committed)
- `docs/superpowers/plans/2026-05-24-build-studio-quiet-agent-link-shows-last-action.md` (this file)

---

## Task 1 — Make the dispatch card listen + react

**Files:**
- Modify: `apps/web/components/build/BuildDispatchHistoryCard.tsx`

**Step 1: Add `data-most-recent` flag inline.**

Inside the `attempts.map((attempt, idx) => …)` block (line 22), add an `isMostRecent` const and pass it through `data-most-recent`. The row div also gains the highlight-driven attribute selector classes.

**Step 2: Add the listener.**

A small `useEffect` subscribed to `document.addEventListener("dpf:open-last-dispatch-attempt", …)`. On fire:
- Use a `useRef` on the `<section>` so the query scope is the card, not the whole document (so a panel that renders two cards — unlikely, but cheap to guard — doesn't double-open).
- Query `[data-most-recent="true"]` inside that ref. If found, set `details.open = true` on the contained `<details>` element. Also set `data-just-opened="true"` on the row, and call `setTimeout` to remove it after 2000ms. Capture the timeout id and clear it in the effect's cleanup.

**Step 3: Add the highlight class.**

Use Tailwind's arbitrary-attribute selector on the row div:
`data-[just-opened=true]:ring-2 data-[just-opened=true]:ring-[var(--dpf-accent)] data-[just-opened=true]:ring-offset-2 data-[just-opened=true]:ring-offset-[var(--dpf-surface-1)]`

**Step 4: Component imports.**

Add `useEffect, useRef` to the React import line (`import { useEffect, useRef } from "react";` — separate line since the file currently has no React import at all).

**Step 5: Typecheck.**

```bash
pnpm --filter web typecheck
```

Expected: clean.

---

## Task 2 — Make the quiet-agent link dispatch the event

**Files:**
- Modify: `apps/web/components/build/BuildProgressOperationalPanel.tsx` (lines 78-80)

**Step 1: Add the onClick handler.**

Promote the `<a>` to include `onClick={() => { … }`. The handler dispatches a `CustomEvent("dpf:open-last-dispatch-attempt")` on `document`. We do NOT call `preventDefault` — the browser anchor scroll continues.

Guard with `if (typeof window === "undefined") return;` so the (server-rendered) build does not blow up if React ever calls the handler during hydration with the document undefined.

**Step 2: Typecheck.**

```bash
pnpm --filter web typecheck
```

Expected: clean.

---

## Task 3 — Tests (TDD pair — written after impl since both halves are tiny)

**Files:**
- Modify: `apps/web/components/build/BuildDispatchHistoryCard.test.tsx`
- Modify: `apps/web/components/build/BuildProgressOperationalPanel.test.tsx`

**Step 1: Card tests.**

Append to the existing `describe("BuildDispatchHistoryCard — root-cause display (BI-594B76AB)", …)` block, OR a new sibling block `describe("BuildDispatchHistoryCard — open-last-attempt event (BI-9A7DA4AC)", …)`:

- Test A: rendering the card stamps `data-most-recent="true"` on the row of the LAST attempt and not on earlier attempts.
- Test B: dispatching `dpf:open-last-dispatch-attempt` on `document` flips the most-recent row's `<details>` `open` property to `true`.
- Test C: dispatching the event sets `data-just-opened="true"` on the most-recent row. (Don't try to time-travel for the 2s removal — that's a setTimeout side effect and jsdom's fake timer support is overkill for this scope.)
- Test D: dispatching the event with zero attempts in the card is a no-op (no error, no crash).

Use `render` from `@testing-library/react` (already imported in this file) + the existing `attempt()` factory. Dispatch events via `document.dispatchEvent(new CustomEvent("dpf:open-last-dispatch-attempt"))`.

**Step 2: Panel tests.**

Inspect `BuildProgressOperationalPanel.test.tsx` to find its existing pattern, then add:

- Test E: when `projection.quietAgent.quiet === true`, clicking the "view last action" link dispatches a `dpf:open-last-dispatch-attempt` event on `document` and does NOT call `preventDefault`. Use `vi.spyOn(document, "dispatchEvent")` to capture, and assert the link's default action wasn't suppressed (assert via `MouseEvent.defaultPrevented === false` after the click, or simply assert the spy was called with a `CustomEvent` of the right type).

**Step 3: Run touched tests.**

```bash
pnpm --filter web exec vitest run components/build/BuildDispatchHistoryCard.test.tsx components/build/BuildProgressOperationalPanel.test.tsx
```

Expected: all new assertions pass; no existing assertions regress.

**Step 4: Broader test slice.**

```bash
pnpm --filter web exec vitest run lib/build components/build
```

Expected: green.

---

## Task 4 — Final verification + push + PR

**Step 1: Typecheck.**

```bash
pnpm --filter web typecheck
```

**Step 2: Scope-violation diff.**

```bash
git diff origin/main --stat
```

Confirm only the 6 expected files (4 code/test + 2 spec/plan docs).

**Step 3: Overlap sweep.**

```bash
git fetch origin main --quiet
git log origin/main --oneline -10 --grep="quiet.agent|BI-9A7DA4AC|view.last.action" -i
gh pr list --state open --limit 30 --json number,title --jq '.[] | select(.title | test("quiet.agent|9A7DA4AC|view.last.action"; "i")) | .title'
```

Expected: no overlap.

**Step 4: Push.**

```bash
git push -u origin claude/quiet-agent-link-last-action
```

**Step 5: Open PR.**

Title: `feat(build-studio): quiet-agent link opens the last action (BI-9A7DA4AC)`

Body includes spec + plan links, what changes, what stays unchanged, the two-line summary of the operator-visible behavior, the in-merge test counts, and the post-merge UX check ("trigger a quiet-agent state on a real build; click 'view last action'; the most recent dispatch attempt's Raw stdout/stderr is already expanded and the row is briefly ringed").

---

## Done-criteria

- Single PR landing 4 file changes + spec + plan.
- All new tests pass; no regressions.
- Anchor-scroll fallback still works without JS (no `preventDefault` was added).
- BI-9A7DA4AC closes on merge + post-merge UX confirmation.
