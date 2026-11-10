---
status: draft
---

# Monitoring as an operator choice

**Date:** 2026-10-13
**Status:** Researched design; independent approval, plan and implementation pending.
**Scope owner:** DPF platform (WWMD). Every install and deployment shape.
**Backlog:** BI-83260BB3 / WC-36508ED3 (delivery-large). Depends on BI-5ACBAC50 / WC-0AD784CD for capability-state integrity.

## 1. Problem and existing architecture

Founder direction (2026-10-13): monitoring (Prometheus, Grafana and postgres-exporter) may be optional so hosts under pressure and small deployment shapes can skip it, but the operator must **choose** — once during install or onboarding, and later through a working portal switch. Today nobody is asked, nothing lets an operator turn it on, and capability state can report it `active` while no collector runs.

History: always-on (`0b13d7ec`, 2026-04) → moved behind `runtime:deep-observability` with `operator-controlled` activation (#3266, 2026-07-18, no rationale recorded) → Loki and Alloy promoted back to always-on in `runtime:core` (#5382, BI-F8024A9D, 2026-09-15). Prometheus, Grafana and postgres-exporter stayed opt-in.

Source inventory at commit `1ace3621feb63c476b377a71e75a594456ad5395`:

| Existing substrate | Use and constraint |
| --- | --- |
| `docker-compose.yml:809-997` | prometheus, grafana, postgres-exporter carry profiles `runtime-deep-observability`/`observability-ui` and **no resource limits**. Loki and Alloy are profile-free and bounded. cadvisor/node-exporter use `linux-monitoring`. |
| `packages/db/data/platform-runtime-capabilities.json:9` | `runtime:deep-observability`, dependency `runtime:core`, `operator-controlled`, seeded `active`. The seed's birth value is the drift root cause owned by BI-5ACBAC50. |
| `scripts/capability-service-catalog.generated.json:397-540` | Service projection for the capability. Loki/Alloy sit under `runtime:core`. |
| `scripts/lib/resolve-capability-compose-profiles.mjs`, `scripts/installer/lib/state.ps1:323-342` | Install-state → compose profiles. `observability-ui` aliases the capability. Legacy install-state migrates to a compatibility set that includes deep-observability, so upgraded installs keep their current topology. |
| `install-dpf.ps1:6-93, 1285-1298, 1936-1958`; `install-dpf.sh:191, 324` | Prompts go through `Read-DPFInstallerInput`, which refuses under `-Headless`. Mode choice is the only product prompt. No monitoring question exists. |
| `scripts/installer/install-state.v2.schema.json` | `additionalProperties: false`; `enabledRuntimeCapabilities` required. No field records *whether the operator was asked*. |
| `apps/web/lib/actions/runtime-capabilities.ts:11-23` | `requestRuntimeCapabilityTransition` (needs `manage_platform`) → admission → `executeProductionRuntimeCapabilityTransition` → signed envelope → promoter → `scripts/apply-runtime-capability-transition.mjs` → signed host receipt → DB commit. **No caller exists** in pages, API routes or MCP tools. |
| `apps/web/lib/platform-runtime/operational-state.ts:124-177`, `capability-state-divergence.ts` | Joins install-state, DB rows and Docker-observed containers; names divergence. Rendered (partially) on `/platform/ai/runtime-health` via `CapabilityServiceHealth.tsx`. |
| `config/install-resource-budgets.json`, `scripts/check-compose-resource-budgets.mjs` | Budgets for always-on services and some optional ones. None for the three monitoring services. |
| `apps/web/components/monitoring/MonitoringContext.tsx`, `PlatformHealthIndicator.tsx:194-195`, `SystemHealthDashboard.tsx`, `ServiceHealthDashboard.tsx`, `LogIssuesPanel.tsx` | Probe `/api/platform/metrics?query=up` and show "Monitoring offline"/"not configured" or "data unavailable". None can tell *switched off by choice* from *broken*. |
| `apps/web/lib/actions/setup-constants.ts`, `setup-progress-service.server.ts` | Guided onboarding steps mapped to real routes. No runtime-capability step. |
| `docs/architecture/platform-overview.md:406-412` | Claims Loki and Alloy are profile-gated — false since BI-F8024A9D. |

**Why the switch cannot simply be wired to a button today.** On this install the DB says seven capabilities are `active` while install-state says `runtime:core` only. The host apply script refuses any envelope whose `previousKeys` disagree with install-state (`install_state_stale`, `apply-runtime-capability-transition.mjs:107`). BI-5ACBAC50 owns the dual-baseline reconciliation and host-grounded bootstrap that make a transition admissible on such an install. This design **consumes** that fix and does not re-implement it.

## 2. Research & Benchmarking

Primary sources inspected 2026-10-13. No package, service or subscription is adopted.

| Comparator and inspected contract | Pattern absorbed | Pattern rejected / DPF difference |
| --- | --- | --- |
| [GitLab Omnibus — Monitoring GitLab with Prometheus](https://archives.docs.gitlab.com/16.0/ee/administration/monitoring/prometheus) | One named switch (`prometheus_monitoring['enable']`) turns the bundled Prometheus *and its exporters* off together; the change is applied by a reconcile step, not by hand-editing services. | GitLab defaults it on and leaves the choice in a config file the operator must discover. DPF asks explicitly, and the switch lives in the portal. |
| [Rancher — Enable Monitoring](https://ranchermanager.docs.rancher.com/how-to-guides/advanced-user-guides/monitoring-alerting-guides/enable-monitoring) | Monitoring installs from an admin UI (Cluster Tools → Install) and states the resource cost up front (~1950Mi memory, 2700m CPU) with editable limits. | Helm values editing is too much for a non-technical operator. DPF shows a fixed, budgeted cost and a single on/off decision. |
| [Nextcloud AIO](https://github.com/nextcloud/all-in-one) optional containers | Optional containers (Collabora, Talk, ClamAV, full-text search) are checkboxes in the AIO admin interface, applied by the master container that owns Docker. | AIO publishes no per-container cost; operators size by trial. DPF publishes the budget it enforces. |

Standard followed: the [Compose Specification profiles](https://github.com/compose-spec/compose-spec/blob/main/spec.md#profiles) mechanism for optional services, as DPF already does. DPF does not let callers set `COMPOSE_PROFILES`; profiles are derived from capability authority (`capability-driven-runtime-profiles.md` safe operating rules).

Alternatives evaluated:

- **(A) Revert to always-on.** Rejected: contradicts founder direction that small or pressured hosts may skip it, and adds ~1.6 GB to every install.
- **(B) Install-time question only.** Rejected: no way to change the decision later; the founder requires a portal switch.
- **(C) Portal toggles `COMPOSE_PROFILES` or runs `docker compose` directly.** Rejected: bypasses the signed-receipt transition saga, recreates the exact drift BI-5ACBAC50 is fixing, and breaks the safe operating rule that enabled state changes only through the governed transition.
- **(D) Ask at install and onboarding, record the decision, drive every change through the existing governed transition saga, and make off-state honest in the UI.** Selected: reuses the transition substrate that has no caller yet, the operational-state join, and the budget guard; adds only a decision record and the surfaces.

## 3. Objectives

**OBJ-MON-01:** Every install records an explicit operator decision about monitoring, made at install time or during onboarding, with the host cost shown before deciding.

**OBJ-MON-02:** An authorized operator can see monitoring's real state and turn it on or off from the portal through the existing governed capability transition, with the host receipt.

**OBJ-MON-03:** When monitoring is off, every metric-backed surface says so plainly instead of reading healthy, empty or broken.

**OBJ-MON-04:** Monitoring services run within declared resource budgets, existing installs keep their topology on upgrade and are offered the choice, and documentation matches the system.

## 4. Decision record

Add an optional map to install-state v2 (schema-additive, no version bump):

```json
"runtimeCapabilityDecisions": {
  "runtime:deep-observability": {
    "decision": "enabled | disabled | undecided",
    "source": "installer-prompt | installer-flag | headless-default | upgrade-carried | portal",
    "decidedAt": "<ISO-8601>"
  }
}
```

- `decision` mirrors membership of `enabledRuntimeCapabilities`; it adds *whether a person chose it*. `undecided` means the current topology was not chosen by anyone and the portal must offer the choice.
- Writers are the installer (fresh install) and the host apply script (portal transitions). The promoter remains the only `/dpf-state` writer from the running platform. The apply script writes the decision in the same journaled install-state update as `enabledRuntimeCapabilities`, so the two cannot diverge.
- The `PlatformCapability` row is reached through the transition saga, never written by the installer. Host-grounded bootstrap of the row on a fresh install is BI-5ACBAC50 AC-6.
- Generic by key: other `operator-controlled` capabilities can adopt the same record later without schema change. Only monitoring is in scope here.

## 5. Install and onboarding

**Installer (Windows and Linux/macOS).** After the mode choice, ask one question in both modes:

> Monitoring (Prometheus + Grafana) watches this platform and its host. It uses about **X GB memory and Y CPU** when on. You can change this later in Settings → Monitoring. Turn monitoring on? [y/N]

- X and Y are computed from `config/install-resource-budgets.json` (sum of the three services), never hard-coded in the script.
- New flag `-Monitoring On|Off` (`--monitoring on|off`) answers it; source `installer-flag`.
- `-Headless` without the flag does not prompt: monitoring stays off, decision `undecided`, source `headless-default`. The portal then offers the choice.
- `On` adds `runtime:deep-observability` to `enabledRuntimeCapabilities` before profiles resolve, so the first `compose up` starts it.
- Re-running the installer on an existing install never re-asks a recorded `enabled`/`disabled` decision.

**Upgrade.** An install-state without the decision map gets `runtime:deep-observability` recorded as `undecided`, source `upgrade-carried`, with its current `enabledRuntimeCapabilities` untouched. Nothing is started or stopped by the upgrade.

**Onboarding.** Add a `monitoring` setup step routed to the settings surface (§6), shown when the decision is `undecided`. Completing it is choosing either option; skipping keeps `undecided` and leaves a dismissible attention item on the settings surface.

## 6. Portal settings surface

Route: `/admin/settings/monitoring` (linked from Core Configuration on `/admin/settings` and from `/platform/ai/runtime-health`). A server component reads `loadOperationalCapabilityState` and the decision record.

- **State shown from observation, not only the row:** On / Off / Turning on / Turning off / Needs attention. "On" requires the capability enabled *and* prometheus, grafana and postgres-exporter observed running. Enabled-but-absent or running-but-disabled is "Needs attention" with the divergence named, not hidden.
- **Cost:** the same budgeted memory/CPU figure as the installer.
- **Action:** one button, "Turn monitoring on" / "Turn monitoring off", for callers with `manage_platform`; read-only otherwise. It calls `requestRuntimeCapabilityTransition` with a fresh `RCT-*` id and the desired key set with or without `runtime:deep-observability`.
- **Outcome:** each coordinator result maps to plain copy — `succeeded`, `host_applied_pending_verification`, `transition_in_progress`, `drain_required`, `failed`/`rolled_back`/`rollback_failed` with the receipt's failure reason and transition id. The latest receipt (id, status, observed services, completedAt) stays visible.
- **Precondition honesty:** when the operational-state join reports the install's capability state as disagreeing (BI-5ACBAC50 not yet reconciled), the button is disabled with "Capability state needs reconciling first" and a link to runtime health, rather than letting a transition fail with `install_state_stale`.
- Theme-aware tokens, keyboard and mobile layout per AGENTS.md §9; strings via the i18n catalog.

## 7. Honest off-state

Extend `MonitoringContext` from `{online, checked}` to `{status: "on" | "off" | "unreachable" | "checking"}`, where `off` comes from capability authority (server-provided) and `unreachable` from a failed probe while monitoring is on.

- `PlatformHealthIndicator`, `PlatformHealthStrip`, `SystemHealthDashboard`, `ServiceHealthDashboard` and the metric widgets render "Monitoring is off on this install" with a link to the settings surface when `off`, distinct from "Monitoring offline" (on but unreachable).
- Grafana links (`SystemHealthDashboard`, `LogIssuesPanel`) are hidden when off. Loki-backed log panels stay, since Loki and Alloy are always on.
- `/api/platform/metrics*` return `{status: "monitoring-off"}` with HTTP 200 instead of 503 when the capability is not enabled, so callers can tell choice from failure.

## 8. Budgets and documentation

- Add `prometheus` (1g / 1.0), `grafana` (512m / 0.5) and `postgres-exporter` (128m / 0.25) to `optionalProfileServices` and as `deploy.resources.limits` in compose. These are initial bounds: D1 measures steady-state `docker stats` with monitoring on and records the evidence before merge, adjusting any bound whose steady state exceeds 70% of it.
- `platform-overview.md` §Monitoring Stack Topology and `capability-driven-runtime-profiles.md:37`: Loki and Alloy are always on in `runtime:core`; Prometheus, Grafana and postgres-exporter are the operator's choice, made at install/onboarding and changed in Settings → Monitoring.

## 9. Compatibility, rollback and verification

- Existing installs: topology untouched; decision `undecided`; offered the choice in the portal.
- Rollback: the decision map is optional and ignored by older readers; the settings route and setup step can be removed without data loss; capability state remains governed by the saga.
- Verification: source tests for the decision record (schema, resolver migration, apply-script journaling), installer prompt/flag/headless branches, UI state mapping and copy. Runtime acceptance on the served dev install: turn monitoring on from the portal, observe containers and the receipt, see Grafana reachable and the "Portal journeys" row (BI-BD0B0DCC) render; turn it off, observe the containers gone and every listed surface saying "Monitoring is off". No runtime check has passed for this design yet.

| Acceptance ID | Objective | Observable contract |
| --- | --- | --- |
| AC-MON-01 | OBJ-MON-01 | Interactive install (both installers, both modes) asks the monitoring question with the budget-derived memory/CPU cost, and records `enabledRuntimeCapabilities` plus the decision (`installer-prompt`) in one install-state write. |
| AC-MON-02 | OBJ-MON-01 | `-Monitoring On/Off` answers without prompting (`installer-flag`); headless without the flag records `undecided`/`headless-default` and starts no monitoring service; a recorded decision is never re-asked. |
| AC-MON-03 | OBJ-MON-01 | When the decision is `undecided`, onboarding shows a monitoring step that routes to the settings surface; choosing either option completes it. |
| AC-MON-04 | OBJ-MON-02 | The settings surface shows On/Off/transitioning/Needs attention from observed containers joined with capability and install state, and names any divergence. |
| AC-MON-05 | OBJ-MON-02 | A `manage_platform` operator turns monitoring on and off through `requestRuntimeCapabilityTransition`; the host apply writes the decision (`portal`) in the same journaled install-state update; the receipt id and outcome are shown; other users see read-only state. |
| AC-MON-06 | OBJ-MON-02 | While capability state is unreconciled (BI-5ACBAC50), the switch is disabled with a reason instead of failing `install_state_stale`. |
| AC-MON-07 | OBJ-MON-03 | With monitoring off, the header indicator, portfolio health strip, system and service health dashboards and metric widgets read "Monitoring is off on this install" with a settings link; Grafana links are hidden; `/api/platform/metrics*` return `monitoring-off`, not 503. |
| AC-MON-08 | OBJ-MON-04 | prometheus, grafana and postgres-exporter have compose limits matching `install-resource-budgets.json`, enforced by the budget guard, with measured steady-state evidence. |
| AC-MON-09 | OBJ-MON-04 | Upgrading an install without a decision keeps its topology and records `undecided`/`upgrade-carried`; nothing starts or stops. |
| AC-MON-10 | OBJ-MON-04 | `platform-overview.md` and `capability-driven-runtime-profiles.md` describe Loki/Alloy as always on and the three monitoring services as the operator's recorded choice. |

The capability row reading `active` while its services are absent (BI-83260BB3 acceptance bullet 5) is delivered by BI-5ACBAC50 AC-1..AC-6, not duplicated here; AC-MON-04 and AC-MON-06 surface it.

## 10. Delivery ledger

Each slice is independently shippable and filed as a live BI under EP-MFG-DELIVER-INSTALL. Plan: [implementation plan](../plans/2026-10-13-monitoring-operator-choice-plan.md).

| Key | Deliverable | Sections / acceptance | Depends on | Live BI |
| --- | --- | --- | --- | --- |
| D1 | Monitoring resource budgets + compose limits, measured | §8 / AC-MON-08 | — | BI-D6769E2F |
| D2 | Install-state decision record + upgrade carry (schema, resolver migration, apply-script journaling) | §4, §5 Upgrade / AC-MON-09, part of AC-MON-05 | — | BI-0048E94D |
| D3 | Installer question, flag and headless default (ps1 + sh) | §5 / AC-MON-01, AC-MON-02 | D1, D2 | BI-31F11C37 |
| D4 | Honest off-state across metric surfaces and API | §7 / AC-MON-07 | — | BI-2CE9CBF4 |
| D5 | Settings surface + governed switch + onboarding step | §5 Onboarding, §6 / AC-MON-03..06 | D2, BI-5ACBAC50 | BI-8BBFE50B |
| D6 | Documentation correction | §8 / AC-MON-10 | — | BI-B670E078 |

## Design grounding

Specs reviewed: `docs/architecture/capability-driven-runtime-profiles.md` (authority flow, transitions, safe rules), `2026-07-17-platform-substrate-convergence-design.md` (keeps monitoring optional; runtime-health states), `2026-06-09-container-log-aggregation-and-proactive-issue-detection-design.md` (profile gating for Loki/Alloy, since reversed), `2026-10-12-runtime-capability-reconciliation-locator.md` (BI-5ACBAC50 scope, on its branch). Code substrate: the files in §1's inventory. No new table, enum, MCP tool or capability is introduced; the only new structure is the optional install-state decision map.
