# Platform Health alerts: tell → help (BI-2F778C13)

**Date:** 2026-07-10 · **BI:** BI-2F778C13 · **Branch:** `feat/health-alerts-actionable`

## Problem

The blinking Platform Health indicator shows raw Prometheus vocabulary —
"CRITICAL ContainerDown / Service sandbox is down" — to a business user, with no
action beyond a link to a read-only dashboard. Founder dogfood (2026-07-10): the
sandbox sat unhealthy for days with a diagnosable cause (health endpoint 500)
while the user had no idea what to do and the AI coworker neither noticed nor
helped. The gap generalizes: the detection substrate is mature (alert rules →
`alert-delivery-bridge` cron → `PortfolioQualityIssue` `health_alert` rows →
header dot + dashboards) but every consumer is tell-only.

Session research established:

- The `open-agent-panel` autoMessage handoff is live (Build Studio, admin issue
  reports, finance) — **no health surface dispatches it**; the providers page
  even renders unwired "Ask AI Coworker…" plain text.
- The proactivity model already has `activityFamily: "platform-health"`
  (degraded/offline → assertive, `escalationTarget: "platform-operator"`) —
  never invoked from the alert path.
- `admin-assistant` owns "platform health" with `admin_view_logs` /
  `admin_query_db` / `admin_restart_service` skills.
- The coworker opening briefing (BI-DED493BA) composes deterministically from
  the attention read-model — so an attention source IS a proactive coworker
  voice, with no LLM call and no fabrication risk.

## Kernel decision

`principle_decide` (external_coding_agent): `coworker-detector` 6.857 vs
`full-slice` 6.783 — statistical tie (margin 0.074 < tieMargin 0.2), no
commandment conflict; `one-click-remediation` (4.32) and `ui-handoff` alone
(5.21) rejected. Tie broken by the founder's complaint naming both halves
("little I can do from reading these" + "coworker is not being very helpful").
**Chosen: full-slice, advise-first** — no new side-effect tools; governed
remediation actuation is a deliberate follow-up.

## Phases

### Phase 1 — plain-language dictionary (shipped in this PR)

`apps/web/components/monitoring/alert-humanize.ts`: pure module translating
every alert rule in `monitoring/prometheus/alerts.yml` +
`monitoring/loki/rules/dpf-log-alerts.yml` into a human title + "what this
means" line (service impact keyed by scrape job, reusing `JOB_PRESENTATION`),
with a de-camel-case fallback for unknown rules, plus
`buildHealthAlertCoworkerPrompt` — the context-rich coworker handoff prompt.

### Phase 2 — coworker handoff on the leakage surfaces (shipped in this PR)

- `PlatformHealthIndicator.tsx`: humanized title/explanation per alert (raw
  alertname kept as small-print diagnostics) + **"Ask coworker for help"**
  dispatching `open-agent-panel` with the prompt and `routeContext: "/admin"`
  (the System Admin owns platform health).
- `AlertBanner.tsx`: humanized wording + per-alert **"Ask coworker"** beside
  Dismiss (previously dismiss-only).

### Phase 3 — proactive attention source (shipped in this PR)

`apps/web/lib/attention/sources/platform-health.ts`: read-only projection of
open self-monitoring `health_alert` `PortfolioQualityIssue` rows into
`AttentionItem`s (`residueReason: "no-self-heal"`, severity → risk class,
deep-link to System Health). Wired into `aggregate.ts`, so:

- the coworker **opening briefing** names the outage the moment the panel
  opens (BI-DED493BA composes from this read-model, gated by proactivity);
- the Needs-you inbox lists it under a "Platform health" chip;
- customer-scoped (MSP) rows stay in the customer estate queue.

### Phase 4 — follow-ups (deliberately out of scope)

- Governed remediation actuation: surface `recover_sandbox`-class actions
  (today fenced inside Build Studio) as operator one-click + coworker act-mode
  tools — needs its own grants/boundary decision (the voice self-heal was
  deferred BY DESIGN for the same host-exec boundary, BI-264565A4).
- Wire the unwired "Ask AI Coworker…" text on `/platform/ai/providers` and the
  Loki-jargon `LogIssuesPanel` to the same handoff.
- `notifyAttentionLive` push for newly-opened critical health alerts.

## Verification

- Unit: `alert-humanize.test.ts`, `platform-health.test.ts`, extended
  `PlatformHealthIndicator.test.ts`; full `lib/attention` +
  `components/monitoring` suites green (107 tests).
- UX-fit: kernel-scored on `human_cognitive_load` (cost axis) — the change
  removes jargon load and adds one justified control per surface, reusing the
  existing panel mechanism (`UX-Fit-Decision` trailer on the PR).
