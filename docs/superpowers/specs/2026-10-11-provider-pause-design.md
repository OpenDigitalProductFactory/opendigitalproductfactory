---
status: draft
---
# Operator provider pause

Status: proposed; BI-56F2AB99, EP-75B31C95. Depends on BI-734C1534.

## Objectives

**OBJ-PAUSE:** An operator can immediately veto new local-provider dispatch, indefinitely or for a chosen duration.

**OBJ-RESUME:** Only the current operator pause can expire; health and other independent restrictions remain authoritative.

## Design grounding

Extend AiProviderConnection routing eligibility, ScheduledJob metadata and the owned durable jobs facade. Source: `apps/web/lib/routing/provider-auto-disable.ts`, `apps/web/lib/queue/functions/provider-recovery.ts`, `apps/web/lib/inference/ollama.ts`, `apps/web/lib/ai-inference.ts`, `packages/db/src/provider-connection.ts`. Existing automatic error recovery is a different lifecycle from operator intent. The existing toggle repair is delivered separately so the timed successor cannot delay outage containment.

## Authority, data and runtime

The authorized operator action requires `manage_provider_connections`. Default AiProviderConnection remains the routing veto; its existing string status is `paused` during an operator pause. Routing already admits only active/degraded connections. One ScheduledJob per provider records an operator-pause generation, resume timestamp (nullable for indefinite), actor and prior connection status. These are operational metadata, not entitlement/contract evidence. No schema or install configuration change is needed. Transactional connection writes and job updates serialize pause, change and resume. A timer compares its generation and requires the connection still to be paused under lock; stale events do nothing. Using the whole connection updatedAt as a pause version is rejected: ordinary ownership/label reconciliation updates it without changing the pause. A later disabled/inactive status is an independent veto which expiry must preserve. Legacy toggle mutations invalidate the scheduled pause in the same transaction. Do not overwrite automatic ModelProvider auth/billing/health status when lifting a pause.

Durable sleep provides prompt expiry. A periodic bounded sweep reconciles overdue scheduled pauses after missed delivery or restart; neither path depends on a page visit. Event-send failure leaves the committed pause effective and the sweep can recover it. Expiry on an unhealthy local endpoint restores operator eligibility but leaves health unavailable, with a clear result. Fresh dispatch checks connection eligibility so stale route selections cannot invoke paused local AI. Any late write from automatic recovery must not reopen the connection.

## UX prototype and behavior

Prototype: `docs/superpowers/prototypes/2026-10-11-provider-pause.html`. Advisory UX engagement CE-18EF4499 requested through the specialist service catalog.

Contextual action in the existing provider row/detail, no new navigation. Pause now commits indefinite pause immediately, then reveals optional timing. Until I enable it is the default. After a duration reveals only a positive integer and hours/days. Show the exact resume time in the browser timezone. Resume now and Change pause remain visible while paused; changing to indefinite cancels expiry. Closing settings preserves the already-effective pause. Errors remain inline and never falsely show success. Unconfigured providers remain setup-gated. Existing in-flight work may finish; pausing is not a process kill.

## Research & Benchmarking

- [Alertmanager API model](https://github.com/prometheus/alertmanager/blob/main/api/v2/openapi.yaml): identifiable silences with startsAt/endsAt, rather than conflating suppression with target health. Adopt identity and explicit expiry; reject alert-label matching for a provider control.
- [Uptime Kuma maintenance model](https://github.com/louislam/uptime-kuma/blob/master/server/model/maintenance.js) and [maintenance guide](https://github.com/louislam/uptime-kuma/wiki/Maintenance): manual strategy versus bounded window with explicit state/timezone. Adopt manual/timed distinction; reject recurrence and multi-monitor setup overhead for this single-provider pause.
- [PagerDuty maintenance windows](https://support.pagerduty.com/main/docs/maintenance-windows): immediate bounded maintenance and early ending; existing incidents continue. Adopt immediate stop with clear in-flight semantics, reject assuming maintenance cancels running work.
- [Datadog downtime](https://docs.datadoghq.com/monitors/downtimes/): explicit optional end date and scoped downtime. Adopt visible expiry, reject a separate scheduling dashboard.

Use RFC 3339 UTC timestamps on the wire and localized display. Add no dependencies. Reuse canonical identity/capability checks and current job infrastructure. No host paths, new service boundary or migration. Rejected shortcut: a browser timeout or a timer that sets provider active regardless of current health/operator intent.

## Acceptance

| ID | Objective | Statement |
| --- | --- | --- |
| AC-PAUSE | OBJ-PAUSE | New local inference is vetoed immediately and stays vetoed across health reconciliation and refresh. |
| AC-TIME | OBJ-RESUME | Timed pauses expire durably with visible local resume time; indefinite pauses do not. |
| AC-RACE | OBJ-RESUME | Extension, early resume and later indefinite disable invalidate prior timers, including concurrent expiry. |
| AC-HEALTH | OBJ-RESUME | Expiry preserves independent restrictions and does not send completions to an unhealthy local provider. |

## Compatibility, risks and rollback

Keep the legacy toggle callable for existing remediation clients, with explicit pause/resume services underneath. Preserve existing indefinite disabled connections; do not backfill automatic timers. Limit the first implementation to the local/ollama LLM pause surface. Do not pause unrelated embeddings or kill existing subprocesses in this feature. Rollback leaves paused connections inactive; old runtime can still suffer the original health overwrite until BI-734C1534 is deployed. Job metadata is recognized by kind and generation; unfamiliar metadata never triggers activation. Main risks are lost event delivery, stale expiry and health/operator state conflation; tests and overdue reconciliation target each.
