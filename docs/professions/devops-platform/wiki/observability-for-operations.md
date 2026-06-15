---
title: Observability for operations
pageKind: summary
status: published
abstract: Observability lets you understand a system from its telemetry without knowing its internals — through the three signals (traces, metrics, logs). It is the input to detection and to the DORA failed-deployment recovery-time metric.
professionCompetencyLevel: practitioner
sources:
  - opentelemetry/observability-primer
  - dora/four-keys
---

## What It Is

**Observability** lets you "ask questions about [a] system without knowing its inner workings" — by examining the telemetry it emits. For platform operations it is what turns an incident from a guessing game into a query.

## The Three Signals

- **Metrics** — aggregations over time of numeric infrastructure/application data.
- **Traces** — record a request's path "as it propagates through multiple services."
- **Logs** — timestamped messages, most useful when correlated with traces/spans.

OpenTelemetry is the vendor-neutral (CNCF) framework for emitting all three.

## Why It Matters for DevOps

Observability is the **input to recovery**: you cannot minimize the DORA failed-deployment recovery time if you cannot see what broke. Metrics gate and verify deploys; traces localize; logs explain.

## How DPF Coworkers Use It

- Instrument for all three signals; rely on them to detect and to drive [[professions/devops-platform/dora-four-key-metrics]] (recovery time).
- Observability signals verify each [[professions/devops-platform/deployment-pipeline-and-rollback]].

## See Also

- [[professions/devops-platform/dora-four-key-metrics]]
- [[professions/devops-platform/deployment-pipeline-and-rollback]]
