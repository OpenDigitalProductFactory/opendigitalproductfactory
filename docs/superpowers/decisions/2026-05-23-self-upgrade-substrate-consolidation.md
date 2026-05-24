# Self-Upgrade Substrate Consolidation (Phase 0)

| Field | Value |
| --- | --- |
| Date | 2026-05-23 |
| Status | Accepted |
| Spec | docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md |
| BI | BI-5B3FA415 |

## Context

Prior to Phase 0, two parallel Inngest function families handled self-upgrade:

- `portal/self-upgrade-*` (legacy, daily 8am + 15min completion sweep): called
  `runSelfUpgradeCycle` and `completePendingSelfUpgradeRuns`, both compatibility
  stubs returning skipped/empty.
- `ops/self-upgrade-*` (newer, hourly + manual event): the substantive
  implementation, gated on `resolveTargetSha` which returns `null`.

`apps/web/lib/actions/promotions.ts` `listSelfUpgradeRuns` selected DTO field
names (`triggeredBy`, `fromVersion`, `toVersion`, `error`) that did not match
the `SelfUpgradeRun` Prisma model columns (`trigger`, `currentSha`,
`targetSha`, `failureLog`), producing a runtime `PrismaClientValidationError`.

A vestigial parallel run-tracking module (`apps/web/lib/self-upgrade/store.ts`)
also existed alongside the active `run-store.ts` — zero production callers, only
used by its own test. Confirmed dead during Task 5 implementation.

## Decision

1. Delete the legacy `portal/self-upgrade-*` Inngest functions and their
   stub backends. There is exactly one runnable self-upgrade family:
   `selfUpgradeScheduled` (hourly) + `selfUpgradeManual` (event
   `ops/self-upgrade.run`).
2. Align the API DTO surface to the schema column names rather than rename
   the columns. Rationale: the column names accurately describe what they
   hold today (git SHAs). Renaming to `fromVersion` / `toVersion` would be
   incorrect until Phase 1 introduces a versioning concept.
3. Make `resolveTargetSha`'s null return observable via structured log,
   with explicit tracking reference to the future channel-manifest BI.
4. Delete vestigial parallel run-tracking module `store.ts` and its test
   (out-of-plan scope expansion, operator-authorized during Task 5).

## Consequences

- Inngest dashboard now shows only the `ops/*` family.
- `SelfUpgradeRun` history queries return live data without throwing.
- Hourly cron still skips every fire (`reason: "no-target"`), but the log
  signal makes the gating visible.
- Future schema rename of `currentSha`/`targetSha` to `fromVersion`/`toVersion`
  remains deferred until channel manifests and version-bearing runs exist.

## Out of scope (handled in later phases)

- Implementing `resolveTargetSha` — Phase 2 (channel manifest).
- Wiring `emitUpgradeEvent` to a real event bus — Phase 5 (graceful recycle).
- Replacing the 5-min activity defer with a graceful drain protocol — Phase 5.
- Replacing SHA-based run vocabulary throughout — later phase after channel manifests.
- Publishing the install's platform version — Phase 1 (`platform.version`).
