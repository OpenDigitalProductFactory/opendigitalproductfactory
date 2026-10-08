---
status: active
---

# Operator journey timing

| Field | Value |
| --- | --- |
| Backlog item | `BI-BD0B0DCC` |
| Epic | `EP-B95469DB` — Portal speed: measure the operator journey first, then ratchet every win |
| Date | 2026-10-08 |
| Profile | Feature |
| Owning area | Platform operations / portal shell |

## Problem

The portal cannot measure its own speed, so nobody can tell whether a change made it faster or slower.

- No browser timing is reported. The portal has no Core Web Vitals, no INP, no CLS, and no interaction-to-rendered timing.
- `dpf_http_request_duration_seconds` is declared in `apps/web/lib/operate/metrics.ts` but nothing records it. `monitoring/prometheus/alerts.yml:133-140` retired the latency alerts for exactly that reason: App Router has no per-request hook.
- The budgets in [the operations and performance views spec](2026-07-28-business-operations-and-performance-views-design.md) §244-262 (INP p75 ≤ 200 ms, visible response ≤ 100 ms, decision surface p75 ≤ 2.5 s) cannot be checked.
- The frontend-engineer [performance procedure](../../professions/frontend-engineer/wiki/performance-budgets-core-web-vitals.md) (BI-AF9AC95A) says to measure the journey before changing anything. Today there is nothing to measure with.

## Objectives

**OBJ-1:** Measure the four core operator journeys from the user's interaction to the rendered result, and record the server's share separately from the total.

**OBJ-2:** Report Core Web Vitals (LCP, INP, CLS, FCP, TTFB) for every portal page at low label cardinality, without adding a dependency.

**OBJ-3:** Make the measurements visible: the portal's Prometheus endpoint exposes them, and the Grafana overview shows p75 and p95 per journey.

**OBJ-4:** Telemetry must cost the operator nothing measurable, and must not become an unauthenticated write path.

## Design grounding

This design extends, rather than replaces, the following:

- `apps/web/lib/operate/metrics.ts`: the single prom-client registry, scraped at `/api/metrics`. The new histograms join it. No second registry or exporter is added.
- `apps/web/app/api/metrics/route.ts`: the existing scrape endpoint and its public-host refusal. It is unchanged.
- `monitoring/grafana/dashboards/dpf-overview.json`: the existing overview dashboard. A "Portal journeys" row is added there rather than in a new dashboard.
- `apps/web/app/api/operations/snapshot/route.ts`: the existing `Server-Timing` pattern. The journey endpoints reuse the header shape.
- `apps/web/lib/twin/operations-telemetry.ts`: the one existing client `performance.mark/measure` site. Its marks stay, and this design supplies the reporting path that site never had.
- `apps/web/app/(shell)/layout.tsx` mounts `AgentCoworkerShell` persistently. The coworker journeys hook there.

No schema, migration, route page or UI surface is added. The only new route is `POST /api/telemetry/journeys`.

## Research and benchmarking

| Option | What it is | Adopt / reject |
| --- | --- | --- |
| `web-vitals` (Google Chrome team, Apache-2.0) | The reference implementation of LCP, INP, CLS, FCP and TTFB, including INP's interaction grouping. | **Adopt the standard, not the package.** Next.js 16 ships it as `next/web-vitals` (`useReportWebVitals`), already in the lockfile. Re-implementing INP with PerformanceObserver gets interaction grouping wrong. |
| OpenTelemetry Browser SDK / RUM | Spans for document load, fetch and user interaction, exported over OTLP. | **Reject for now.** It is a new dependency tree plus an OTLP collector path for the browser. DPF's `@opentelemetry/api` use is for device data, and Alloy is not configured for browser OTLP. The journey vocabulary below maps cleanly onto spans if this is revisited. |
| Vercel Speed Insights / Sentry Performance | Hosted RUM that sends vitals to a vendor. | **Reject.** DPF installs are sovereign and on-premises. Sending operator telemetry to a vendor breaks that, and the cost-axis `vendor_lock_in` applies. |
| User Timing API (`performance.mark/measure`) | W3C standard for custom timing. | **Adopt** for journeys, with marks at the interaction and at the frame after render. |
| `Server-Timing` header (W3C) | Server-reported phase durations, readable in the browser via `PerformanceResourceTiming.serverTiming`. | **Adopt** for the server share. The pattern already exists in `api/operations/snapshot`. |

Standards followed: Web Vitals thresholds (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75), W3C User Timing Level 3, W3C Server Timing, and Beacon API for unload-safe delivery.

## Proposed design

### 1. Journey vocabulary (closed)

| Journey | Starts | Ends |
| --- | --- | --- |
| `shell-ready` | Navigation start (`performance.timeOrigin`) | First frame painted after the shell layout hydrates |
| `coworker-open` | The commit that opens the coworker panel (a layout effect, within a frame of the click) | First frame painted with the panel's thread ready |
| `thread-open` | The start of a thread load (opening the panel, or a route change that switches the coworker's thread context) | First frame painted with that thread ready |
| `message-ack` | The send action in the composer | First frame painted with the bubble in `sent` state (since BI-DEFA25EE this means the server has stored it) |

"First frame painted" means a `requestAnimationFrame` callback followed by a macrotask (double-rAF). This is the standard way to measure to the frame after commit, not to the commit.

The vocabulary is a closed `as const` list shared by client and server. An unknown name is dropped server-side, never stored as a label.

### 2. Client: `apps/web/lib/telemetry/journeys.ts`

- `beginJourney(name)` records a `performance.mark` and the start time. `completeJourney(name, { serverMs? })` waits for the next painted frame, measures, and queues a sample. Calling `completeJourney` without a live `beginJourney` is a no-op, so a stray call cannot invent a sample.
- `serverMs` comes from the `Server-Timing` `app;dur=` entry of the fetch that served the journey, read from `PerformanceResourceTiming.serverTiming`. If the browser exposes no entry, the sample carries total time only.
- Web vitals: a `<PortalVitals />` client component in the shell layout calls `useReportWebVitals` and queues `{metric, value, section}`.
- `section` is the first path segment (`/workspace/inbox` becomes `workspace`). That gives fewer than 30 values, and the server checks it against the route manifest's top-level segments.
- Delivery is queued and flushed with `navigator.sendBeacon` on `visibilitychange: hidden` and `pagehide`, or once 20 samples are waiting. There is one request per flush, off the interaction path. Telemetry failure is silent and never surfaces to the operator.

### 3. Server: `POST /api/telemetry/journeys`

- The caller must be authenticated (session required). Without a session the route answers 401 and records nothing. It sits behind the existing proxy.
- The body is validated by a pure function, `parseJourneyBatch`:
  - at most 50 samples;
  - journey and metric names come from the closed lists;
  - `section` comes from the allowlist, and anything else becomes `other`;
  - durations are finite and within 0–120 s;
  - CLS is within 0–10.
- Invalid samples are dropped individually. The response is `204`.
- It records into the existing registry:
  - `dpf_journey_duration_seconds{journey, phase}`, a histogram where `phase` is `total` or `server`. Buckets are `0.05 0.1 0.2 0.3 0.5 0.75 1 1.5 2.5 4 6 10 20`.
  - `dpf_web_vital_seconds{metric, section}`, a histogram for LCP, INP, FCP and TTFB.
  - `dpf_web_vital_cls{section}`, a histogram with buckets `0.01 0.025 0.05 0.1 0.15 0.25 0.5 1`.
- Label cardinality is bounded: 4 journeys × 2 phases, 4 metrics × ~30 sections, and ~30 sections for CLS.
- The send route (`/api/agent/send`) emits `Server-Timing: app;dur=<ms>`. This gives `message-ack` its server share. The thread snapshot is read through a server action, which has no response header to carry a timing, so `thread-open` and `coworker-open` report total time only. Their server share comes once those reads move to a route.

### 4. Visibility

- `/api/metrics` exposes the new histograms. This is unchanged scrape behavior, with no new target.
- `dpf-overview.json` gains a "Portal journeys" row with two panels:
  - p75 and p95 by journey (`histogram_quantile` over `rate(...[15m])`);
  - web-vital p75 by metric, with threshold lines at the Web Vitals budgets.
- On an install without the monitoring profile, the same numbers can be read from `/api/metrics` buckets. The baseline procedure in the plan uses that path, so it works on every install.

### 5. Rejected alternatives inside DPF

- Recording into `dpf_http_request_duration_seconds` through middleware was rejected. The proxy runs before routing and cannot see handler completion, which is the very gap that retired the alerts. The client-observed journey is the honest measure.
- Storing samples in Postgres was rejected. These are operational metrics with no governance value per row, so Prometheus is their system of record.

## Failure analysis

| Scenario | Effect | Prevention / containment |
| --- | --- | --- |
| Telemetry endpoint down or slow | Samples lost | The beacon is fire-and-forget and the UI never waits on it. Lost samples only thin the histogram. |
| Malicious or buggy client floods labels | Prometheus cardinality blow-up | Closed vocabularies with an allowlisted `section`. Unknown values are dropped or become `other`. A batch holds at most 50 samples. |
| Unauthenticated writes | Skewed metrics | 401 without a session. Public-host requests reach the route only with a session. |
| Measurement adds main-thread work | The slowdown we set out to catch | No work runs on keystrokes. Each journey is one mark, one rAF and one queue push. The flush is batched. A test asserts no synchronous network call on the interaction path. |
| Journey begun but never completed (navigation away) | Dangling start | The start is discarded on the next `beginJourney` of the same name, or on flush. Nothing is reported. |

## Objective and acceptance manifest

| ID | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | Each of the four journeys emits exactly one sample per completed interaction. Its total is measured from the interaction mark to the first painted frame after render, proven by unit tests with a controlled clock and rAF. |
| AC-2 | OBJ-1 | `message-ack` samples carry a `server` phase taken from the `/api/agent/send` response's `Server-Timing` `app;dur=` value, and that route emits the header. |
| AC-3 | OBJ-2 | LCP, INP, CLS, FCP and TTFB are reported for every page through `next/web-vitals`, labelled only by an allowlisted top-level section. No new package is added to the lockfile. |
| AC-4 | OBJ-3 | `/api/metrics` exposes `dpf_journey_duration_seconds`, `dpf_web_vital_seconds` and `dpf_web_vital_cls` after samples are posted. The Grafana overview carries a "Portal journeys" row with p75 and p95 per journey. |
| AC-5 | OBJ-3 | On the dev install, all four journeys have a measured p75/p95 baseline recorded on EP-B95469DB. |
| AC-6 | OBJ-4 | `POST /api/telemetry/journeys` returns 401 without a session. It drops unknown journey, metric and section values and out-of-range durations, accepts at most 50 samples, and returns 204. |
| AC-7 | OBJ-4 | Beginning and completing a journey performs no synchronous network call and no work per keystroke. The flush happens only on page-hide or when the queue holds 20 samples. |
