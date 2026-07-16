# Use-it-or-lose-it Capacity Draining — Plan

| Field | Value |
|-------|-------|
| **Epic** | EP-DEMAND-MGMT |
| **BI** | BI-656F4E4B |
| **Date** | 2026-07-12 |
| **Scope decision** | `principle_decide` ledger **DI-5FED0D945EBB** — capacity-aware tee-up throttle (reuse the demand-ordered governed tee-up + WIP cap), beat a parallel dispatch loop and a manual-only command. |
| **Depends on** | The live demand ranking (the open backlog is now `demandScore`-scored), and the demand-ranked `governedBacklogTeeUp`. |

## Design grounding

- **Source of truth:** the demand-management spec [`docs/superpowers/specs/2026-07-10-demand-management-design.md`](../specs/2026-07-10-demand-management-design.md) §7 (value-ranked promote sweep) and the `governed-backlog-tee-up.ts` substrate + `cli-pool-status.ts` (EP-COST-001 §4d).
- **Decision:** *extend* both — no new spec. This adds a capacity-drain evaluator that reuses the existing tee-up dispatch + WIP cap and the existing `CliPoolStatus` pool-health signal. No parallel dispatch loop (kernel-rejected).

## Why

Pre-paid weekly LLM allocation that isn't spent before the weekly reset is wasted. DPF already dispatches the highest-`demandScore` ready work to Build Studio via `governedBacklogTeeUp` (bounded by `backlogTeeUpDailyCap` + the WIP cap), but only once a day — so between runs, build slots sit idle and allocation goes unused near the reset. The honest signal available: the provider doesn't expose remaining weekly quota, but `CliPoolStatus` tells us when the pool is **exhausted** (rate-limited). Proxy: pool NOT exhausted + inside the drain window before reset ⇒ likely unspent allocation worth draining.

## What shipped (this PR)

1. **Pure policy** — `apps/web/lib/capacity/drain-policy.ts`: `nextWeeklyReset(now, dow, hourUtc)` + `evaluateDrain(input) → {drain, targetDispatch, reason, hoursUntilReset}`. Drains only when: enabled, pool healthy, within the drain window, and WIP headroom > 0; `targetDispatch = min(headroom, maxDispatch)`. Unit-tested (9).
2. **Config** — additive `PlatformDevConfig` columns (`capacityDrainEnabled` default **false** = opt-in, `capacityResetDow`/`capacityResetHourUtc`, `capacityDrainWindowHours`, `capacityDrainMaxDispatch`). Migration `20260712120000` — all defaulted, fleet-safe.
3. **Evaluator** — `evaluate-drain.ts`: reads config + `getAllCliPoolStatuses()` (any adapter exhausted ⇒ don't push) + active-build count vs `BUILD_WIP_CAP`, runs the policy, and (unless `dryRun`) calls `runGovernedBacklogTeeUp({ trigger: "capacity-drain", capOverride })` to fill idle slots up to the WIP cap.
4. **Schedule** — `queue/functions/capacity-drain.ts`: hourly inngest fn (cron `17 * * * *`), quiescence-gated, registered in the functions index; fires Ideate on anything it promotes.
5. **Operator control** — `run_capacity_drain` MCP tool (dryRun default true = report the decision; false = dispatch). In the demand pack; grant `backlog_write`.
6. **Tee-up extension** — `runGovernedBacklogTeeUp` gains `capOverride` so the drain can exceed the normal daily cap up to the WIP headroom (the WIP cap stays the hard safety bound).

## Safety

- **Opt-in** (`capacityDrainEnabled` default false). **WIP cap is the hard ceiling** — the drain only fills free slots, never exceeds concurrent-build safety. **Never pushes into an exhausted pool.** Quiescence-gated (skips during upgrades). Only dispatches `triageOutcome=build`, DoR-ready items — the same governed set the daily tee-up uses, now `demandScore`-ordered so the *highest-value* work fills the idle capacity.

## Deferred (follow-ups)

- Real remaining-quota telemetry (the provider doesn't expose it; the proxy is pool-health + window). If a provider later exposes remaining weekly quota, feed it into the policy as a truer "unused" signal.
- An admin surface for the capacity config + a live "next reset / would-drain" readout (the `run_capacity_drain` dryRun tool covers this for now).
