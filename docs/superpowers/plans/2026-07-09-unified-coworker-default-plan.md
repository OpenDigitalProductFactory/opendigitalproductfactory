# Unified coworker prompt path — default flip (BI-45514C4E)

- **Date:** 2026-07-09
- **Epic:** EP-CLAUDE-INSIDE-OUT (harness-parity matrix row #2 — skill activation)
- **BI:** BI-45514C4E
- **Related:** EP-F7E35344; coworker-decision-routing-gap ([[coworker-decision-routing-gap]])

## Problem

`isUnifiedCoworkerEnabled()` returned `val?.enabled === true`, so the **install
default** (no `PlatformConfig` row for `USE_UNIFIED_COWORKER`) was the **legacy**
prompt path. The legacy path in `agent-coworker.ts` strips the entire skill plane
— including decision-routing (WWMD/WWWD/WSID) and every DB-native skill. This is
the single highest-leverage unblock for EP-CLAUDE-INSIDE-OUT: until it flips, most
of Cluster 1's value (skills, goal gates, memory injection) is dark on default
installs.

## Approach — flip the default (minimal, reversible)

Change one predicate: `return val?.enabled !== false`. Truth table:

| PlatformConfig row | old (=== true) | new (!== false) |
|---|---|---|
| none | legacy | **unified** |
| `{}` | legacy | **unified** |
| `{enabled:true}` | unified | unified |
| `{enabled:false}` | legacy | **legacy** (opt-out preserved) |

Legacy becomes opt-in: an operator must explicitly persist `{enabled:false}` to
fall back. Fully reversible via that config row — no schema change, no data
migration.

## Why not retire the legacy branch now

Deleting the legacy branch in `agent-coworker.ts` (hundreds of lines) is a larger,
harder-to-reverse change. The kernel-preferred sequence is: flip the default
(reversible), validate unified parity on the live install, then retire legacy as a
follow-up once proven. Kept as a follow-up BI.

## Tests

`feature-flags.test.ts` (new): asserts the default is unified across no-row /
empty / explicit-true, and legacy only on explicit `{enabled:false}`; plus a guard
that `isStallWatchdogEnabled` remains opt-in (defaults off) so the shared shape
change did not leak.

## Follow-ups

- Live-validate unified-path parity on the running install (drive a coworker turn,
  confirm skills + decision-routing engage).
- Retire the legacy `agent-coworker.ts` branch once unified is proven.
