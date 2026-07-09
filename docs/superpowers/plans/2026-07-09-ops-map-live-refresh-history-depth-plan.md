# Ops Map live refresh + timeline history depth — implementation plan

- **Date:** 2026-07-09
- **Backlog items:** BI-44D3203D (live refresh), BI-40EFC7DE (history depth)
- **Epic:** EP-B9DD37C7 (runtime truthfulness, transparency & controls — extended from chat surfaces to the platform Ops Map; rationale recorded at filing)
- **Kernel decision:** `principle_decide` scoped this as two separable BIs delivered together (high confidence, margin 0.69); operator directed delivery outside Build Studio in-session.

## Problem

The `/platform/ai/operations-map` provider routing topology labels itself
"LIVE ROUTING TRAFFIC" but was a one-shot server snapshot: no polling, no
SSE, no re-fetch — the canvas animates a static payload. Separately, every
evidence source was capped at its newest 40 rows (`RECENT_TOOL_LIMIT`), so
the replay timeline claimed a multi-week span while rendering only the last
hours-to-days of events; the live DB held ~15k route outcomes / ~1.4k route
decisions since 2026-06-08 that the surface silently discarded.

## Shape

**Phase 1 — windowed loader (BI-40EFC7DE), `apps/web/lib/ai-operations-map/load-map-data.ts`:**

- `loadOperationsMapData(options?: { window?: { start; end } })` — when a
  window is given, every time-anchored evidence query filters to it
  (`createdAt` / `startedAt` / `recordedAt`) and the per-source cap rises
  from `RECENT_TOOL_LIMIT` (40) to `WINDOWED_SOURCE_LIMIT` (400), newest-first
  within the window. A dense window degrades to "newest 400 inside the
  window", never an unbounded payload. Raw route-decision traces never leave
  the server — projectors distill them — so the budget bounds marker count,
  not trace bytes.
- The stalled-TaskRun lift (BI-OPS-MAP-STALLED-WINDOW) and forecast sources
  (scheduled tasks/jobs) stay unwindowed by design.
- New `evidenceRange` (global min/max across the five main evidence tables,
  via aggregates) and `queriedWindow` fields on `OperationsMapData`;
  `recentWindowLabel` reflects the actual query shape.

**Phase 2 — refresh API:** `GET /api/platform/operations-map[?start&end]`
(`apps/web/app/api/platform/operations-map/route.ts`). Auth mirrors the
platform shell layout gate (`auth()` + `can(view_platform)`, 404 posture).
Window params accept ISO-8601 or epoch-ms; both-or-neither; 400 on invalid.

**Phase 3 — live shell (BI-44D3203D), `apps/web/components/platform/OperationsMapLiveShell.tsx`:**

- Wraps `AiOperationsMap` on the page; polls the API every 45s, paused while
  the tab is hidden and held off 5s after a scrub; re-fetches on tab
  re-focus when stale; manual "Refresh now"; last-refreshed indicator in a
  sibling component so its ticker doesn't re-render the map tree.
- Scrub/zoom to a materially different replay window re-fetches with that
  window (600ms settle debounce), giving the timeline true history depth.
- Feedback-loop guards: the panel republishes its window after every data
  swap, so swap-echo publishes are ignored for 1.2s and only materially
  different windows (>max(60s, 5% of span) edge delta) re-fetch; the base
  timeline range is anchored to the global `evidenceRange` so windowed
  payloads can't shrink the scrubber (shrink → narrower fetch → shrink).
- Live-edge follow: when the fetched window reaches "now", poll refetches
  slide its end forward (+60min forecast pad) so new events land in-window.

**Phase 4 — honest timeline:** `AiOperationsMap` gains optional
`evidenceRange` / `onReplayWindowChange` props; `buildTimelineRange` pins the
base range to the global evidence bounds; a dashed "Data begins" boundary
marker renders at the earliest evidence timestamp (this install: 2026-06-08),
so the scrubber no longer implies history that predates the data.

## Verification

- Unit: windowed query shapes + caps, `resolveEvidenceRange` folding,
  route param validation + auth gate, `windowMateriallyDiffers` /
  `formatRefreshAge` (all in sibling `.test.ts` files).
- Functional: drive `/platform/ai/operations-map` on the contributor
  preview — observe auto-refresh tick, scrub-to-history fetch, boundary
  marker.

## Out of scope

- SSE/WebSocket push (poll is the substrate-lighter first step; the API
  contract doesn't preclude swapping the transport later).
- Retention/archival policy; A2A band re-windowing beyond what the shared
  replay window already provides.
