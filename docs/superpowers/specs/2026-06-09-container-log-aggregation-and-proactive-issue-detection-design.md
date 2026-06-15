# Container Log Aggregation & Proactive Issue Detection (EP-FULL-OBS Tier 2)

**Date:** 2026-06-09
**Status:** Draft
**Epic:** EP-FULL-OBS (Full Observability) — this is the **Tier 2 — Log Aggregation** spec explicitly deferred in `docs/superpowers/specs/2026-04-01-platform-operational-health-monitoring-design.md` §1.2.
**Author:** Claude (design partner) + Mark Bodman (CEO)
**Depends on:**
- `docs/superpowers/specs/2026-04-01-platform-operational-health-monitoring-design.md` (Tier 1 metrics stack: Prometheus, Grafana, alert→PortfolioQualityIssue webhook, System Health tab, `PlatformHealthIndicator`)
- `apps/web/lib/quality/platform-issue-reports.ts` (`createPlatformIssueReport()` — the single PIR writer)
- `apps/web/lib/queue/functions/token-expiry-monitor.ts` (canonical Inngest cron-monitor pattern: `gateAtEntry` quiescence gate + exported pure scan logic + idempotent `PlatformNotification` upsert)

**IT4IT Alignment:** SS5.7 Operate — Detect to Correct. Extends the **Detect** phase from metric-threshold breaches (Tier 1) to **log-line pattern breaches**, which are the larger and currently-invisible class of operational signal. Feeds the same downstream Diagnose→Change→Resolve→Close flow.

---

## Problem Statement

The platform's Tier 1 observability (EP-FULL-OBS, shipped) gives operators excellent visibility into **things the platform was told to count**: HTTP 5xx rate, request latency percentiles, AI inference errors, container CPU/memory, Postgres connection saturation. Every one of these is a pre-declared Prometheus metric with a pre-declared alert threshold.

It gives operators **zero** visibility into the much larger class of signal: **arbitrary error and warning lines written to container stdout/stderr.** Those lines:

1. Are not counted by any metric, so no alert fires.
2. Live only in the Docker daemon's `json-file` log buffer — ephemeral, unrotated by us, gone when the container is recreated (which `self-upgrade` does on every bundle-hash change).
3. Are queryable today only by an operator manually running `docker logs <container>` or scrolling the Docker Desktop UI.

### The incident that triggered this spec

On a **macOS install**, three distinct subsystem problems were each emitting log lines on a loop — **hundreds of error lines** accumulating in the Docker logs. Nothing surfaced them. No alert. No dashboard tile. No notification. They were discovered **only because the operator happened to open the Docker Desktop app and watch the lines scroll past.** When the operator looked away, the evidence scrolled out of the buffer.

This is the canonical case for log-line observability, and it exposes three compounding gaps:

- **Capture gap.** Container stdout is not persisted anywhere queryable. The "hundreds of lines" had no home.
- **Detection gap.** High-frequency repetition of an error line is itself the strongest possible signal ("this is broken, right now, continuously") — and the platform does nothing with frequency. A line repeated 500×/min and a line logged once look identical to the system: invisible.
- **macOS blind spot.** Tier 1's per-container collectors (`cadvisor`, `node-exporter`) are gated behind the `linux-monitoring` profile because they bind-mount Linux host paths (`/proc`, `/sys`, `/var/lib/docker`) that **do not exist on Docker Desktop for macOS/Windows** (docker-compose.yml:590-623). So the very install class where this incident happened (Mac) has the *least* Tier 1 coverage — and Tier 1 wouldn't have caught a log-line problem regardless.

**What's missing:** a capture layer that persists every container's logs with retention and labels; a detection layer that treats *novel error signatures* and *error-rate spikes* as first-class alerts; and a surfacing layer that routes those into the platform's existing issue-management substrate so they are **managed going forward**, not re-discovered by accident.

---

## Design Summary

Three layers, each built on substrate that already exists or was named-and-deferred by the Tier 1 spec.

```
┌──────────────┐   logs    ┌──────────┐  LogQL   ┌─────────────────────────────┐
│ all containers│──stdout──▶│  Alloy   │─ store ─▶│  Loki (label-indexed store) │
│ (portal, stt, │           │ (shipper)│          │  14-day retention           │
│  inngest, …)  │           └──────────┘          └──────────────┬──────────────┘
└──────────────┘                                                 │
                                        ┌────────────────────────┼───────────────────────┐
                                        │ DETECT (two complementary paths)               │
                                        ▼                                                 ▼
                              ┌───────────────────────┐                    ┌──────────────────────────┐
                              │ Loki ruler alert       │                    │ Inngest cron scan        │
                              │ error-RATE spikes      │                    │ NOVEL-signature detection│
                              │ (volume threshold)     │                    │ (clusters + first-seen)  │
                              └───────────┬───────────┘                    └────────────┬─────────────┘
                                          │ Grafana webhook                              │ createPlatformIssueReport()
                                          ▼                                              ▼
                              ┌───────────────────────────────────────────────────────────────────────┐
                              │ SURFACE & MANAGE — existing substrate                                  │
                              │   PlatformIssueReport (PIR) → auto-triage → backlog                     │
                              │   PortfolioQualityIssue → System Health tab "Log Issues" panel          │
                              │   PlatformHealthIndicator dot reflects open log issues                  │
                              └───────────────────────────────────────────────────────────────────────┘
```

### Key principles (inherited from Tier 1, applied here)

- **Always-on by default, and genuinely cross-platform.** Unlike `cadvisor`/`node-exporter`, the Loki + Alloy pair reads container logs through the **Docker socket / Docker log API**, which works identically on Docker Desktop for macOS, Windows, and native Linux. There is no host-path bind mount, so these two services can be default-on in the base `docker-compose.yml` (not profile-gated) — closing the macOS blind spot that motivated this spec.
- **The platform is the surface.** Operators never need to open Docker Desktop or Grafana. Detected log issues appear in the System Health tab and drive the existing shell-nav health dot. Grafana/Loki Explore remains the power-user deep-dive only.
- **Detection is frequency-aware AND novelty-aware.** A loud problem (rate spike) and a quiet-but-new problem (first-ever occurrence of a signature) are *both* surfaced. The Mac incident was the loud kind; the silent-Qdrant incident that triggered Tier 1 was the quiet kind. We cover both.
- **Reuse the issue substrate; do not invent a parallel one.** Detected issues become `PlatformIssueReport` / `PortfolioQualityIssue` rows — the same objects the crash boundary, coworker-regression detector, and Grafana metric alerts already produce. One inbox, one triage, one backlog.
- **No new feature code is written by hand.** This spec is the governed artifact; the build is executed through Build Studio.

---

## Section 1: Capture Layer — Loki + Alloy

### 1.1 Service definitions (base `docker-compose.yml`, default-on)

These join the existing default `dpf` network alongside the always-on `prometheus`/`grafana`. **No profile gate** — they must run on the Mac/Windows installs where the incident occurred.

```yaml
  # ─── Log Aggregation (EP-FULL-OBS Tier 2) ─────────────────────────────────
  # Cross-platform: reads container logs via the Docker log API, no host-path
  # bind mounts (unlike cadvisor/node-exporter). Safe to default-on everywhere.

  loki:
    image: grafana/loki:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:3100:3100"   # localhost-only; portal + grafana reach it via dpf-network DNS
    volumes:
      - ./monitoring/loki/loki-config.yml:/etc/loki/local-config.yaml:ro
      - loki_data:/loki
    command: ["-config.file=/etc/loki/local-config.yaml"]
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://localhost:3100/ready"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  alloy:
    image: grafana/alloy:latest
    restart: unless-stopped
    volumes:
      - ./monitoring/alloy/config.alloy:/etc/alloy/config.alloy:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro   # discovers + tails all containers
      - alloy_data:/var/lib/alloy/data
    command:
      - "run"
      - "--server.http.listen-addr=0.0.0.0:12345"
      - "--storage.path=/var/lib/alloy/data"
      - "/etc/alloy/config.alloy"
    depends_on:
      loki:
        condition: service_healthy
```

Add `loki_data:` and `alloy_data:` to the `volumes:` block.

> **Footprint.** Loki ~50–100 MB RAM, Alloy ~30–60 MB. Comparable to one exporter sidecar. With 14-day retention and label-based (not full-text) indexing, on-disk growth for a single-org install is modest; §1.4 caps it.

### 1.2 Alloy config — discover every container, label by service

File: `monitoring/alloy/config.alloy`

```alloy
// Discover all containers on the host's Docker daemon.
discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
  refresh_interval = "15s"
}

// Relabel: derive a clean `service` label from the compose service name,
// keep container name + compose project, drop noise.
discovery.relabel "containers" {
  targets = discovery.docker.containers.targets

  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    target_label  = "service"
  }
  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/(.*)"
    target_label  = "container"
  }
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_project"]
    target_label  = "compose_project"
  }
}

// Tail discovered containers' stdout/stderr.
loki.source.docker "default" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.relabel.containers.output
  forward_to = [loki.process.level.receiver]
}

// Parse a coarse severity level out of common log shapes so LogQL can filter
// by level without per-service parsers. Heuristic, not authoritative.
loki.process "level" {
  stage.regex {
    // matches ERROR / WARN / level=error / "level":"error" / [error]
    expression = "(?i)(?P<lvl>error|warn|warning|fatal|panic)"
  }
  stage.labels {
    values = { detected_level = "lvl" }
  }
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```

This means **every container — including the STT sidecar, inngest, browser-use, and any future service — is captured automatically with no per-service wiring.** A new container added to compose is tailed on next 15s discovery refresh. (Directly addresses the "3 *different* problems" multiplicity in the Mac incident: all three subsystems are covered by one config.)

### 1.3 Loki config

File: `monitoring/loki/loki-config.yml` — single-binary, filesystem-backed, 14-day retention (matches Prometheus' 15d), with compactor retention enabled. Standard Loki single-process config; full file in the implementation plan. Key settings:

```yaml
limits_config:
  retention_period: 336h          # 14 days
  reject_old_samples: true
  reject_old_samples_max_age: 168h
compactor:
  retention_enabled: true
  delete_request_store: filesystem
```

### 1.4 Retention & disk safety

- 14-day retention via compactor (above).
- Per-stream rate + total ingestion limits in `limits_config` so a single pathological container (exactly the Mac case: hundreds of lines/sec) cannot fill the disk — excess is dropped with a metric, and *that drop is itself an alert condition* (§2.1, `LogIngestionThrottled`). A flood that gets throttled is a strong "something is very wrong" signal, so we surface it rather than silently shed it.
- Grafana already ships in the stack; we add Loki as a second datasource (§3) so the same operator login explores logs.

### 1.5 Datasource provisioning

File: `monitoring/grafana/provisioning/datasources/loki.yml`

```yaml
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: false
    editable: false
```

---

## Section 2: Detection Layer

Two complementary detectors. Neither alone is sufficient: the ruler catches **loud** problems (the Mac case), the cron scan catches **new** problems (the silent case).

### 2.1 Path A — Loki ruler: error-rate spikes (loud problems)

Loki's built-in ruler evaluates LogQL rules and fires through the **same Grafana/Alertmanager webhook path Tier 1 already uses** (`/api/platform/alerts` → `PortfolioQualityIssue`, Tier 1 spec §7.3). No new alert plumbing.

File: `monitoring/loki/rules/dpf-log-alerts.yml`

```yaml
groups:
  - name: dpf_log_rate
    rules:
      # The Mac-incident detector: any service emitting error/warn lines at a
      # sustained elevated rate. 5/min for 10m = "hundreds accumulating".
      - alert: ContainerErrorLogSpike
        expr: |
          sum by (service) (
            rate({compose_project=~".+"} |~ "(?i)(error|fatal|panic|exception|traceback)" [5m])
          ) * 60 > 5
        for: 10m
        labels:
          severity: warning
          source: log-rate
        annotations:
          summary: "{{ $labels.service }} emitting >5 error lines/min for 10m"
          description: "Sustained error-log rate on {{ $labels.service }}. Open the Log Issues panel for sample lines."

      - alert: ContainerErrorLogStorm
        expr: |
          sum by (service) (
            rate({compose_project=~".+"} |~ "(?i)(error|fatal|panic|exception|traceback)" [5m])
          ) * 60 > 60
        for: 3m
        labels:
          severity: critical
          source: log-rate
        annotations:
          summary: "{{ $labels.service }} log error storm (>60/min)"

      - alert: LogIngestionThrottled
        expr: sum(rate(loki_discarder_sent_bytes_total[5m])) > 0
        for: 5m
        labels:
          severity: warning
          source: log-ingest
        annotations:
          summary: "Loki is dropping logs — a container is flooding stdout"
```

**Thresholds are seed defaults, operator-tunable** (no hard pins — consistent with `no-provider-pinning` doctrine applied to alert config). They live in a mounted file an operator can edit; future work can expose them in the System Health tab.

### 2.2 Path B — Inngest cron scan: novel-signature detection (quiet problems)

A scheduled job that queries Loki for error lines, **clusters them into signatures** (template extraction — strip numbers, UUIDs, paths, timestamps), and compares against signatures already seen. A signature appearing for the **first time**, even once, is surfaced — this is the detector that would have caught the silent-Qdrant outage that motivated Tier 1, and it catches *low-volume* manifestations of the Mac problems before they become storms.

Follows the **exact** `token-expiry-monitor.ts` pattern: pure exported scan logic (unit-testable without Inngest), thin Inngest wrapper, `gateAtEntry` quiescence gate, idempotency keyed on a stable identity.

File: `apps/web/lib/queue/functions/log-signature-scanner.ts` (shape, not final code)

```typescript
import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";

// Pure, exported for unit tests (mirrors runTokenExpiryScan()).
export async function runLogSignatureScan(opts: { lookbackMins: number }) {
  const { prisma } = await import("@dpf/db");
  // 1. Query Loki for error/warn lines in the lookback window, grouped by service.
  //    GET http://loki:3100/loki/api/v1/query_range ... |~ "(?i)error|warn|fatal"
  const lines = await fetchLokiErrorLines(opts.lookbackMins);

  // 2. Normalize each line to a signature: strip digits, UUIDs, hex, paths,
  //    timestamps, memory addrs → stable template. Hash → signatureId.
  const buckets = clusterBySignature(lines); // { signatureId, service, sampleLine, count, firstTs, lastTs }

  let created = 0;
  for (const b of buckets) {
    // 3. Idempotency: have we already filed a PIR for this signature recently?
    //    Keyed on a deterministic dedupeKey = `log-sig:${service}:${signatureId}`.
    const seen = await prisma.platformIssueReport.findFirst({
      where: { type: "log_signature", title: { contains: b.signatureId } /* or dedupe column */ },
      orderBy: { createdAt: "desc" },
    });
    if (seen) continue; // already surfaced — no duplicate (same discipline as token-expiry tiers)

    // 4. New signature → file a PIR. Auto-triage projects it into the backlog.
    await createPlatformIssueReport({
      type: "log_signature",
      source: "log-signature-scanner",
      severity: b.count > 100 ? "error" : "warn",
      title: `New error signature in ${b.service}: ${b.sampleLine.slice(0, 120)}`,
      description: [
        `Service: ${b.service}`,
        `Signature: ${b.signatureId}`,
        `Occurrences (last ${opts.lookbackMins}m): ${b.count}`,
        `First seen: ${b.firstTs}  Last seen: ${b.lastTs}`,
        ``,
        `Sample line:`,
        b.sampleLine,
      ].join("\n"),
      routeContext: "/platform",
    });
    created++;
  }
  return { signatures: buckets.length, reportsCreated: created };
}

export const logSignatureScanner = inngest.createFunction(
  { id: "ops/log-signature-scanner", retries: 2, triggers: [cron("*/15 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return await step.run("scan-log-signatures", () => runLogSignatureScan({ lookbackMins: 20 }));
  },
);
```

Registered in the scheduled-functions catalog (gated by `DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED`, already the compose default — docker-compose.yml:182), alongside `taskrun-watchdog`, `token-expiry-monitor`, etc.

**Why both paths.** Ruler = real-time, volume-driven, fires while it's happening. Cron scan = catches the long tail (new signatures, low-volume regressions) and produces a *triaged backlog item with a sample line and counts* — durable evidence that survives the container being recreated, which the raw Docker buffer does not.

### 2.3 Dedupe column (small schema addition)

To make idempotency robust (rather than `title.contains`), add one nullable indexed column to `PlatformIssueReport`: `dedupeKey String? @db.VarChar(191)` with a partial unique index on open rows. This is the only schema change in the spec and it generalizes — the crash boundary and coworker-regression detector can use it too. (Substrate check: no existing dedupe field on the model per `platform-issue-reports.ts`; this is a genuine, minimal addition that pays for itself across all PIR producers.)

---

## Section 3: Surface & Manage Layer

All reuse — no new issue object, no new inbox.

### 3.1 "Log Issues" panel in the System Health tab

Add a panel to the existing System Health tab (Tier 1 spec §9.3) that lists open `PlatformIssueReport` rows of `type in (log_signature)` plus firing `source: log-rate` `PortfolioQualityIssue` rows. Columns: service, sample line, first/last seen, occurrence count, status. Each row links to **Loki Explore** pre-filtered to that service+signature for the operator deep-dive ("Advanced" affordance, same pattern as the existing "Open Grafana" link).

### 3.2 Health indicator reflects log issues

The shell-nav `PlatformHealthIndicator` dot (Tier 1 spec §9.4) already aggregates firing alerts. Because log detections become `PortfolioQualityIssue` / firing alerts through the existing webhook, **the dot turns amber/red on a log storm with no extra wiring** — the operator sees it from any page. This is the direct fix for "I only caught it because I happened to look in Docker Desktop": now the platform itself shows it.

### 3.3 Managed going forward

A filed PIR flows through the **existing** auto-triage runner (`issue-report-triage-runner.ts`) → assigned to the foundational portfolio → projected into the backlog as a tracked item with status lifecycle (OPEN → ASSIGNED → IN_REVIEW → RESOLVED). The operator (or Build Studio) works it like any other backlog item. The signature dedupe key prevents the same recurring line from re-filing every 15 minutes — it's filed once and tracked until resolved, exactly like `token-expiry-monitor` resolves/supersedes by tier.

---

## Section 4: File Inventory

### 4.1 New files

| File | Purpose |
|------|---------|
| `monitoring/loki/loki-config.yml` | Loki single-binary config, 14-day retention, ingestion limits |
| `monitoring/loki/rules/dpf-log-alerts.yml` | LogQL ruler rules (error-rate spike, storm, throttle) |
| `monitoring/alloy/config.alloy` | Docker-discovery log shipping, service relabeling, level parsing |
| `monitoring/grafana/provisioning/datasources/loki.yml` | Loki Grafana datasource |
| `apps/web/lib/queue/functions/log-signature-scanner.ts` | Inngest cron: novel-signature → PIR |
| `apps/web/lib/observability/log-signature.ts` | Pure signature clustering/templating (unit-tested) |
| `apps/web/lib/observability/loki-query.ts` | Server-side Loki HTTP query helper |
| `apps/web/components/monitoring/LogIssuesPanel.tsx` | System Health tab panel |

### 4.2 Modified files

| File | Change |
|------|--------|
| `docker-compose.yml` | Add `loki` + `alloy` services (default-on, no profile); add `loki_data`/`alloy_data` volumes |
| `monitoring/prometheus/prometheus.yml` | Add scrape job for Loki + Alloy self-metrics (so the ingest-throttle alert has data) |
| `apps/web/lib/queue/functions/index.ts` (or the scheduled-functions registry) | Register `logSignatureScanner` |
| `packages/db/prisma/schema.prisma` | Add `dedupeKey String?` + partial unique index to `PlatformIssueReport`; migration |
| `apps/web/lib/quality/platform-issue-reports.ts` | Accept + persist `dedupeKey`; add `log_signature` to known types/limits |
| System Health tab page | Mount `<LogIssuesPanel>` |

---

## Implementation Sequence

| Phase | Scope | Validation |
|-------|-------|-----------|
| **1** | Capture: Loki + Alloy in compose; configs. | `docker compose up` (no profile) on **macOS** brings both up healthy; Grafana → Explore → Loki shows live lines from every container including `dpf-stt`, `inngest`, `portal`. |
| **2** | Schema: `dedupeKey` on `PlatformIssueReport` + migration; writer accepts it. | Migration applies on fresh install + existing DB; `createPlatformIssueReport({dedupeKey})` round-trips; **seed updated** (fix-the-seed-not-the-runtime). |
| **3** | Detect B: `log-signature-scanner` cron + pure clustering lib + Loki query helper. | Unit tests on `clusterBySignature` (template extraction). Inject a synthetic error loop in a container → within one cron cycle a single `log_signature` PIR appears; a second identical loop does **not** create a duplicate. |
| **4** | Detect A: Loki ruler rules + Prometheus scrape of Loki/Alloy. | Drive >5 error lines/min for 10m in one container → `ContainerErrorLogSpike` fires → `PortfolioQualityIssue` row created via existing webhook. |
| **5** | Surface: `LogIssuesPanel` in System Health tab; health-dot reflection. | Functional drive on live install: trigger a storm, confirm the panel lists it with sample line + counts, the shell-nav dot turns amber, and the Loki-Explore drill-down link is pre-filtered. (Functional verification, not structural — `structural-verification-is-not-functional`.) |

### Acceptance (the Mac incident, replayed)

On a macOS Docker Desktop install, with **no operator watching Docker Desktop**: induce three different containers to each emit a repeating error line. Expected platform behavior with this spec shipped:

1. Within ≤15 min, three `log_signature` PIRs exist, each with a sample line, service, and count — **and they persist after the containers are recreated.**
2. If any line's rate exceeds threshold, `ContainerErrorLogSpike`/`Storm` fires and a `PortfolioQualityIssue` appears.
3. The shell-nav health dot is amber/red on every page.
4. The System Health → Log Issues panel lists all three, deep-linkable to Loki.
5. Each is auto-triaged into the backlog and tracked to resolution; the recurring lines do **not** spam duplicate reports.

The operator learns about all three **without opening Docker Desktop** — which is the entire point.

---

## Appendix A: Why not just ship more Prometheus metrics?

Metrics require knowing in advance what to count. The Mac incident was three *unanticipated* problems — precisely the case a pre-declared metric cannot cover. Log aggregation + signature detection is the standard, correct answer for "surface problems we didn't know to instrument," and it is the industry-standard pairing with the Prometheus/Grafana stack already in place (Grafana's own LGTM stack). This follows `research-standards-first`: Loki/Alloy is the canonical Grafana-native log layer, not a bespoke invention.

## Appendix B: Relationship to crash boundary & coworker-regression detector

Those (BI-B4F401B3 #1645, BI-47443B67 #1501) capture **structured, in-process** failures the application code already knows about (a thrown React error, a measured turn slowdown). This spec captures **unstructured, out-of-band** failures — anything any container writes to stdout, including subprocesses, sidecars, and native services that never reach a JS try/catch. They are complementary: all three converge on the same `PlatformIssueReport` inbox and the shared `dedupeKey`, so the operator has one place to look.
