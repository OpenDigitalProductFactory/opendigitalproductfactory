# Observability Coverage

What the Prometheus/Grafana stack actually monitors, where the gaps are, and which
alert fires on which platform. Written after the 2026-06-24 review ("doesn't
Prometheus catch this?") that found a down voice sidecar — and ~9 of 17 alerts —
were silently unmonitored. Epic: **EP-FULL-OBS**.

## The core principle (why outages were missed)

Prometheus alerts on **"a known scrape target went down"** (`up == 0`), not on
**"a service that should exist is absent."** The `up` series exists only for
configured scrape targets, so:

- A service with **no `/metrics` endpoint** can't be a scrape target → `ContainerDown`
  (`up == 0`) can never see it.
- A service **enabled in config but never instantiated** produces no series at all →
  nothing to alert on.

The fix pattern for `/metrics`-less services: the **portal probes them** and exports
the result as a gauge on its own `/api/metrics` (already a scrape target), plus a
boot-time fail-loud for desired-state drift.

## Scrape targets

`monitoring/prometheus/prometheus.yml` scrapes: `portal`, `sandbox`, `postgres`
(exporter), `redis` (exporter), `qdrant`, `inngest`, `loki`, `alloy`, `windows-host`
(windows_exporter), `prometheus`. **Not scrapeable** (no `/metrics`): `dpf-tts`,
`dpf-stt`, `neo4j`, the model runner (DMR) — covered by portal-side probes below.

## Portal-side health gauges (`/api/metrics`, refreshed per scrape)

| Gauge | Source | Alert |
| --- | --- | --- |
| `dpf_voice_tts_up` / `dpf_voice_tts_enabled` | `lib/voice-synthesis/service-status.ts` | `VoiceServiceDown` (enabled && down) |
| `dpf_dependency_up{service="neo4j"}` | `lib/operate/dependency-health.ts` | `Neo4jDown` |
| `dpf_dependency_up{service="model-runner"}` | same | gauge only (see follow-ups) |
| `dpf_dependency_up{service="stt"}` | same | gauge only (see follow-ups) |
| `dpf_http_unhandled_errors_total` | `instrumentation.ts` `onRequestError` | `UnhandledServerErrors` |

## Platform split — Linux vs Windows host/infra alerts

The `dpf_infrastructure` Container*/Host* rules key on **cAdvisor (`container_*`)**
and **node-exporter (`node_*`)**, both gated behind the `linux-monitoring` compose
profile — so on the **Windows GA host they collect nothing and never fire**. The
`dpf_windows_host` group mirrors the Host CPU/mem/disk rules using **windows_exporter
(`windows_*`)** series, which the `windows-host` job already scrapes. Linux installs
keep the `node_*` rules; Windows installs get the `windows_*` rules.

## Known follow-ups (deliberately not yet done)

- **HTTP latency / error-ratio** (`HighRequestLatency`, `HighErrorRate`) need
  per-request timing+status instrumentation (`dpf_http_request_duration_seconds`,
  `dpf_http_requests_total` are *defined* in `lib/operate/metrics.ts` but never
  `.observe()`d). A route wrapper rollout is the remaining half of **BI-994B504C**;
  `UnhandledServerErrors` (via `onRequestError`) is the zero-route-change interim.
- **model-runner / stt ServiceDown alerts** — gauges ship now; alerting is gated on
  install-type detection (a cloud install has no local model runner), to avoid
  cross-install false positives. Follow-up under EP-FULL-OBS.
- **Per-container restart/CPU/memory on Windows** — needs a cAdvisor-equivalent for
  WSL2 (e.g. an alloy cadvisor exporter); a deployment-doctrine decision.
- **TTS/voice self-heal at boot** — `assertVoiceServiceOnBoot` (BI-264565A4) is
  detection/fail-loud only; auto-starting the sidecar needs host exec.

## Alert delivery

Prometheus has no Alertmanager here; firing alerts reach the portal via the Inngest
poll-bridge (`apps/web/lib/queue/functions/alert-delivery-bridge.ts`) and surface in
the System Health UI. The Grafana dashboard UI is opt-in (`observability-ui` profile).
