---
status: active
title: UX route measurement boot settlement
---

# UX route measurement boot settlement

**Backlog item:** `BI-D1A77544`  
**Blocks:** `BI-362FD051` protected delivery  
**Parent architecture:** `apps/web/lib/runtime/measurement-runtime.ts`

## Decision summary

The production UX route sweep must finish every render-relevant boot
reconciler before it serves the first measured request. Production and normal
development boots keep their existing fire-and-forget behavior. The repair
uses the existing `settleBootSync` boundary; it does not freeze a larger route
baseline or hide live data from operators.

## Evidence and problem

Protected run `33858287363`, job `100976640037`, measured
`/platform/tools/catalog/sync` at 207 words against 204 and
`/platform/tools/discovery` at 980 words against 966, with a conditional text
node removed from the frozen accessibility tree. Earlier exact-route evidence
measured discovery at 965 and 971 words. The changing result on unchanged page
source is nondeterminism, not approved copy growth.

The measurement runtime already awaits render-relevant idempotent boot work and
disables maintenance writers. Three onboarding reconcilers escaped that
contract in `instrumentation.ts`: archetype-workforce backfill, commercial
catalog backfill, and discovery-estate self-heal are still launched with bare
`void import(...).then(...)`. Their writes can race the two-worker crawl. The
discovery self-heal directly changes products, attribution, and inventory rows
rendered by Estate Discovery; the other two can change DB-backed catalog and
workforce projections rendered by measured routes.

Catalog Sync has a second, independent race: its GET render calls
`runInfraPruneIfDue()`, which upserts a scheduled-job row using the wall clock,
then reads and renders that same live collection. Provisioning the row at boot
makes the page read-only and puts the write under the same measurement barrier.

## Objectives and acceptance

| Objective | Acceptance evidence |
|---|---|
| Measurement requests see one settled boot state | A behavior test holds a boot reconciler open and proves measurement mode does not resolve until the task settles. |
| Normal boot latency and recovery behavior are preserved | The same test proves normal mode returns before the task settles. |
| All four render-relevant writers use the canonical boundary | A focused wiring test proves the schedule provisioner and three onboarding reconcilers each run once in order. |
| Catalog Sync rendering is read-only | Its page test proves the GET path reads the boot-provisioned schedule without an upsert. |
| Protected evidence becomes reproducible | Fresh PR and merge-group UX sweeps pass without updating the 204/966 frozen baselines. |

## Architecture and boundaries

Extend the existing measurement-runtime module with a small batch helper that
accepts render-relevant task factories and applies `settleBootSync` to each.
Under `DPF_MEASUREMENT_RUNTIME=1` it awaits the tasks in a deterministic order;
otherwise each task remains fire-and-forget and boot continues immediately. A
focused runtime module owns the infrastructure-prune schedule provisioner and
the three dynamic-import onboarding task factories; `instrumentation.ts` calls
that one boundary.

This keeps environment policy in one module and turns the missed raw launches
into an explicit, reviewable list. The reconcilers retain ownership of their
database transactions, logging, and non-fatal behavior. No schema, route,
fixture, authorization, or user-visible copy changes.

## Failure, security, and compatibility

- A rejected task remains non-fatal through `settleBootSync`; the sweep does not
  gain a new credential or database path.
- Production continues to launch the work asynchronously, preserving startup
  latency and recovery behavior.
- Measurement mode may start slightly later, but it is intentionally paying
  that bounded cost to obtain a stable post-reconciliation state.
- If a reconciler never settles, the existing workflow timeout exposes the real
  defect rather than measuring a moving database.

## Verification and rollback

1. Capture RED against the new batch settlement behavior.
2. Implement the helper, move schedule provisioning out of the GET render, and
   route all four writers through the explicit boot-reconciler boundary.
3. Run focused runtime/instrumentation tests and web typecheck.
4. Run the exact-tree repository preflight and fresh protected PR checks.
5. Require the PR-level and merge-group route sweeps to pass on the existing
   frozen baseline; do not re-freeze 207 or 980.

Rollback is the source commit only. There is no migration or durable-data
rewrite.

## Non-goals

- Rewriting Estate Discovery or Catalog Sync UI.
- Excluding either route from the sweep.
- Raising route budgets or accepting a one-off rerun.
- Changing production reconcilers from fire-and-forget to boot barriers.
