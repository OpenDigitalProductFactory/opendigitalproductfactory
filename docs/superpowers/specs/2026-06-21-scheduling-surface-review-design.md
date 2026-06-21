# Scheduling surface — review & design

- Status: Draft (review complete; phased build proposed)
- Date: 2026-06-21
- Epic: `EP-SCHEDULING-SURFACE`
- Source: Founder `/goal` — "review and optimize the schedule jobs we have setup, both out of the box and that are scheduled automatically based on other activities… make sure we have a tight approach and don't overlap scheduled work significantly… I'm not sure if it's a surface in its own right in the code graph."
- Related epics: `EP-ARCH-GRAPH-LIVE` (graph projection pattern), `EP-PROACTIVE-OPS` (owns the scheduled-jobs catalog + admin surface), `EP-FULL-OBS` (origin of the 3 uncatalogued crons).

## 1. Summary

Scheduling in DPF is real, load-bearing, and **architecturally unmodeled**. There are **8 scheduling substrates**; only **3 fire autonomous work**. The recurring jobs are well-governed where the catalog reaches, but the catalog reaches only Inngest crons, its drift guard was imaginary (3 crons had silently drifted out of view), and the whole surface is **invisible to the living architecture graph** — there is no scheduling capability, surface, SysML package, or cross-layer edge. The "overlap" the founder sensed is **temporal contention** (thundering herd), not duplicated work.

The design makes scheduling a first-class surface:

1. Project the scheduled-job catalog into the code graph as operational/process nodes with `traces` edges (the `EP-ARCH-GRAPH-LIVE` extractor pattern). **This is the keystone — it is what "a surface in its own right" means.**
2. Widen the catalog from "Inngest crons" into the **canonical scheduling map** across all mechanisms, so new scheduled work has one front door and overlap is machine-detectable.
3. Stagger cadences to remove the 03:00-UTC and every-15m pile-ups.
4. Resolve dormant substrates (wire / document / remove) and delete superseded scheduling code.

Two low-risk fixes are **shipped with this spec** (catalog completeness + a real parity guard).

## 2. Inventory (what is running today)

### 2.1 The 8 substrates

| Substrate | Backing model | Fires? | How |
|---|---|---|---|
| Inngest crons | (Inngest registry) | ✅ | 26 cron functions in `scheduledFunctions` (`apps/web/lib/queue/functions/index.ts:57`); master switch `DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED` |
| `ScheduledAgentTask` | `ScheduledAgentTask` | ✅ | polled every 5m by `agent-task-dispatch`; 4 seeded (discovery-triage 08:00, data-model-mirror 03:00, hive-scout 08:17, sysml-projection 04:00) |
| `SelfUpgradeRun` | `SelfUpgradeRun` | ✅ | hourly poll, window-gated (acts only when the store is closed) |
| `ScheduledJob` | `ScheduledJob` | projection | admin/calendar view + operator cadence overrides; not a dispatcher |
| `ScheduledOutboundAction` (marketing) | `ScheduledOutboundAction` | ⚠️ dormant | `scheduledFor` exists, but fires only via the **manual** `tick_marketing_scheduler` MCP tool — no cron |
| `TaxRemittanceRun` | `TaxRemittanceRun` | ⚠️ dormant | `scheduledFor` exists, **no poller** |
| `RecurringSchedule` (invoicing) | `RecurringSchedule` | ⚠️ dormant | `nextInvoiceDate` exists, **no poller** |
| `ChangeRequest` + `DeploymentWindow` | `ChangeRequest` | manual/audit | operator-driven; self-upgrade mirrors into it for ITIL audit |

### 2.2 The 26 Inngest crons (catalog is now complete)

Authoritative registry: `apps/web/lib/operate/scheduled-jobs/catalog.ts` (`SCHEDULED_JOB_CATALOG`). Core = platform-integrity, operator read-only; editable = operator-tunable cadence.

Daily/weekly clustering (UTC): **03:00** model-discovery-refresh + material-freshness-decay + postgres backup + all-backups + (seeded) data-model-mirror, plus infra-prune on Sundays; **03:30** wiki-lint; **04:00** data-retention-sweep + (seeded) sysml-projection; 05:00 skill-metrics; 07:00 skill-curator; 08:00/08:17 discovery-triage/hive-scout; 09:00 token-expiry (+ research on Mondays); 14:00 governed-backlog-tee-up.

Sub-hourly: every minute — taskrun-watchdog, alert-delivery-bridge; every 5m — agent-task-dispatch; every 10m — contributor-inventory-sync; **every 15m (same tick) — code-graph-reconcile, issue-report-triage, coworker-regression-detect, log-signature-scanner, release-health-check**; hourly `:00` — prometheus-poll, full-discovery-sweep, runtime-target-janitor, self-upgrade poll; hourly `:23` — backlog-triage-drain.

## 3. Findings

1. **Live invisibility + an imaginary guard.** Three crons — `ops/log-signature-scanner` (15m), `ops/alert-delivery-bridge` (1m), `ops/release-health-check` (15m) — ran with no catalog entry. The admin Scheduled Jobs surface renders from the catalog (`apps/web/lib/operate/scheduled-jobs/core.ts:164`), so they were invisible to operators. The catalog header claimed "the catalog drift test fails the build otherwise," but `scheduled-jobs.test.ts` never compared the catalog against `scheduledFunctions` — the guard did not exist. **Fixed in this PR** (§5).
2. **Overlap is temporal, not duplicated.** De-dup guards on the firing jobs are sound (concurrency:1 on code-graph reconcile / discovery sweep / data-retention; cooldown+window on self-upgrade; `nextRunAt` on agent tasks). The cost is a thundering herd: 5 jobs share each `:00/:15/:30/:45` tick, and a heavy DB batch stacks at 03:00 sharp. The one genuine "should these be two jobs?" candidate is prometheus-poll vs full-discovery-sweep (both hourly `:00`).
3. **Dormant substrates.** Marketing/tax/recurring-invoicing look scheduled (fields + models) but nothing fires them on a timer. Each is a "why is this here?" until wired or documented.
4. **Superseded code.** In-memory `setTimeout` rate-recovery (now Inngest `step.sleep`) and the `activity.ts` Phase-0 quiescence stopgap (now the quiescence protocol) are dead-code candidates — **confirm before removal**.
5. **Not a surface in the code graph.** The 8 models appear only as isolated Prisma-mirror data objects with zero `traces`/`realizes`/`allocates` edges. No capability, no surface, no operational/process node, no `PKG-*` package. None of the 11 EA extractors read the catalog or the cron functions. The richest scheduling registry in the codebase (`scheduled-jobs/catalog.ts`) is consumed by no extractor. DPF also has no formal "surface" taxonomy at all — "surface" is informal prose; the closest modeled surface is the route tree.

## 4. Design

### 4.1 Keystone — scheduled-job EA extractor (`BI-SCHED-GRAPH-EXTRACTOR`)

A parity extractor under `apps/web/lib/ea/` that reads `SCHEDULED_JOB_CATALOG` (and the seeded `ScheduledAgentTask`s) and projects each scheduled job as an **operational/process node**, with:

- `traces` edges to its `ScheduledJob` / `ScheduledAgentTask` data object;
- `traces`/`allocates` edges to the capability or system it serves (e.g. backups → DR capability; code-graph-reconcile → code-intelligence);
- properties: cadence, category (core/editable), substrate, last-run health where `tracksRunData`.

Mirrors `operational-bridge-extract.ts` / `route-extract.ts` (build-time manifest walk; the catalog is the manifest, sidestepping the runtime-cron-opacity constraint the catalog header documents). Reconcile nightly via the existing parity-engine path. **Outcome: scheduling becomes a navigable surface in the graph; `cross_layer_impact` can answer "what breaks if this job stops."**

### 4.2 Canonical scheduling map (`BI-SCHED-CANONICAL-MAP`)

Widen the catalog model from "code-defined Inngest crons" to "every mechanism that runs work on a schedule." Each mechanism registers (keeping its own storage): Inngest crons (today), `ScheduledAgentTask`, `SelfUpgradeRun`, and the dormant ones once resolved. The map carries cadence + owning capability so the extractor (4.1) and a contention check (4.3) read one source. **No new substrate** — this is a widened registry + the extractor, consistent with substrate-first doctrine.

### 4.3 Stagger to remove contention (`BI-SCHED-STAGGER`)

Spread the every-15m collision (offset the 5 jobs across `:00/:03/:06/:09/:12`) and the 03:00 batch (keep DR backups first; push model-discovery / material-freshness / wiki-lint to staggered minutes after a backup completes — preserve the data-retention-after-backup ordering invariant in `retention/constants.ts:24`). Add a test/contention check (fed by 4.2) that fails if N core jobs share an exact tick. Decide prometheus-poll vs full-discovery-sweep consolidation.

### 4.4 Resolve dormant substrates (`BI-SCHED-DORMANT`)

For `ScheduledOutboundAction`, `TaxRemittanceRun.scheduledFor`, `RecurringSchedule.nextInvoiceDate`: per substrate, either wire a dispatcher (mirror `agent-task-dispatch`'s poll pattern) **or** document it as manual and remove the misleading scheduling affordance. Marketing is the most likely "wire it" (an Inngest `tickMarketingScheduler` cron); tax/recurring likely "document as manual" until the feature is live.

### 4.5 Remove superseded code (`BI-SCHED-DEADCODE`)

Confirm-then-remove the `setTimeout` rate-recovery path and `activity.ts` Phase-0 quiescence stopgap. Verify-substrate-first: grep for live imports before deleting.

## 5. Shipped with this spec (quick wins — `BI-SCHED-CATALOG-PARITY`)

- `catalog.ts`: added the 3 uncatalogued crons — `alert-delivery-bridge` (core; sole alert-delivery path), `log-signature-scanner` (editable), `release-health-check` (editable). They are now visible on `/admin/scheduled-jobs`. Category rationale is in each entry's `purpose`; trivially flippable on review.
- `queue/functions/index.test.ts`: a real **catalog↔registry parity guard** — asserts `scheduledFunctions.map(fn.id())` equals `SCHEDULED_JOB_CATALOG.map(inngestId)` in both directions, so a new cron can no longer ship uncatalogued/invisible. Catalog header comment corrected (the guard is now real and named).

Risk: low — additive catalog data + one test; `fn.id()` is the established accessor (`substrate-audit.test.ts`). Validated by hand that all 26 function ids match the catalog (CI runs the parity test).

## 6. Phasing

| BI | Title | Type | Size |
|---|---|---|---|
| `BI-SCHED-CATALOG-PARITY` | Catalog completeness + real parity guard (shipped) | bug | small |
| `BI-SCHED-GRAPH-EXTRACTOR` | Scheduled-job EA extractor — scheduling as a graph surface | feature | large |
| `BI-SCHED-CANONICAL-MAP` | Widen catalog into the canonical scheduling map (all mechanisms) | feature | medium |
| `BI-SCHED-STAGGER` | Stagger cadences + same-tick contention check | chore | medium |
| `BI-SCHED-DORMANT` | Resolve dormant substrates (marketing / tax / recurring) | refactor | medium |
| `BI-SCHED-DEADCODE` | Confirm-and-remove superseded scheduling code | refactor | small |

## 7. Open decisions

- **Category of `alert-delivery-bridge`**: shipped as `core` (operator cannot disable the sole alert path). Confirm or flip to editable.
- **Marketing scheduler**: wire an Inngest cron, or keep manual-by-design? (`BI-SCHED-DORMANT`.)
- **Dedup-guard hardening** (token-expiry tier-change, work-queue bridges) surfaced in review as low-severity; folded into `BI-SCHED-CANONICAL-MAP` rather than separate BIs unless a real duplicate is observed.
