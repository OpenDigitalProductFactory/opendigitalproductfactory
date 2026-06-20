# 24/7 self-upgrade window: auto-pick an overnight window in the store timezone

- **BI:** BI-A6382FB9 — "24/7 businesses: auto-pick a low-traffic overnight self-upgrade window in the store timezone; prompt only when needed"
- **Epic:** EP-UPGRADE-LIFECYCLE
- **Predecessors:** BI-6DA3B06F / [#2199](https://github.com/) (window timezone correctness), BI-0C000AB3 / #2201 (derive operating-hours tz from location). Timezone source: BI-A077E0F5, BI-AAAA0691.
- **Date:** 2026-06-20
- **Author:** Claude Code (external coding agent)

## 1. Problem

The self-upgrade maintenance window is derived as "any time the store is CLOSED"
(`apps/web/lib/self-upgrade/window.ts`: `isUpgradeWindowOpen` / `isStoreOpen` /
`nextUpgradeWindowOpen`, evaluated in the store's IANA timezone via `zoned-time.ts`).

A 24/7 storefront is represented as every day `{ enabled: true, open: "00:00", close: "24:00" }`
(`isStoreOpen` returns `true` for all instants — confirmed by `window.test.ts`). For such a
store:

- `isUpgradeWindowOpen({ schedule })` returns `!isStoreOpen` = **always false** → the scheduled
  cron (`apps/web/lib/queue/functions/self-upgrade.ts`) skips with `outside-window` **forever**;
  scheduled self-upgrades never run.
- `nextUpgradeWindowOpen` returns **null** → the Upgrade Center
  (`getSelfUpgradeStatus` → `SelfUpgradeClient.tsx`) shows the unhelpful "Maintenance window
  configured." with no actual schedule and `nextScheduledCheckAt = null`.

The only current escape is a manually-authored explicit `maintenanceWindows` array
(`config.ts`) — exactly the raw-config dead-end a layman cannot navigate. This gap was left by
the window-timezone fixes (#2199 / #2201).

## 2. Desired behavior (founder requirement, Mark 2026-06-20)

- When a store is **effectively 24/7** (no derived closed window), **auto-select** a sensible
  low-traffic **overnight** window in the store's timezone (~02:00–04:00 local) and use it as the
  upgrade window. Do **not** ask the operator unless there is a genuine need.
- "Need to ask" cases: **no timezone known and none derivable**; genuinely global / round-the-clock
  with no clear trough (future, telemetry-gated); or the operator wants to override.
- Prefer the **observed low-traffic trough** from usage telemetry (`BusinessProfile.lowTrafficWindows`)
  when a valid one exists; else a **default overnight window** in the store tz.
- UX: progressive disclosure — auto-pick and surface "upgrades run overnight, ~2–4 AM <tz>";
  show a control only when there is a real need (reuse the existing Operating Hours timezone
  picker from #2199 / the existing explicit-window override). Never make a layman hand-configure cron.

## 3. Research & benchmarking

- **Overnight maintenance windows are the universal default** for unattended self-update systems:
  Windows Update "Active Hours" (updates outside the hours you say you're active), WSUS/SCCM
  maintenance windows, Kubernetes node-pool auto-upgrade windows, and managed-DB patch windows all
  pick a low-traffic overnight slot the operator can override. DPF already mirrors this with the
  "store closed = upgrade window" model; the 24/7 case is the one slot the operating-hours
  derivation cannot fill, so an explicit overnight default is the standard fill.
- **Pattern adopted:** auto-derive from what the platform already captures (timezone + schedule +
  `lowTrafficWindows`), reuse the existing `MaintenanceWindow` evaluation machinery, and only prompt
  when a required input (timezone) is genuinely missing. This matches AGENTS.md §12 progressive
  disclosure and the kernel "Do the work; don't task the operator."
- **Anti-pattern rejected:** a cron/time picker for every 24/7 store (forces raw config on a layman —
  the #2004 raw-token-input mistake the UX-Fit Gate exists to stop) and "do nothing / keep gap"
  (silent never-runs — the defect itself).

## 4. Design

A new pure module owns the 24/7 decision; both the cron gate and the status action consume it so
the runtime and the UI never diverge (single source of truth). Explicit operator windows keep
top priority. No schema change, no migration — `BusinessProfile.lowTrafficWindows` already exists.

### 4.1 New: `apps/web/lib/self-upgrade/auto-window.ts` (pure, cron-safe)

- `DEFAULT_OVERNIGHT_WINDOW: MaintenanceWindow` = `{ dayOfWeek: [0..6], startTime: "02:00", endTime: "04:00" }`.
- `isEffectively247(schedule, now, timeZone)` — true when `nextUpgradeWindowOpen(schedule, now, timeZone) === null`
  (no closed minute within the 8-day horizon). Reuses the tested scan; "near-24/7" stores with a
  real (even short) closed window keep the operating-hours model — explicitly out of scope.
- `LowTrafficWindow` type (`{ dayOfWeek: number; start: string; end: string }`, matching
  `deriveLowTrafficWindows`) + `selectTroughWindows(lowTrafficWindows)`:
  - strict validation: `HH` 00–23, `MM` 00–59, `start !== end`, duration > 0 and ≤ ~6h
    (a quiet slot, not "all day"); rejects the malformed `{start:"24:00", end:"23:59"}` artifacts a
    24/7 schedule's `deriveLowTrafficWindows` produces → those fall through to the default.
  - groups valid per-day troughs by `(start,end)` into `MaintenanceWindow[]`; returns `null` when none qualify.
- `resolveAutoUpgradeWindow({ schedule, timeZone, timezoneKnown, lowTrafficWindows, now })`:
  - not effectively-247 → `{ kind: "operating-hours" }`.
  - 247 **and** `!timezoneKnown` → `{ kind: "needs-timezone" }` (an overnight window in an unknown
    zone could land at peak; ask instead).
  - 247 **and** `timezoneKnown` → `{ kind: "auto-overnight", windows, source }` where `windows` =
    `selectTroughWindows(...)` (`source: "trough"`) when valid, else `[DEFAULT_OVERNIGHT_WINDOW]`
    (`source: "default"`).
- `nextAutoWindowOpen(windows, now, timeZone)` — thin convenience over the config-extracted pure
  helper (4.2) so `promotions.ts` imports only from `auto-window`.

### 4.2 `apps/web/lib/self-upgrade/config.ts` — extract reusable pure helpers (DRY)

- Add `isWithinWindows(windows: MaintenanceWindow[], now, timeZone)` and
  `nextWindowStartForWindows(windows, now, timeZone)` (the current bodies of `isInMaintenanceWindow`
  / `nextMaintenanceWindowStart`, which now delegate). Lets `auto-window.ts` reuse the exact
  overnight-span + store-tz evaluation instead of a parallel copy. `window.ts`'s private
  `isInExplicitWindows` also collapses onto `isWithinWindows` (removes existing duplication).

### 4.3 `apps/web/lib/operating-hours-read.ts` — feed the new inputs

- `resolveOperatingScheduleForSystem()` additionally returns `timezoneKnown: boolean` (true when the
  profile tz is a pinned non-placeholder zone OR was derived from location; false when it fell back
  to the `DEFAULT_OPERATING_HOURS_TIMEZONE` placeholder) and `lowTrafficWindows: LowTrafficWindow[]`
  (parsed defensively from `BusinessProfile.lowTrafficWindows` JSON; `[]` when absent/invalid).
  Add `lowTrafficWindows` to the `select`. Additive — existing `{ schedule, timezone }` destructures
  keep working.

### 4.4 `apps/web/lib/queue/functions/self-upgrade.ts` — cron gate

Replace the scheduled gate block so the effective window is: explicit operator windows >
auto-overnight (247 + tz known) > operating-hours derivation. `needs-timezone` skips cleanly with a
distinct reason `no-window-needs-timezone` (no drain, no cooldown — the next tick re-checks once a tz
is set). The decision point stays `isUpgradeWindowOpen` (existing tested fn), called with the
resolved windows as `explicitWindows`.

### 4.5 `apps/web/lib/actions/promotions.ts` — status action

`getSelfUpgradeStatus` consumes the same `resolveAutoUpgradeWindow`. `windowSource` gains
`"auto-overnight" | "needs-timezone"`; `inMaintenanceWindow` and `nextWindowStart` compute against
the auto windows for the auto-overnight case (via `nextAutoWindowOpen`), so `nextScheduledCheckAt`
flows through the existing `computeNextScheduledUpgradeCheckAt` unchanged. Add a short
`autoWindowSummary` string (e.g. "2:00–4:00 AM") for display.

### 4.6 `apps/web/components/ops/SelfUpgradeClient.tsx` — progressive-disclosure copy

Declare the `windowSource` + `autoWindowSummary` props (already arrive via `{...status}` spread).
Add two Schedule-panel branches:
- `auto-overnight` → muted note "Your business runs 24/7, so upgrades run overnight (around {summary}
  {tz}). Next: <LocalTime>." (reuses existing `nextWindowStart`/`inMaintenanceWindow` rendering).
- `needs-timezone` → warning "Your business runs 24/7. Set your timezone in Settings → Operating
  Hours so upgrades can run automatically overnight (or choose a maintenance window)." with a link to
  `/storefront` operating hours. No new control. All copy uses `--dpf-*` tokens.

## 5. Phases

| Phase | Deliverable | Files | Verification |
| --- | --- | --- | --- |
| 1 | Pure `auto-window.ts` + config helper extraction | `auto-window.ts` (new), `config.ts` | `auto-window.test.ts` + `config.test.ts` (vitest): 247 detection (`00:00–24:00` all days → 247; one closed day/short slot → not), default-overnight pick, valid-trough preference, malformed-trough rejection, `needs-timezone`, store-tz overnight-span correctness. **Ships independently.** |
| 2 | System reader returns `timezoneKnown` + `lowTrafficWindows` | `operating-hours-read.ts` | `operating-hours-read.test.ts` (if present) / new cases: placeholder→`timezoneKnown:false`, derived/pinned→`true`, JSON parse safety. |
| 3 | Cron gate uses the resolver | `self-upgrade.ts` | `self-upgrade.test.ts`: add auto-overnight (gate passes auto windows), `needs-timezone`→`no-window-needs-timezone` skip; existing window-gate tests stay green (mock `auto-window`). |
| 4 | Status action + UI copy | `promotions.ts`, `SelfUpgradeClient.tsx` | `promotions.self-upgrade.test.ts` (mock `auto-window`): `windowSource` values + `nextWindowStart` for auto case; `SelfUpgradeClient.test.tsx`: auto-overnight note + needs-timezone prompt render; existing "maintenance window" test stays green. |
| 5 | Build gate | — | `pnpm --filter web typecheck`, affected `vitest run`, `pnpm --filter web build` via shared local-CI sandbox / canonical install (worktree is source-only). |

## 6. Risks, blast radius, rollback

- **Blast radius:** self-upgrade timing only. Pure additive module + additive return fields +
  two extracted-then-delegated helpers. Non-24/7 stores: `resolveAutoUpgradeWindow` →
  `operating-hours` → identical behavior to today (regression-guarded by the existing tests).
- **Risk: a 24/7 store with an unknown tz silently stops scheduled upgrades.** Mitigation: distinct
  `no-window-needs-timezone` skip reason + an explicit Upgrade Center prompt linking the existing tz
  picker — surfaced, not silent. This is strictly better than today's silent never-runs.
- **Risk: cross-module test mocks.** `self-upgrade.test.ts` and `promotions.self-upgrade.test.ts`
  mock `@/lib/self-upgrade/window`; importing the new module there would route real `auto-window`
  through the mocked `window.ts`. Mitigation: mock `@/lib/self-upgrade/auto-window` in both
  (default `{ kind: "operating-hours" }`), and verify real behavior in the dedicated
  `auto-window.test.ts` against the real `window.ts`/`config.ts`.
- **Risk: telemetry trough is actually schedule-derived garbage for 24/7.** Mitigation: strict
  validation rejects malformed/full-day windows → default overnight fires. The trough path is
  future-proofing for real telemetry; documented as such.
- **Rollback:** revert the PR. No migration, no data change, no config default change
  (`maintenanceWindows` default stays `[]`).
- **Out of scope:** ITIL `DeploymentWindow` / `check_deployment_windows` (separate change-window
  concept); "global, no clear trough" telemetry-gated need-to-ask (no real usage telemetry exists
  yet — known-tz always yields a default overnight pick for now).

## 7. UX-Fit decision

See §7 attestation in the PR body. Decision: `fits-with-guardrails`, `auto-overnight-progressive`
(progressive disclosure; no new control on the happy path; `needs-timezone` reuses the existing
Operating Hours timezone picker). Governed by AGENTS.md §12 + kernel "Do the work; don't task the
operator" + "Never ask the user to run commands"; binding founder requirement in BI-A6382FB9.
`principle_decide` was run (advisory, low-confidence/non-discriminating here — relevant cognitive-load
commandments carry no option feature scores; retrieval surfaced unrelated infra principles).
