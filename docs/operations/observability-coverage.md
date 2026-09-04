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
| `dpf_coworker_envelopes_awaiting_decision` | `lib/coworker/envelope-observability.ts` | gauge only |
| `dpf_coworker_envelopes_expired_unactioned` | same | see below — worth an alert |

TTS probe contract (BI-7988DAD8): the probe requests `GET <DPF_TTS_URL>/health`
and falls back to the base URL when `/health` 404s, because sidecars provisioned
before the `/health` alias existed serve their health check at `/` only — a 404
means "reachable, wrong path", not "down". Both the portal AND the sandbox
export these gauges, so `docker-compose.macos.yml` sets the host-native
`DPF_TTS_URL` on both services; without it the sandbox probes the base
compose's `dpf-tts:8000` default (never running on macOS) and fires a phantom
`VoiceServiceDown{job="sandbox"}`.

### Coworker approval envelopes (BI-78D3CF1E)

A `CoworkerActionEnvelope` is a coworker asking one named human to approve one
side-effecting call. It expires 15 minutes after it is raised, and an envelope
nobody answers transitions to nothing — no alert, no error, no row anywhere an
operator looks. Seven lapsed unactioned on a live install before an approval
surface existed, and the only way to learn that was to read the table.

`dpf_coworker_envelopes_expired_unactioned` is the one to watch, and it cannot be
derived from the obvious query: an expired envelope STILL reads
`status = "proposed"`, because nothing rewrites it when the window closes. A
naive proposed-count therefore reports blocked coworkers nobody can unblock.

Both are gauges, not counters — they are observed when the owner attention inbox
renders, so a counter would multiply by however often someone looks at the page.
That also means the figures refresh only while somebody is using the portal; a
persistently non-zero expired count is the signal, not its exact update moment.

A failed count publishes NOTHING rather than a zero, because a fabricated zero
reads as "nothing is lapsing" — the exact false comfort the metric removes.

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

## New-alert checklist — a detector is a feature; verify it functionally

The phantom-VoiceServiceDown incident (BI-7988DAD8): the probe requested
`/health`, the sidecar served `/`, the probe's unit tests mocked the server and
asserted the wrong path back to itself, the sidecar had no CI-run tests, and the
alert fired for weeks on a healthy install while voice synthesis WORKED the
whole time. The detector shipped as part of the fix for the previous incident
(voice dead a month while the page said "ready", BI-B2E777EB) — a false-OK was
traded for a false-ALARM because the detector itself was never functionally
verified. Before merging any new alert or portal-side probe:

1. **Prove it fires**: induce the failure on a live install (stop the service)
   and watch the alert reach `firing` end-to-end (gauge → rule → header dot).
2. **Prove it clears**: restore the service and watch it resolve. A detector
   that was never seen GREEN against the real counterpart is unverified.
3. **Never mock the counterparty's contract**: unit tests that stub the probed
   service encode your assumption, not its API. Pin cross-component/
   cross-language contracts with a source-level guard test
   (`apps/web/lib/voice-synthesis/tts-health-contract.test.ts` is the pattern)
   or probe an endpoint the real feature path already uses.
4. **Check every gauge exporter**: portal AND sandbox export the portal-side
   gauges; env wiring (compose overlays) must cover both or the second instance
   fires a phantom.

## Alert delivery

Prometheus has no Alertmanager here; firing alerts reach the portal via the Inngest
poll-bridge (`apps/web/lib/queue/functions/alert-delivery-bridge.ts`) and surface in
the System Health UI. The Grafana dashboard UI is opt-in (`observability-ui` profile).
