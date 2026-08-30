# Workroom vocabulary boundary

**Backlog item:** `BI-C2C16582`
**Epic:** `EP-WORK-CONVERGENCE`
**Status:** Current
**Definition/instance realization:** shipped in PR #4648 under `EP-WORK-CONVERGENCE`; design and plan in [the workroom definition projection spec](../superpowers/specs/2026-08-24-workroom-definition-projection.md)

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

## Definition and instance are an orthogonal axis

The three layers above describe how actual work is coordinated. They do not by
themselves distinguish a reusable room design from one place where that design
is used. At the business surface, use these two qualified phrases:

| Business phrase | Formal architecture | Meaning |
| --- | --- | --- |
| **Workroom definition** | A projection of `WorkUnitDefinition`, its owning `OperatingFlow` / `Stage`, archetype profile, and `WORK_CASE_SOURCE_REGISTRY` policy | The versioned blueprint for work that can recur. It defines the intended outcome, trigger, work shape, controls, default participants, evidence, measures, and composition policy. It is not an occurrence, lease, branch, or second work ledger. |
| **Workroom instance** | A `WorkOccurrence` projected through a `WorkCase`; a `Workroom` record is attached when durable coordination is required | The actual place where work happens for one trigger and context. It carries effective assignments, cycles, sub-rooms, decisions, evidence, actual measures, and outcome. |

These are not new competing nouns. **Definition** and **instance** qualify the
canonical word `Workroom`; `WorkUnitDefinition` and `WorkOccurrence` remain the
formal exchange terms. The source registry is the present runtime definition
projection. It must be refactored toward the complete definition contract rather
than copied into a second registry or a new template subsystem.

### Implemented projection seam

The Workspace adapter now realizes the first definition/instance slice without
adding another work ledger or route:

- `WORK_CASE_SOURCE_REGISTRY` owns each source definition's stable key, positive
  version, label, finite or standing mode, and decision scope;
- `buildWorkroomView` projects that definition identity together with one
  Work Case-derived instance identity and occurrence trace;
- the occurrence trace links the primary source, current cycle, and active work
  carriers when they exist; repository, worktree, and PR evidence remains
  optional; and
- `/workspace/cases/[caseKey]` shows the definition and occurrence posture in
  Overview, while Details reveals activity, participants, evidence, receipts,
  and technical references.

This is an adapter seam, not the complete definition contract below. Later
refactoring should deepen the same registry and read model rather than create a
parallel Workroom-definition surface.

A Workroom definition has a stable key and version. At minimum it declares:

- outcome, trigger classes, eligibility, and finite or standing instance policy;
- the applicable archetype and value-stream / lifecycle position;
- the four work-shape axes, owning decision scope, authority, review, escalation,
  and completion rules;
- accountable and contributing roles, skills, resources, and default allocation
  pattern without pre-assigning a person or agent to every future instance;
- planned sub-room and cycle composition plus event-triggered spawn rules;
- required outcome-packet categories, measures, budget / estimate policy, and
  evidence retention; and
- primary coordinated portfolio role plus directional portfolio dependencies.

A Workroom instance references the exact definition version and snapshots any
approved tailoring needed to interpret its history. It adds the actual trigger,
source `WorkCase`, objective and outcome anchor, participants and assignments,
times, costs, token / tool use when applicable, actions, receipts, exceptions,
and closure evidence. A repository, backlog item, worktree, commit, PR, or CI run
is linked delivery evidence for a development instance; none is required for an
ordinary business instance.

### Composition, duration, and evidence

A **sub-room** is a Workroom instance with its own objective or control boundary
that is structurally contained by another instance. It is not a nested chat and
not merely a task row. A **cycle** is a bounded operating interval inside a
standing instance; it becomes a sub-room only when it needs independent
accountability, authority, lifecycle, or outcome evidence.

Work coordination uses explicit relationships rather than treating every link as
parent / child:

| Relationship | Meaning |
| --- | --- |
| `contains` | structural composition of a room and its sub-room |
| `spawned-from` | provenance from a schedule, event, exception, or prior room |
| `depends-on` | the subject cannot meet its outcome without the referenced work or capacity |
| `blocks` | current state prevents progress in the referenced room |
| `contributes-to` | outcome evidence advances a broader room without structural containment |

These are work-coordination relationships. Four-portfolio dependencies keep the
directional enterprise semantics in the FPAW standard; the UI must not silently
convert one relation family into the other.

Finite instances seal when their acceptance and evidence requirements are met.
Standing instances remain durable and contain bounded cycles or spawned
sub-rooms. Teardown removes temporary execution resources, not history: the
definition version, instance identity, actions, receipts, outcome packet,
estimates versus actuals, linked BIs / worktrees / PRs, and retained metrics stay
queryable after the room is sealed or archived.

Example: `Restaurant Day` is a scheduled, finite Workroom definition. Each day
creates an instance containing planned opening, kitchen, dining-service, staffing,
receiving, and closing sub-rooms. A complaint or oven failure spawns an event
sub-room. The oven remains a canonical Manufacturing and Delivery asset (or a
Foundational shared-facility aspect where appropriate), linked through a typed
dependency; it is not recreated as a child record every day. A standing
`Restaurant Operations` instance can receive each day's outcome packet through
`contributes-to` without owning every operational record.

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

- **MCP tool names** — DONE (`BI-0702869B`). The canonical names are now
  `create_workroom`, `claim_workroom_scope`, `heartbeat_workroom` and the rest.
  Every legacy `*_capsule_*` name stays **callable but unadvertised** for the
  alias window, because external Claude / Codex / Grok clients and peer installs
  hold them. Both names carry identical grants — `TOOL_TO_GRANTS` denies unlisted
  tools, so an alias without a grant row is an authorization failure. Two tools
  keep their names deliberately: `adopt_worktree` and `claim_backlog_item_for_work`
  carry no capsule token.
- **Prisma field vocabulary** — `workCapsuleId` foreign keys, the `capsule` /
  `workCapsule` relation fields, and the `capsuleId` semantic key with its `WC-*`
  values. The models carry `@@map` to their original physical tables, so the
  columns are unchanged on disk.
- **Dated specs and plans** under `docs/superpowers/` keep their original
  filenames and wording. They are the record of what was decided when, not live
  contracts.
- **Agent-facing MCP copy** — tool descriptions and error payloads under
  `apps/web/lib/mcp/packs/` still say "Work Capsule" (27 occurrences, recorded in
  `scripts/prose-lint-baseline.json`). They are read by clients inside the alias
  window, not by an operator, so they retire with the aliases through the
  existing alias-retirement follow-on.

## What a human reads is renamed, and now guarded

⟦runtime: enforced by `pnpm check:prose-lint` — a new "capsule" in owner copy fails CI⟧

The owner-copy cleanup moved the model, view types, tools, and doctrine, but
eleven owner-facing strings kept saying capsule — the portal
context strip, the Build Studio work-control table and panel, the change-lane
facet and its blocker text, the delivery nav, and the MCP token-template
description. Phase 2's only UX gate was `workspace/cases/[caseKey]`, so no gate
ever looked at them.

The list above is what this page can promise stays unrenamed. **Owner-facing
copy is not on it and never was** — that omission is what let the drift read as
deliberate. It is now mechanical rather than aspirational: the
`retiredVocabulary` axis of `scripts/check-prose-lint.ts` carries a
`RETIRED_TERMS` registry, and the term `capsule` is in it.

Two properties of that guard are load-bearing:

- It scans `apps/web/lib/` as well as `app/` and `components/`. The string the
  owner actually reported (`actionLabel: "Open capsule"`) is built in
  `lib/portal-context/work-resolver.ts`, which an app+components sweep cannot
  see.
- It matches camelCase copy props case-insensitively. The original bare-prop
  regex could not see `actionLabel` at all, which is the mechanical reason four
  shipped phases walked past the defect.

**Renaming anything else on this page means adding its term to `RETIRED_TERMS`
in the same PR.** Landing the copy change without the registry row leaves the
old word free to come back, which is exactly how this one survived.

## Related

- [Work shapes and the decision gate](work-shapes-and-the-decision-gate.md) — the shape axes, where the kernel gates autonomy, and what the shape does next
- [Claim a workroom before you work](../founder-kernel/wiki/principles/claim-a-workroom-before-you-work.md)
- [Workroom participation and channel continuity](work-room-participation-and-channel-continuity.md)
- Plan: `docs/superpowers/plans/2026-08-15-workroom-canonical-rename.md`
