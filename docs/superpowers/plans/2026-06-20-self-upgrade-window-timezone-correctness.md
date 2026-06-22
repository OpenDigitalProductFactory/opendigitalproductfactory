# Self-Upgrade Maintenance Window — Timezone Correctness

**Date:** 2026-06-20
**Epic:** EP-UPGRADE-LIFECYCLE
**Trigger:** Operator (Mark) reported three symptoms with screenshot evidence:
1. The maintenance window overlapped *open* store hours.
2. The automated self-update was scheduled for ~noon, not the overnight/closed window.
3. An automated self-upgrade failed where a human-invoked one would have worked.

## Root cause (single)

The platform never captures the store's real timezone, so the self-upgrade window —
derived from operating hours — is evaluated in **UTC**.

Evidence gathered from the live `dpf` install (2026-06-20):

- Portal container runs in **UTC** (`TZ` unset); Postgres `TIMEZONE=UTC`. Every
  `new Date().getHours()/.getDay()` in the portal is UTC.
- **No `BusinessProfile` row existed** → `resolveOperatingScheduleForSystem()` fell back
  to `GENERIC_DEFAULTS` (Mon–Fri 09:00–17:00) with timezone **"UTC"**.
- The only stored timezone was `StorefrontConfig.timezone = "Europe/London"`, which the
  code explicitly treats as a stale default that is *never consulted*
  (`operating-hours-types.ts`).
- `OperatingHoursEditor.tsx` renders the timezone as **read-only text — there is no
  picker** — so the operator cannot set it, and it is permanently stuck on UTC.
- The single scheduled run ever recorded, `SUR-90CFF032`, fired at **2026-06-18 17:01
  UTC** = **12:01 CDT** (the operator is US Central). 17:00 UTC is where a 9–5 *UTC*
  schedule "closes," so the automated upgrade fired at local noon, mid-business-day.

For a US Central operator, a 9–5 **UTC** schedule means the store is treated as "closed"
(upgrade window open) starting at 17:00 UTC = **12:00 noon CT** — squarely inside real
open hours. That single defect produces all three symptoms:

- **(1)** Window overlaps open hours: "closed" begins at local noon.
- **(2)** Scheduled at noon: the hourly cron's first eligible tick after the
  (UTC-miscomputed) close is 17:00 UTC ≈ local noon.
- **(3)** Automated failure pressure: firing at local noon means the portal is busy
  (staff, customers, builds) so the quiescence drain is far more likely to **defer/fail**
  than a true overnight run. The 25 historical failures are all `manual`/`unknown`
  trigger and cluster on already-fixed classes (`recovery-point-failed: neo4j` — derived
  stores are now skipped by default; "orchestrator did not complete the swap"). The
  behavioral scheduled-vs-manual difference is *gating* (window/interval/activity), not
  the swap mechanics, which are identical once a run proceeds.

The derived path (`isStoreOpen`, `nextUpgradeWindowOpen`) is **already timezone-aware** —
it only needs the real timezone in the data. The *explicit* maintenance-window path
(`isInExplicitWindows`, `isInMaintenanceWindow`, `nextMaintenanceWindowStart`) is **not**
timezone-aware — it reads host-local time — so a custom window would suffer the same bug.

## Fix

1. **Operating Hours timezone picker** (root cause). Add an IANA timezone `<select>` to
   `OperatingHoursEditor`; thread the selection through the operations page `handleSave`
   into `saveOperatingHours` (which already persists `timezone`). Default the control to
   the value the server resolved, with a "detect from browser" affordance.
2. **Timezone-aware explicit windows** (same bug class, defense-in-depth). Extract the
   pure `zonedDayAndTime` helper into a shared module and make `isInExplicitWindows` /
   `isInMaintenanceWindow` / `nextMaintenanceWindowStart` accept an optional `timeZone`,
   falling back to host-local when absent (backward compatible). Pass the store timezone
   from the cron (`runSelfUpgrade`) and the dashboard (`getSelfUpgradeStatus`).
3. **Surface the timezone** on the Self-Upgrade panel next to the schedule so "next
   window" is never ambiguous.
4. **Catalog label**: `scheduled-jobs/catalog.ts` labels self-upgrade "Nightly" but the
   real cron is hourly (`0 * * * *`) + window-gated. Correct the cadence/cron strings.

### Live remediation (applied immediately, ahead of the merge)

Created an active `BusinessProfile` (`profileKey="default"`) with
`timezone="America/Chicago"`, `hoursConfirmedAt=NULL` (so generic 9–5 defaults apply in CT
until the operator confirms exact hours via the new picker). This moves the window to the
correct local evening/overnight immediately.

## Verification

- Unit: `window.ts` + `config.ts` — add cases proving Monday 12:00 CT is *open*
  (not in window) while the same instant (17:00 UTC) is "closed" under host-local/UTC,
  and that explicit windows honor the passed timezone.
- Build gate: `pnpm --filter web typecheck` + affected `vitest` + `next build` via the
  shared local-CI convergence sandbox.
- UX: timezone picker exercised; UX-Fit-Decision recorded (progressive disclosure — one
  dropdown, sensible default).

## Out of scope / follow-ups

- Capturing timezone during first-run install setup (so a fresh install never starts on
  UTC) — file under EP-INSTALL-HARDENING if not covered.
- Container `TZ` hygiene is intentionally *not* the fix: operating-hours evaluation must
  be store-relative regardless of host clock.
