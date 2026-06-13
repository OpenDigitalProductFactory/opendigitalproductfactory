---
title: Observability — the three signals
pageKind: summary
status: published
abstract: Observability is understanding a system from the outside via its telemetry. The three signals are traces (a request's path), metrics (aggregated numbers over time), and logs (timestamped messages). OpenTelemetry is the vendor-neutral framework for them.
professionCompetencyLevel: practitioner
sources:
  - opentelemetry/observability-primer
---

## What Observability Is

**Observability** lets you "understand a system from the outside…without knowing its inner workings" — by examining the telemetry it emits. A system you cannot observe, you cannot operate or debug under pressure.

## The Three Signals

- **Traces** record the path of a single request as it propagates through multiple services. A **span** is one unit of work; **distributed tracing** stitches spans across services.
- **Metrics** are aggregated numeric data over time — error rates, CPU, request volume.
- **Logs** are timestamped messages emitted by services, usually not tied to a specific request.

**OpenTelemetry** is a vendor-neutral, open-source (CNCF) framework for generating and exporting all three signals, so instrumentation is not locked to one backend.

## How DPF Coworkers Use It

- Instrument for all three signals; rely on traces to localize, metrics to detect, logs to explain.
- Metrics feed the SLIs behind [[professions/operations/sli-slo-error-budget]].
- Detection in the [[professions/operations/incident-response-lifecycle]] depends on these signals being present.

## See Also

- [[professions/operations/incident-response-lifecycle]]
- [[professions/operations/sli-slo-error-budget]]
