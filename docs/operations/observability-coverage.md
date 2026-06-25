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

## Status & decisions (2026-06-25 — objective completed)

- **model-runner / stt alerts** — DONE. `ModelRunnerDown` / `SttDown` fire on
  `dpf_dependency_up{service} == 0 and max_over_time(...[6h]) == 1` — i.e. only when
  a service that was working in the last 6h drops. Install-agnostic, so a cloud
  install that never runs a local model runner / STT never false-fires.
- **Restart-loop detection (all platforms)** — DONE via `ServiceFlapping`
  (`changes(up[15m]) > 5`), which catches a crashing+recovering scraped service
  (the qdrant loop `ContainerRestarting` missed) using the `up` series.
- **Per-container CPU/memory + restart_count on Windows** — NOT POSSIBLE, by
  platform constraint. cAdvisor/node-exporter require `/proc`, `/sys`,
  `/var/lib/docker` host mounts that Docker Desktop (WSL2/macOS) does not provide
  (see the `monitoring/alloy/config.alloy` header — exactly why log capture uses
  the socket, not bind mounts). The `dpf_infrastructure` Container*/Host(`node_*`)
  rules remain for Linux installs; Windows is covered by `dpf_windows_host` (host)
  + `up`-based `ContainerDown` / `ServiceFlapping` + the portal-side
  `dpf_dependency_up` / `dpf_voice_tts_*` probes.
- **HTTP latency / error-ratio alerts** — RETIRED (BI-994B504C). `HighRequestLatency`
  / `HighErrorRate` keyed on per-request metrics Next App Router cannot populate
  without a shared route wrapper (none exists in DPF) or a custom server — a
  separate architecture decision, unsafe to retrofit blind. Removed rather than
  left as permanently-dead rules. Error detection is `UnhandledServerErrors`
  (`onRequestError`); AI latency is `AIInferenceHighLatency`. Re-add with real
  per-request instrumentation if general HTTP SLOs are ever needed.
- **TTS/voice runtime self-heal** — BY DESIGN NOT DONE (BI-264565A4).
  `assertVoiceServiceOnBoot` detects + fails loud at boot; auto-*starting* the
  sidecar would require the portal to exec host Docker, crossing the portal's
  security/governance boundary. First-run actuation is owned by the installer
  (BI-3C812E4E, GPU-gated auto-start); a governed runtime host-action rail is the
  proper future path if runtime auto-recovery is ever wanted.

## Alert delivery

Prometheus has no Alertmanager here; firing alerts reach the portal via the Inngest
poll-bridge (`apps/web/lib/queue/functions/alert-delivery-bridge.ts`) and surface in
the System Health UI. The Grafana dashboard UI is opt-in (`observability-ui` profile).
