---
status: active
---

# Operator journey timing: implementation plan

| Field | Value |
| --- | --- |
| Backlog item | `BI-BD0B0DCC` |
| Workroom | `WC-19657C89` |
| Spec | [2026-10-08-operator-journey-timing-design.md](../specs/2026-10-08-operator-journey-timing-design.md) |
| Shape | delivery-medium@1.0.0, atomic |

This plan is atomic. The client queue, the endpoint and the histograms only produce a measurement together. A client with no endpoint drops every sample, and an endpoint with no client records nothing. So no single phase can ship on its own.

## Steps (test first)

1. **Shared vocabulary**: `apps/web/lib/telemetry/journey-vocabulary.ts`.
   - `JOURNEYS`, `WEB_VITAL_METRICS` and `MAX_BATCH = 50` as `as const` lists.
   - `normalizeSection(pathname)`: the first path segment, checked against the top-level segments of the route manifest, otherwise `other`.
2. **Batch parser**: `apps/web/lib/telemetry/parse-journey-batch.ts`.
   - `parseJourneyBatch(body)` returns only valid samples. Unknown names are dropped, as are non-finite values and out-of-range values (durations 0–120 s, CLS 0–10). The batch is capped at 50.
   - Red first: `parse-journey-batch.test.ts`.
3. **Histograms**: in `apps/web/lib/operate/metrics.ts`, add `journeyDuration` (`dpf_journey_duration_seconds{journey,phase}`), `webVitalSeconds` (`dpf_web_vital_seconds{metric,section}`) and `webVitalCls` (`dpf_web_vital_cls{section}`), with the bucket sets from the spec.
4. **Endpoint**: `apps/web/app/api/telemetry/journeys/route.ts` (`POST /api/telemetry/journeys`).
   - Requires a session: 401 otherwise, with the canonical `apiErrorResponse` envelope.
   - Parses the batch with `parseJourneyBatch`, records it, and returns 204.
   - Red first: `route.test.ts` covers 401, dropping invalid samples, the cap of 50, and recording into the registry.
5. **Client queue**: `apps/web/lib/telemetry/journeys.ts`.
   - `beginJourney`, `completeJourney`, `queueWebVital` and `flushTelemetry`.
   - `completeJourney` waits for the first painted frame (double-rAF).
   - `serverMs` is read from `PerformanceResourceTiming.serverTiming` `app`.
   - Flushes with `sendBeacon` on page-hide or at 20 queued samples.
   - Red first: `journeys.test.ts`, with a fake clock, rAF and beacon. It covers one sample per completed journey, a completion with no begin as a no-op, no network call before a flush trigger, and the server phase being attached.
6. **Server-Timing on coworker requests**: `/api/agent/send` and the thread snapshot read emit `Server-Timing: app;dur=<ms>`.
   - Extend the existing send `route.test.ts`.
7. **Hooks into the journeys**:
   - `<PortalVitals />`, a client component using `useReportWebVitals` and `queueWebVital`, mounted in `app/(shell)/layout.tsx`.
   - `shell-ready` completes once, on the shell's first mount.
   - In `AgentCoworkerShell` and `AgentCoworkerPanel`: `coworker-open` (panel open), `thread-open` (thread select) and `message-ack` (send to the `sent` state).
   - Each hook is a begin/complete pair at the existing handlers. No new state, no new render.
8. **Dashboard**: `monitoring/grafana/dashboards/dpf-overview.json` gains a "Portal journeys" row: p75 and p95 per journey, and web-vital p75 with threshold lines.
9. **Baseline (AC-5)**: after the change is deployed to the dev install, drive each journey on the live portal, read the histogram buckets from `/api/metrics`, compute p75 and p95, and record them on EP-B95469DB.

## Traceability

| Requirement | Verification | Contract | Flow | Backlog item |
|---|---|---|---|---|
| OBJ-1 | AC-1 | beginJourney / completeJourney | operator interaction to painted frame | BI-BD0B0DCC |
| OBJ-1 | AC-2 | Server-Timing app;dur | coworker request serves journey | BI-BD0B0DCC |
| OBJ-2 | AC-3 | useReportWebVitals | page load reports vitals | BI-BD0B0DCC |
| OBJ-3 | AC-4 | dpf_journey_duration_seconds | samples reach Prometheus | BI-BD0B0DCC |
| OBJ-3 | AC-5 | /api/metrics | samples reach Prometheus | BI-BD0B0DCC |
| OBJ-4 | AC-6 | POST /api/telemetry/journeys | samples reach Prometheus | BI-BD0B0DCC |
| OBJ-4 | AC-7 | flushTelemetry | operator interaction to painted frame | BI-BD0B0DCC |

## Risks and rollback

- **Cardinality.** Closed vocabularies and an allowlisted section bound the label space; the parser tests prove it. Rollback is reverting the PR. The histograms then simply stop growing, with no data migration.
- **Interaction-path cost.** AC-7's test asserts no synchronous network call on begin or complete. Overhead is one mark, one rAF and one push per journey.
- **Telemetry outage.** The beacon is fire-and-forget, and the UI never waits on it.
