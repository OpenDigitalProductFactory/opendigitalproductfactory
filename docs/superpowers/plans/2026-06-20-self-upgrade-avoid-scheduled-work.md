# Self-upgrade window avoids the platform's own scheduled work

- **BI:** BI-963B9D47 — "Self-upgrade window should avoid the platform's own scheduled work, not just customer low-traffic"
- **Epic:** EP-UPGRADE-LIFECYCLE
- **Extends:** BI-A6382FB9 (PR #2217, merged a2fbe26de) — the 24/7 auto-overnight window
- **Date:** 2026-06-20
- **Author:** Claude Code

## 1. Problem

The 24/7 auto-overnight window (BI-A6382FB9) picks a slot by **customer** traffic
(`lowTrafficWindows` trough else a fixed default **02:00–04:00 store-tz**). Founder
(Mark, 2026-06-20): *"the low traffic is an indicator, and we want to make sure other
scheduled work is not occurring as well."* The upgrade's quiescence drain +
recovery-point backup + portal rebuild must not contend with the platform's own heavy
batch jobs — acute on budget / small-GPU local deployments.

The platform's heavy maintenance clusters at **03:00–04:00 UTC**:
`POSTGRES_BACKUP_CRON`/`ALL_BACKUPS_CRON` (`0 3 * * *`), `model-discovery-refresh`
(`0 3 * * *`), `material-freshness-decay` (`0 3 * * *`), weekly `infra-prune`
(`0 3 * * 0`), and `DATA_RETENTION_CRON` (`0 4 * * *`). The fixed default of
`02:00–04:00` **store-local** therefore collides with this cluster for stores whose
local night maps onto 03:00–04:00 UTC (a UTC/London store sits right on it; a
US-Central store's `02:00–04:00` local = `07:00–09:00` UTC, clear). The lightweight
pollers (`*/1`, `*/5`, `*/15`) run continuously and are NOT the concern.

**Key constraint:** Inngest crons fire in **UTC** (no `tz` arg) while the window is
evaluated in **store tz** — so collision must be judged on one absolute (UTC) timeline.

## 2. Research / substrate

- Heavy maintenance cron times are already **exported constants** (`operate/backups/constants.ts`,
  `operate/retention/constants.ts`) with explicit "UTC daily" docs — reuse, don't hardcode.
- Existing change-window substrate to compose with (Phase 2): `DeploymentWindow` +
  `BlackoutPeriod` (per-org, `BusinessProfile` relations), `deployment-window-utils.ts`,
  `check_deployment_windows`; per-org `ScheduledAgentTask` (cron + tz + nextRunAt).
- Reactive backstop already exists: quiescence coordinator + `captureActiveSessionBlockers`
  defer if work is in flight at upgrade time. This BI adds **proactive** avoidance.
- Pattern (industry): managed-DB/K8s patch windows pick a slot clear of the provider's own
  maintenance, not just user traffic. Same idea, applied to the platform's batch jobs.

## 3. Decisions

- **Curated maintenance calendar, not a cron registry.** Crons are scattered inline as
  `cron("…")` across ~20 function files. A central registry would touch all of them for a
  single consumer (this window) — speculative generality. A small, contained
  `maintenance-calendar.ts` enumerating the few HEAVY overnight jobs (reusing the exported
  cron constants) is the architecturally-appropriate choice; promote to a registry only if
  more consumers need cron introspection. (Reverses the initial "lean registry" once blast
  radius was weighed.)
- **Soft-prefer, never hard-block.** Pick the least-conflicting overnight slot; never refuse
  to schedule because every slot has some overlap — "never silently block forever" is the
  principle BI-A6382FB9 embodies, and the quiescence defer is the runtime backstop. (Phase 2
  `BlackoutPeriod` is the only hard "no".)
- **Customer trough still primary.** A valid observed `lowTrafficWindows` trough still wins;
  maintenance-avoidance governs the **default** path (where there is no live trough today).

## 4. Phase 1 (this PR) — avoid platform heavy maintenance

### 4.1 `apps/web/lib/self-upgrade/maintenance-calendar.ts` (new, pure)
- `HEAVY_MAINTENANCE: { label; cron; durationMin }[]` — backups (`POSTGRES_BACKUP_CRON`),
  retention (`DATA_RETENTION_CRON`), model-discovery (`0 3 * * *`), material-decay (`0 3 * * *`),
  infra-prune (`0 3 * * 0`). Inline-literal crons carry a `// keep in sync with <file>` note.
- `parseSimpleCron(cron)` — supports the `"M H * * D"` shape used here (`D` = `*` or digit list).
- `isHeavyMaintenanceBusyAtUtc(date): boolean` — true when `date` (UTC) falls in any entry's
  `[H:00, H:00 + durationMin)` interval on a matching UTC day-of-week (handles >60-min wrap).
- Pure (only `Date` UTC accessors + pure constant imports) → cron-safe + unit-testable.

### 4.2 `apps/web/lib/self-upgrade/auto-window.ts`
- `CANDIDATE_OVERNIGHT_WINDOWS: MaintenanceWindow[]` — 2h slots across the sleep band, in
  preference order: `02:00–04:00` (current default, deepest sleep) → `01:00–03:00` →
  `03:00–05:00` → `00:00–02:00` → `04:00–06:00`.
- `pickOvernightWindow({ timeZone, now })` — for each candidate in order, scan a 7-day horizon
  at 30-min steps counting instants where `isWithinWindows([cand], instant, tz)` AND
  `isHeavyMaintenanceBusyAtUtc(instant)`; return the first candidate with **zero** overlap,
  else the minimum-overlap candidate (preference order breaks ties). `DEFAULT_OVERNIGHT_WINDOW`
  stays the first candidate + ultimate fallback.
- `resolveAutoUpgradeWindow`'s default branch returns `[pickOvernightWindow(...)]` instead of
  the fixed default; the trough branch is unchanged. `source` stays `"default"`.

### 4.3 Behavior
- US-Central 24/7 store → `02:00–04:00` local (`07:00–09:00` UTC) is clear → keeps the default.
- UTC/London 24/7 store → `02:00–04:00` local overlaps the 03:00–04:00 UTC cluster → shifts to
  the first clear candidate (`01:00–03:00` local = `01:00–03:00` UTC, clear).

## 5. Phase 2 (BI-59591B14) — catalog SSoT + per-org windows

### Part A — derive the heavy set from the authoritative catalog (SSoT) — **DONE** (this PR)

Phase 1 hand-listed the heavy crons. The authoritative registry already exists:
`SCHEDULED_JOB_CATALOG` (`apps/web/lib/operate/scheduled-jobs/catalog.ts`) — every cron, with a
build-failing catalog↔registry parity guard (#2227) and the `/admin/scheduled-jobs` surface.
`maintenance-calendar.ts` now resolves its heavy windows FROM the catalog by `jobId`
(`HEAVY_JOB_SPECS`), keeping only the "which jobs are heavy" judgement + a duration locally
(the catalog has no contention flag — `category` is operator-tunability). `cronOverride` pins
the backups/retention to their runtime cron CONSTANTS (the catalog shows `"daily"` for backups);
other entries use the catalog cron. A drift guard test asserts every heavy `jobId` resolves, so a
renamed/removed/retimed job fails CI. **Behaviour-preserving:** the heavy set is the same
conservative 6 (backups ×2, retention, model-discovery, material-decay, infra-prune) → same
03:00–05:00 UTC busy band → Phase-1 window picks unchanged. Lighter jobs (wiki-lint,
skill-metrics/curator) are deliberately NOT included — adding them broadens the busy band enough
to push even a deep-sleep slot off a clear window for no real contention benefit.

### Part B — per-org blackout gate — **DONE** (this PR)

An operator `BlackoutPeriod` ("no changes during our launch week") now pauses the *unattended
scheduled* self-upgrade. A self-upgrade drains + restarts the customer's portal and registers as a
`standard` `ChangeRequest`, so it respects the same blackouts that gate other changes
(`deployment-windows.ts`) — **unless** the blackout excepts self-upgrade (`exceptions` includes
`self-upgrade`/`standard`, mirroring the existing exceptions rule; no new scope policy invented).

- `apps/web/lib/self-upgrade/blackout.ts` (new): pure `findActiveSelfUpgradeBlackout(blackouts, now)`
  + fail-open DB reader `getActiveSelfUpgradeBlackout(now)`.
- Cron gate (`self-upgrade.ts`, scheduled + non-force): skips with reason `blackout-period` BEFORE
  the window resolution — a clean no-op (no drain, no run, no cooldown) that resumes automatically
  when the blackout ends. Manual / Emergency-override bypasses (the operator chose this moment).
- Status (`promotions.ts`) + Upgrade Center note (`SelfUpgradeClient.tsx`): surface
  `blackoutUntil`/`blackoutName` so a paused schedule is explained, not opaque (a scheduled skip
  writes no run row, so without this the pause would be invisible).
- This is the **proactive** guard quiescence can't give: a blackout may be declared days ahead with
  nothing yet running, so the reactive drain would never see it.

### Part B — `ScheduledAgentTask` / `DeploymentWindow` — evaluated, intentionally NOT built

Decided against (responsible-capacity / architecture-over-shortcuts), documented so it isn't left
ambiguously "staged forever":
- **`ScheduledAgentTask` proactive avoidance:** per-org agent jobs use *arbitrary* operator crons
  (not the limited shape the calendar parses) and are typically business-hours + light (LLM prompts,
  not heavy I/O). The quiescence coordinator already defers an upgrade that collides with an
  *actively running* agent task, so proactively shifting the overnight window to dodge a rare
  overnight agent job is complexity for negligible benefit.
- **`DeploymentWindow` "allowed bands":** for a 24/7 store the derived deployment windows are empty,
  and the inverse "constrain to allowed bands" semantics conflict with the auto-overnight model; the
  blackout gate already covers the "don't deploy now" governance need.

If real demand appears (e.g. an install that schedules heavy overnight agent jobs), reopen under a
fresh BI — the pure picker already accepts an injected busy predicate shape, so it's an additive change.

## 6. Phases & verification

| Phase | Deliverable | Files | Verification |
| --- | --- | --- | --- |
| 1a | maintenance-calendar | `maintenance-calendar.ts` (new) | `maintenance-calendar.test.ts`: busy at 03:15/04:15 UTC daily, clear at 12:00 UTC, infra-prune Sunday-only, cron-parse, guard tying decoded hour to `POSTGRES_BACKUP_CRON`/`DATA_RETENTION_CRON`. |
| 1b | UTC-aware overnight pick | `auto-window.ts` | `auto-window.test.ts`: US-Central keeps `02:00–04:00`; UTC store shifts off the cluster; picked window never overlaps maintenance; existing 24/7 default/trough tests stay green. |
| 1c | build gate | — | typecheck + affected vitest + production build via CI (worktree dependency-degraded → source-only; CI is canonical evidence). |

## 7. Risks / rollback

- **Blast radius:** self-upgrade window selection only; pure additive module + a changed default
  branch. Non-24/7 + trough paths unchanged. US-offset stores keep today's behavior (default clear).
- **Drift:** an inline heavy cron changes and the calendar lags → window may overlap. Mitigation:
  guard test on the exported constants + `keep in sync` comments; Phase-2 registry is the durable fix.
- **Perf:** `pickOvernightWindow` short-circuits on the first zero-overlap candidate (1 candidate ×
  336 `Intl` calls for the common clear-default case). Bounded.
- **Rollback:** revert the PR; no schema/migration/config change.
- **UX:** none — still auto-pick + the existing read-only "runs overnight ~HH:MM <tz>" line; the
  picked time may differ. No new control.
