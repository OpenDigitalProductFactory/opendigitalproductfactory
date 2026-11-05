---
status: draft
---

# Harness evolution slice 2: probe and scope verdict

- **Backlog item:** BI-B8DAEB71. It is slice 2 of BI-49BC21C1, under epic EP-C00F61F4.
- **Workroom:** WC-25BC554C
- **Design:** [Workroom-owned harness evolution](../specs/2026-10-28-harness-evolution-loop-design.md), section "Slice 2 — probe and scope verdict, per room". It covers AC-6, AC-11 and AC-14 – AC-19.
- **Builds on:** slice 1, merged in PR #6718 (3a7706f4454f).

## Delivery: five pull requests

Slice 2 ships as five PRs. The change reviewer's measured passing ceiling is
about 48 KB of diff, so each PR stays under 45 KB. Each PR compiles and passes
its tests on its own base.

1. **Spec amendment** (docs only, #6893). Adds the slice-2 section, sharpens
   AC-11, adds AC-14 – AC-19, and adds the executor-layer and operating-criteria
   sections.
2. **Probe**: this plan, plus `probe.ts` and its tests. A pure module with no
   caller yet.
3. **Executor layer and criteria**: the executor layer and run identity in
   `room-candidates.ts`, plus the `improvement-criteria.ts` stub. The new
   inputs are optional, so main's existing callers keep compiling.
4. **Scope verdict**: `scope-verdict.ts` and `scope-decider.ts`, with tests.
   Opens after PRs 2 and 3 merge.
5. **Wiring**: `probe-stage.ts`, the store and task changes, and the
   `harness-evolution-verdict` activity kind. Opens after PR 4 merges.

## Steps

| Step | File | Test |
| --- | --- | --- |
| Three-axis probe: intents, load by rung, gate burden, variant models, judgement rules, scope options | `apps/web/lib/harness-evolution/probe.ts` | `probe.test.ts` |
| Executor layer: `executorOf`, misses per executor, `core` versus `executor:<name>`, pooled across rooms | `apps/web/lib/harness-evolution/room-candidates.ts` | `room-candidates.test.ts` |
| Operating criteria screen (BI-CE564FBB, local stub until its typed config lands) | `apps/web/lib/harness-evolution/improvement-criteria.ts` | `improvement-criteria.test.ts` |
| Scope verdict: WWMD/WWWD routing, principle_decide over measured options, rule veto, gate preference, kernel gap | `apps/web/lib/harness-evolution/scope-verdict.ts` | `scope-verdict.test.ts` |
| Live decider over the in-process `principle_decide` | `apps/web/lib/harness-evolution/scope-decider.ts` | exercised on the dev install (AC-17) |
| Probe stage in the daily run, inside the replay budget | `apps/web/lib/harness-evolution/probe-stage.ts`, `harness-evolution-task.ts` | `harness-evolution-task.test.ts` |
| Store: room tool trace, room-named human escalations, verdict activity, kernel-gap signal | `apps/web/lib/harness-evolution/harness-evolution-store.ts` | SQL checked against live Postgres |
| Room activity kind `harness-evolution-verdict` | `apps/web/lib/work-capsules.ts` | `work-capsules.test.ts` |

There is no schema change and no migration.

The real-data dry run of the pure probe used WC-76590268 and is recorded in the spec.

AC-17 is checked after deploy. A run of `harness-evolution-loop-daily` on the dev install must write a `harness-evolution-verdict` activity on a ring-0 room, and the verdict must carry its scope decision id.

## Backlog coverage

- Decision: atomic
- Parent: BI-B8DAEB71
- Receipt: blocked-by: the design's spec-approval gate has not been passed by an independent reviewer, so no initiative scope baseline exists for record_plan_backlog_coverage to bind to
- Rationale: the probe, the scope verdict, the probe stage and the verdict record form one deployable change. The stage is inert without the probe, and the verdict means nothing without the scope consult, so they ship together under BI-B8DAEB71.
- Dependencies: BI-49BC21C1
