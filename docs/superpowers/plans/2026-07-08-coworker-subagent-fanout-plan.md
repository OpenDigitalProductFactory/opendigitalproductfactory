# Coworker subagent fan-out primitive — plan (BI-E63B8293)

- **Date:** 2026-07-08
- **Epic:** EP-CLAUDE-INSIDE-OUT (harness-parity Cluster 1, matrix row #8 — MISSING)
- **BI:** BI-E63B8293
- **Kernel altitude ledger:** DI-D1C96829E6BD (deliver-tractable-block-rest)

## Problem

The external Claude harness Agent/Workflow tools spawn N parallel subagents from
one turn. DPF already had governed delegation chains (`delegation-authority.ts` —
loop detection, depth limit, authority propagation) and `TaskRun` records, but no
lightweight "spawn N governed sub-tasks at once" primitive. Delegation existed
only as heavyweight one-hop shapes.

## Approach (substrate-first — no new schema)

Wrap the existing governance. Each subtask is a delegation from the calling
coworker to a named target coworker via `startChain` (which already rejects
self-delegation and over-broad authority), and on approval a child `TaskRun`
is created (`parentTaskRunId` set) that rides the existing TaskRun dispatch. No
new model — reuses `DelegationChain` + `TaskRun`.

### This PR

1. **Core** — `lib/tak/subagent-fanout.ts`:
   - Pure `capFanoutWidth` + `MAX_FANOUT_WIDTH = 8` runaway guard (overflow is
     returned in `dropped`, never silently truncated).
   - `spawnSubagentFanout` — per-subtask: empty-objective reject → `startChain`
     governance gate → child `TaskRun` create with propagated authority +
     `a2aMetadata` linking the delegation chain. Per-item failures isolated (one
     blocked delegation never aborts the others).
2. **Door** — `subagent-fanout-pack.ts`, one tool `spawn_subagents`, **gated on
   `coworker_engagement_write`** (spawning work for others is a real authority
   action — unlike the self-scoped memory/goal doors). Parent resolved from
   `context.agentId`; targets resolved to coworker cuids; the parent's grant keys
   are the propagated origin authority.
3. **Tests** — pure cap (under/over) + spawn (approved→child TaskRun with linked
   chain metadata; governance-block isolation; empty-objective reject; width cap
   + dropped overflow).

### Follow-up (not this PR)

Execution semantics: the children are created `submitted` and ride the existing
TaskRun dispatch. A synchronous "await all children and gather structured
returns" mode (closer to the harness Workflow `parallel()`), plus surfacing child
results back to the parent turn, is a follow-up slice.

## Safety

- No new schema; reuses governed `DelegationChain` + `TaskRun`.
- All governance (self-delegation, depth, authority) enforced by the existing
  `delegation-authority` module — this primitive cannot bypass it.
- Hard width cap prevents a runaway fan-out; overflow is explicit.
- Gated door: only a coworker holding `coworker_engagement_write` can spawn.
