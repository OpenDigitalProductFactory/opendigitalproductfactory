---
status: draft
---

# Workroom-owned harness evolution implementation plan

- **Backlog item:** BI-49BC21C1 (epic EP-C00F61F4)
- **Workroom:** WC-0FFA96A5
- **Design:** [Workroom-owned harness evolution](../specs/2026-10-28-harness-evolution-loop-design.md), Slice 6 of the [Governed Hermes learning loop](../specs/2026-05-15-governed-hermes-learning-loop-design.md)
- **Decision:** the room is the unit of improvement and the daily job only aggregates (founder, 2026-10-28). Four slices ship independently. This plan delivers slice 1.

## Slice 1: room-scoped candidates on ring-0 rooms (AC-1 – AC-5)

| Step | File | Test |
| --- | --- | --- |
| Core: layers as data (with a default decision scope), room misses with a `gpp-permit` hint for permit-gap refusals, room candidates, cross-room recurrences, budget clamp, platform queue | `apps/web/lib/harness-evolution/room-candidates.ts` | `room-candidates.test.ts` |
| Store: bounded reads (rooms, failed tool calls by `capsuleId`, miss-kind activity, flow signals) and writes (room activity, TaskRun + artifact) | `apps/web/lib/harness-evolution/harness-evolution-store.ts` | SQL checked against live Postgres on 2026-10-28 |
| Aggregator: per-room derivation and record, roll-up, one TaskRun per UTC day | `apps/web/lib/harness-evolution/harness-evolution-task.ts` | `harness-evolution-task.test.ts` |
| Room activity kind `harness-evolution-candidate` | `apps/web/lib/work-capsules.ts` | `work-capsules.test.ts` |
| Kind `harness-evolution-loop` + deterministic dispatch | `agent-task-kind.ts`, `agent-task-scheduler-deterministic.ts` | their tests |
| Config + seed, wired into `seed.ts` | `packages/db/src/harness-evolution-loop-config.ts`, `seed-harness-evolution-loop.ts` | `seed-harness-evolution-loop.test.ts`, `seed-task-owner-preserved.test.ts` |

There is no schema change and no migration.

After deploy, verify:

1. `harness-evolution-loop-daily` ends its first tick with `lastStatus = ok`.
2. Its TaskRun (`repeatedPatternKey = harness-evolution:<day>`) carries `budget` and `spend`.
3. A ring-0 room with recurring misses, such as one with repeated `record_workroom_evidence` `authority_denied` refusals, shows a `harness-evolution-candidate` activity.

## Later slices (children of BI-49BC21C1)

- **Slice 2 (AC-6, AC-11).** The editor first runs `principle_decide` in the candidate's decision scope (WWMD, WWWD or WSID) and records the decision id; a scope that does not support the edit is KEEP_BASE. Per-room bounded editor, and a harness-text variant kind for the WorkPattern runtime keyed on `promptOrSkillDigest`. Hermetic baseline-versus-candidate replay on the room's traces, within the room's caps.
- **Slice 3 (AC-7, AC-8, AC-12, AC-13).** Adoption under a narrow GPP permit for the specific action, not an approval card. This depends on BI-6B610D94; until then adoption goes through a shape version bump or a seed PR. Prose-to-vector accounting. EXPERIENCE records keyed by room, shape and layer. Promotion when an edit wins in two or more rooms.
- **Slice 4 (AC-9).** Weekly before/after recurrence rollup per miss key, room and shape.

## Backlog coverage

- Decision: atomic
- Parent: BI-49BC21C1
- Receipt: blocked-by: no initiative scope baseline exists yet; record_plan_backlog_coverage needs the design's spec-approval gate passed by an independent reviewer, and this authoring session has no authenticated dpf MCP connection
- Rationale: this plan delivers slice 1 only; its kind, core, store, room record and seed are one deployable unit (the kind is useless without the seed, the seed is inert without the executor), so they ship as one change under the umbrella item. Slices 2–4 are filed as children of BI-49BC21C1 when the design passes spec approval.
- Dependencies: none
