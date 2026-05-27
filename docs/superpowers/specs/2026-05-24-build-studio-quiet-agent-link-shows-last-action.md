---
title: Build Studio quiet-agent link should open the last action, not just scroll
date: 2026-05-24
status: proposal — awaiting operator review
owner: Mark Bodman (CEO) — proposed by agent
backlog-item: BI-9A7DA4AC
epic: EP-BUILD-STUDIO
relates-to:
  - docs/superpowers/plans/2026-05-18-build-studio-progress-visibility-overhaul.md (Task 6 Step 4 — original "view last action" requirement)
  - docs/superpowers/specs/2026-05-24-build-studio-dispatch-history-root-cause-display.md (the prior slice that overhauled the dispatch history card — PR #1097)
  - apps/web/components/build/BuildProgressOperationalPanel.tsx (renders the quiet-agent banner + link)
  - apps/web/components/build/BuildDispatchHistoryCard.tsx (the link target — now has expandable per-attempt raw stdout/stderr after PR #1097)
  - apps/web/lib/build/progress-visibility.ts (`quietAgent` projection)
---

# Build Studio quiet-agent link should open the last action

## 1. Problem (from BI-9A7DA4AC)

Live verification on 2026-05-20 against the running portal showed:

- The quiet-agent banner correctly appeared on `/build?buildId=FB-71FB3A53` ("Agent has been quiet for Nm").
- Clicking the **view last action** link inside the banner only anchor-scrolled to `#build-dispatch-history`. It did not open evidence — the operator had to manually expand any raw stdout/stderr to see what the agent last did, AND the most recent attempt was not visually distinguished from older ones.
- The BI describes this as "did not open the last 50 [codex-cli-adapter] / [codex-dispatch] / [agentic-loop] lines retrieved from the server as required by the progress-visibility overhaul brief."

## 2. Source-brief intent

The 2026-05-18 progress-visibility overhaul plan (Task 6 Step 4, line 768) is explicit about what the link should do:

> "The link opens the build's dispatch/activity evidence drawer, **not Docker logs**."

So the brief intends *server-derived evidence already projected into the build's progress visibility view* — not portal-container-process logs. The `[codex-cli-adapter]` / `[codex-dispatch]` / `[agentic-loop]` prefixes in BI-9A7DA4AC's body are how those log lines look in the portal container's stdout, but the brief's resolution is the dispatch/activity data the build already exposes.

## 3. Repo truth (verified 2026-05-24 in this worktree)

- `BuildProgressOperationalPanel.tsx` lines 74-82 render the quiet-agent banner with `<a href="#build-dispatch-history">view last action</a>`. The anchor scrolls to the section but does not expand or highlight anything.
- `BuildDispatchHistoryCard.tsx` (after PR #1097) renders each `BuildDispatchAttempt` as: header, classified-diagnosis line, model, and a collapsed `<details>` containing raw stdout/stderr. The "most recent" attempt is not visually flagged — it just sits last in the list.
- `BuildProgressVisibility.dispatchHistory` (the projection that backs the card) is already ordered `startedAt asc`. The last item is the most recent.
- No `BuildActivity` panel exists in the operational view yet; activity is consumed by other surfaces (chat, audit logs). It is **not** required to satisfy the brief — dispatch attempts alone carry the agent's most recent observable action.
- There is no existing API route that tails container stdout/stderr. Reading `[codex-cli-adapter]` / `[codex-dispatch]` / `[agentic-loop]` lines literally would require Docker socket access + a stream-filter implementation — out of scope for a "small" item.

## 4. Designs evaluated

### Design A — Auto-expand + scroll to the most recent attempt

The `view last action` link becomes a JS-handled link (still progressively enhanced — anchor-scroll fallback if JS off) that:

1. Scrolls to the dispatch history card.
2. Programmatically opens the `<details>` element of the most recent attempt's raw stdout/stderr.
3. Briefly highlights that attempt's row so the operator sees which one was singled out.

- **Pro:** Tiny diff. No new data, no new endpoints, no schema change.
- **Pro:** Leverages the post-#1097 dispatch card directly. The operator sees the diagnosis line first and the raw output is one-click-already-open.
- **Pro:** Falls back cleanly without JS (still scrolls).
- **Pro:** Server-derived evidence — matches the brief's "NOT Docker logs" line.
- **Con:** Doesn't show portal-process logs (the `[codex-cli-adapter]` literal). The BI body names those, but the source brief explicitly excludes them.
- **Verdict:** Recommended.

### Design B — New activity drawer with last 50 events

Add a new "Recent activity" inline drawer beneath the quiet-agent banner that lists the last N entries from `BuildActivity` + `BuildDispatchAttempt` interleaved by timestamp. Link opens the drawer.

- **Pro:** Visually richer.
- **Con:** Requires a new component + a new projection field + new tests. "Small" item turns medium.
- **Con:** The dispatch history card already shows the same data; a drawer is redundant.
- **Verdict:** Reject — duplicates the dispatch history card, scope creep.

### Design C — Server-process log tailing

Add `/api/build/[buildId]/server-logs` that uses the Docker socket to read the portal container's stdout/stderr, filtered by build-id-tagged lines from `[codex-cli-adapter]` / `[codex-dispatch]` / `[agentic-loop]`. Render the last 50 in a panel.

- **Pro:** Literal interpretation of BI body.
- **Con:** The source brief explicitly says "NOT Docker logs."
- **Con:** Requires reading the portal's own logs from inside the portal, which is fragile (recursive container access) and non-portable (Docker-specific).
- **Con:** Log capture isn't structured for filter-by-build-id today; lines tagged `[codex-cli-adapter]` carry the build context only when the build is named in the line.
- **Verdict:** Defer to a separate BI if Mark decides the literal portal-log view is worth the infrastructure cost.

## 5. Recommendation

Ship **Design A**. The operator-visible win is: clicking *view last action* takes you straight to the most-recent attempt's raw output with one motion, the classified diagnosis (added in PR #1097) leads, and the previous attempts stay accessible just below.

If the literal portal-process-log view is still wanted after Design A ships, file a separate BI for Design C with explicit scope around the Docker-socket access and the build-tagging of log lines. Do not bundle it into this slice.

## 6. Specification (Design A)

### 6.1 Make the quiet-agent link interactive

Modify `apps/web/components/build/BuildProgressOperationalPanel.tsx` (lines 74-82):

- Promote the anchor to a clickable element that, in addition to scrolling, dispatches a custom DOM event (`dpf:open-last-dispatch-attempt`) on the document. Keep the `href="#build-dispatch-history"` so behavior with JS disabled is unchanged: the browser handles the anchor scroll natively, and the JS handler runs as a layered enhancement. We never call `preventDefault` — both the scroll and the custom event proceed.

Concrete shape:

```tsx
<a
  className="font-semibold text-[var(--dpf-accent)] underline-offset-2 hover:underline"
  href="#build-dispatch-history"
  onClick={() => {
    if (typeof window === "undefined") return;
    // Fire the custom event; the dispatch history card listens.
    // Anchor scroll behavior is preserved (we do NOT preventDefault).
    document.dispatchEvent(new CustomEvent("dpf:open-last-dispatch-attempt"));
  }}
>
  view last action
</a>
```

### 6.2 Make the dispatch history card listen + react

Modify `apps/web/components/build/BuildDispatchHistoryCard.tsx`:

**Ordering invariant (carry into the implementation):** `BuildProgressVisibility.dispatchHistory` is ordered `startedAt asc` by `getDispatchHistoryForBuild`. The last element is the most recent. The card today already encodes this assumption at line 11 (`const latest = attempts.at(-1) ?? null`). The implementation reuses the same convention — if a future change re-sorts the projection, both the card's existing `latest` lookup and this slice's "most-recent" marker must be revisited together.

- Tag the most-recent attempt's row with `data-most-recent="true"` (no per-row index attribute — there is only one most-recent row, and the card already singles it out at line 11). The flag is set inline during the `attempts.map` by comparing `idx === attempts.length - 1`.
- Add a small `useEffect` (the component is already `"use client"`) that subscribes to `dpf:open-last-dispatch-attempt` on the document and, when fired:
  - Queries the card's DOM subtree for the `[data-most-recent="true"]` row.
  - Finds the `<details>` element inside that row and sets its `open` property to `true`.
  - Sets a `data-just-opened="true"` attribute on the row, and uses `setTimeout(2000)` to remove it. While present, that attribute drives a brief highlight ring via Tailwind's arbitrary-attribute selector (e.g. `data-[just-opened=true]:ring-2 data-[just-opened=true]:ring-[var(--dpf-accent)]`) so the operator can see which attempt was singled out.

The component remains thin — no state machine, just a one-shot effect + a one-shot timeout. Render still works deterministically for SSR (the `data-most-recent` attribute is rendered server-side; the listener and highlight class run client-side only).

### 6.3 Tests

- `BuildProgressOperationalPanel.test.tsx` — assert that clicking the link does NOT call `preventDefault` (so the anchor scroll still works) AND that a `dpf:open-last-dispatch-attempt` event is dispatched on document. Use a `vi.spyOn(document, 'dispatchEvent')` style spy.
- `BuildDispatchHistoryCard.test.tsx` — render the card, dispatch the custom event, assert the most recent attempt's `<details>` element now has `open` set to `true` (jsdom supports the open property on HTMLDetailsElement).
- Both tests live in existing test files; no new test files needed.

### 6.4 What stays unchanged

- The quiet-agent threshold logic in `progress-visibility.ts`.
- The `BuildProgressVisibility` projection shape.
- The `BuildDispatchAttempt` schema, projection, or any API contract.
- Dispatch history card rendering of older attempts (they remain collapsed by default).
- The anchor scroll behavior — the URL hash still updates so the browser back/forward keeps the anchor.

## 7. Non-goals (carry to follow-on BIs if surfaced during review)

- Portal-process log tailing (the literal BI body ask — Design C). File a separate BI if wanted.
- Adding a separate "Recent activity" drawer (Design B).
- Surfacing the same `dpf:open-last-dispatch-attempt` event from anywhere else (only the quiet-agent link uses it today).
- Streaming live attempt updates.
- Auto-opening on render-time (only the explicit user click should open the most recent attempt; otherwise the operator's prior collapse/expand state for older attempts is preserved).

## 8. Verification

Per `feedback_structural_not_functional`:

- Vitest on `BuildProgressOperationalPanel.test.tsx` + `BuildDispatchHistoryCard.test.tsx` — new assertions pass.
- `pnpm --filter web typecheck` — clean.
- On the running Live portal, with a build in a known quiet-agent state: clicking *view last action* scrolls to the dispatch history card AND the most recent attempt's raw stdout/stderr is already expanded.

## 9. Migration / rollback

- No schema change. No data migration.
- Rollback is `git revert` on the two component changes.
- No customer install impact at boot.

## 10. Open decisions

1. **Approve Design A?** Recommendation: yes.
2. **File a follow-on BI for Design C (portal-process-log view)?** Recommendation: yes, but only if you (Mark) still want it after seeing Design A in action.
3. **Use a CustomEvent vs. lift to a shared client state hook?** Recommendation: CustomEvent — simpler, decoupled, no new state library needed. The two components are siblings and not parent/child, so prop drilling isn't an option.

## 11. Definition of done

- Spec reviewed and accepted or revised.
- Plan file under `docs/superpowers/plans/2026-05-24-build-studio-quiet-agent-link-shows-last-action.md`.
- Single PR landing: panel link change + card listener + tests.
- After merge, operator triggers a quiet-agent state on a real build, clicks *view last action*, and confirms the most recent attempt's raw section auto-expands.
- BI-9A7DA4AC closes on merge + post-merge UX confirmation.
