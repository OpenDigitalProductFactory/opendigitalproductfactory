# WS9 — WorkCapsule liveness contract + governed reaper

**Backlog item:** BI-CBAAEA94 (WS9) · **Epic:** EP-PROCESS-SPINE
**Date:** 2026-08-05 · **Type:** chore / observability + prevention

## Problem

A `list_work_capsules` sweep during the 2026-08-05 sprawl triage found ~100 `working` +
~14 `blocked` capsules whose apparent liveness is **false**. Two root shapes:

1. **Build Studio capsules** are born at the daily 14:00 `governed-backlog-tee-up`
   (`build/governed-backlog-tee-up-scheduled`, cron `0 14 * * *`). If the build stalls
   immediately, the capsule is never written again, so `updatedAt` freezes at
   `...T14:00:00` while `status` stays `working`. They carry a **null lease**
   (`isExternalLeaseExecutor("build-studio") === false`), so lease/sync say nothing.
2. **External (codex/claude) capsules** get a 30-min lease (`LEASE_TTL_MS`) auto-renewed on
   every capsule write. Their leases are overwhelmingly **expired** (oldest 2026-06-20), but
   nothing transitions an expired-lease capsule out of `working`/`blocked`.

Abandoned work therefore **displays as active**, jams the Build Studio WIP cap
(`promote_to_build_studio` → `wip_cap_reached`, "15 builds vs 3"), and is the mechanism by
which work is silently duplicated. This is root-cause E (no observability) made physical.

## Design grounding

- **Source of truth:** the WorkCapsule harness spec (`docs/superpowers/specs/2026-05-14-portal-work-capsule-control-harness-design.md` §21) already defines `leaseExpiresAt` / `lastSyncedAt` as the freshness witnesses and `LEASE_TTL_MS` as the lease contract. This WS **uses** that substrate; it does not invent new machinery.
- **Existing substrate reused:** `presentCapsuleRow` (already lease/sync-aware), `heartbeatWorkCapsule` (lease renewal on every write via `runAutoRenewedCapsuleWrite`), `inert-build-reaper.ts` (the FeatureBuild WIP-cap reaper) and its `taskrun-watchdog` host, and the janitor flag pattern (`DPF_*_ENABLED` / `DPF_*_AUTO_REAP`).
- **Decision:** extend, not create. The one net-new artifact is a shared pure classifier (`liveness.ts`) so board + tool + reaper agree, plus a capsule-level reaper mirroring the build reaper. No schema change (all fields already exist).

## Approach (one coherent PR)

1. **Liveness contract — `apps/web/lib/work-capsules/liveness.ts` (new, pure).**
   `classifyWorkCapsuleLiveness(row, now)` → `{ liveness, isLive, isReapable, reason, trueLivenessAt }`.
   Precedence: terminal status → open PR → terminal linked build → lease valid/expired →
   null-lease freshest-of(build activity, sync) vs a 6h idle floor (`WORK_CAPSULE_IDLE_STALE_MS`,
   override `WORK_CAPSULE_IDLE_MS`) → no-signal (recent, benefit of the doubt). **Never** uses
   `updatedAt` as a liveness signal.

2. **Observability (read-only).**
   - `list_work_capsules` annotates each row with `liveness` / `isLive` / `isReapable` /
     `livenessReason` / `trueLivenessAt`, adds a `livenessSummary`, and a `staleOnly=true`
     reap-candidate lens. It joins the linked `FeatureBuild` phase for null-lease capsules.
   - `presentCapsuleRow` (Work Control board) derives `health` from the classifier and exposes
     the same liveness fields; `getWorkControlData` joins the linked build.

3. **Prevention (reaper).**
   - `work-capsule-reaper.ts` (new): `selectReapCandidates` (pure) + `reapStaleWorkCapsules`
     (**dry-run by default**; live transition `working`→`abandoned` only when `dryRun:false`).
   - Wired into the `taskrun-watchdog` tick: observe-only under `DPF_WORKCAPSULE_REAPER_ENABLED=1`,
     live only with `DPF_WORKCAPSULE_REAPER_AUTO_REAP=1`.
   - `transitionCapsuleForTerminalBuild` closes the zombie loop: the inert-build reaper abandons
     a build → its attached capsule is abandoned in the same tick.
   - **DB-only ⇒ junction-safe:** the reaper never touches the filesystem; worktree removal stays
     with `worktree-janitor` / `dpf-worktree-hygiene` behind its own explicit go. Abandon is
     reversible (re-promote / re-adopt).

## Governance

- `destructive-actions-require-explicit-go`: reaper dry-run default; live actuation flag-gated; the
  reap SET is surfaced for human review (`staleOnly`), never auto-executed on the existing sprawl.
- No auto-abandon of the current backlog of ~100 stale capsules — that is a **recommend-only** list
  presented for explicit operator go.

## Tests (TDD)

- `liveness.test.ts` — incl. the regression: a null-lease BS capsule frozen at 14:00 is **not** live.
- `work-capsule-reaper.test.ts` — candidate selection; dry-run writes nothing; live transitions only
  the dead; build-terminal via the linked snapshot; the terminal-build → capsule coupling.
- `work-capsule-presenter.test.ts` — dead lease still `lease-expired`; valid lease reads live despite
  old `updatedAt`; abandoned linked build reads `abandoned-build`.

## Backlog coverage

- Decision: atomic
- Parent: BI-CBAAEA94
- Receipt: cmsgy9bof045t01nviamzpgje
- Rationale: One coherent PR by explicit design — WS10 (BI-71991853) names the 1-BI-per-PR-per-lease pattern as the cause of this sprawl. The classifier, the tool/board surfacing that consumes it, the governed reaper, and the build-reap-to-capsule coupling are mutually dependent; no phase ships independently, and tests land with the code.
- Dependencies: none

Covers BI-CBAAEA94 (WS9): Task 9.1 (recommend-only reap set via list_work_capsules staleOnly + reaper dry-run) and Task 9.2 (board tells the truth; stop the 14:00 heartbeat masking).
