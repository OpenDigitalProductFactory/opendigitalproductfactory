# Workroom vocabulary boundary

**Backlog item:** `BI-C2C16582`
**Epic:** `EP-WORK-CONVERGENCE`
**Status:** Current

Founder-directed 2026-08-15: **Workroom** is the canonical name for what we claim
and how we work. This page is the single place that says what the word means at
each layer, so the two vocabularies that merged here do not re-diverge.

## The three layers

| Layer | Name | What it is | Where it lives |
| --- | --- | --- | --- |
| Durable record | **Workroom** | The claim. Names the backlog item, holds the lease, records branch / base SHA / worktree / PR, accumulates evidence. | `Workroom` + `WorkroomActivity` Prisma models |
| Projection | **WorkCase** | The business-language projection of a unit of work, whatever produced it. | `WORK_CASE_SOURCE_REGISTRY` |
| Surface | **Workroom view** | What a person sees and acts in: participants, cycles, outcome packet, structure. | `WorkroomView`, `WorkroomCycle`, `WorkroomOutcomePacket`, `apps/web/components/workspace/workroom/` |

Read it as one sentence: **a Workroom is claimed as a record, projected as a
WorkCase, and rendered as a Workroom view.**

## Naming rules

- One stem, one casing: **`Workroom`** — never `WorkRoom`, `work-room` or
  `WORK_ROOM`. The compound is a single word, like `Workspace`.
- The **record** is `Workroom`. Do not call it a capsule in new prose or new code.
- A **view type** keeps its role in the name: `WorkroomView`, `WorkroomCycleView`,
  `WorkroomParticipantView`. The suffix is what distinguishes a projection from
  the record, now that both share a stem.
- **WorkCase** keeps its own name. It is the business-language layer and is not a
  Workroom synonym.

## A known tension, accepted deliberately

`WORK_CASE_SOURCE_REGISTRY` currently carries **13 sources**, each with its own
`roomProjection` policy:

```
task-node · backlog-item · work-capsule · approval · data-control-operation
manual-task · scheduled · engagement · opportunity · booking
storefront-booking · activity · field-service-job
```

The room is therefore a *container* that renders for any of those sources, while
the claim record is *one* of them (`work-capsule`). Converging both onto the name
Workroom means one source shares the container's name, and a booking, an
opportunity or a field-service job renders in something called a Workroom.

This was raised before the convergence landed and the direction was reaffirmed
(2026-08-15). It is recorded here rather than left implicit, because it is the
thing most likely to confuse a reader later.

**The practical rule that keeps it workable:** when the word is ambiguous in a
sentence, say which layer you mean — "the Workroom record", "the WorkCase", or
"the Workroom view". Do not disambiguate by inventing a new noun.

If the ambiguity later proves costly, the reversible move is to rename the
*container* (the view layer) rather than the record, because the record's name is
founder-directed. That would be a follow-on BI under `EP-WORK-CONVERGENCE`, not a
silent drift.

## What is deliberately NOT renamed yet

⟦runtime: these lag the vocabulary on purpose — check before assuming drift⟧

- **MCP tool names** — `create_work_capsule`, `claim_capsule_scope`,
  `heartbeat_capsule` and the rest keep their names behind an alias window,
  because external Claude / Codex / Grok clients and peer installs hold them.
  `BI-0702869B`.
- **Prisma field vocabulary** — `workCapsuleId` foreign keys, the `capsule` /
  `workCapsule` relation fields, and the `capsuleId` semantic key with its `WC-*`
  values. The models carry `@@map` to their original physical tables, so the
  columns are unchanged on disk.
- **Dated specs and plans** under `docs/superpowers/` keep their original
  filenames and wording. They are the record of what was decided when, not live
  contracts.

## Related

- [Claim a workroom before you work](../founder-kernel/wiki/principles/claim-a-workroom-before-you-work.md)
- [Workroom participation and channel continuity](work-room-participation-and-channel-continuity.md)
- Plan: `docs/superpowers/plans/2026-08-15-workroom-canonical-rename.md`
