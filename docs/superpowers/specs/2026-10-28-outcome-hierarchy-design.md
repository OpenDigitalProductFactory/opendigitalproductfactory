---
status: active
---

# One outcome hierarchy: instance, epic, backlog item, room

**Backlog:** BI-8DE5429B delivers the item and room levels in this change. The instance and epic levels are filed under EP-OUTCOME-HIERARCHY (see Follow-up below). **Kernel decisions:** DI-DDB4BDE852BB (where each level lives), plus DI-342D45001EF5, DI-D50BBC916B6D, DI-139981F74A44 and DI-19ED69C312FC for the item and room levels.

## Direction

Mark Bodman, 2026-10-28:

> The outcome is an aspect of the BI. No BI should be without a clear outcome. The room also has an outcome for each iteration. It doesn't need to be a separate thing really; it's in context of the work to be done.

> The mission and vision / outcomes of a DPF instance as a whole are also important. This is the prime definer for the WWMD, WWWD and WSID layers too. They steer towards the broader outcome as a whole. The more detailed workroom outcomes are all hierarchically there to help the organization achieve its outcomes. In other frameworks, Hoshin Kanri planning is sort of like this. We want a more simplified and practical version of it here.

## The model

Each level stores its outcome on the record for that level. Each level also links to the level above it. There is no separate objective table beside the work.

| Level | Where the outcome lives | Parent link | State today |
|---|---|---|---|
| Instance | `BusinessContext.mission`, plus a vision and 3 to 5 top-level outcomes that the owner writes | none (top) | Only `mission` exists. It is captured at onboarding and read by `org-context-bundle.ts` and the WWWD corpus seed. |
| Epic | the epic's own outcome | the instance outcome it serves | `Epic` has a title and description, but no outcome and no parent link. |
| Backlog item | `BacklogItem.outcome` (`stated` or `derived`) | `BacklogItem.epicId` (exists) | **Delivered in this change.** |
| Room iteration | the outcome of the item the room carries, read live | `Workroom.backlogItemId` (exists) | **Delivered in this change.** A standing room's cycle keeps its own objective. |

The three decision layers read the instance level as their prime context:

- WWMD, through `principle_decide` with `platform-development`, reads the founder kernel.
- WWWD, through `evaluate_org_business_decision`, reads the organization's mission and outcomes.
- WSID, through `evaluate_profession_decision`, reads the profession corpus in the organization's context.

Today only `mission` reaches these layers, through `org-context-bundle.ts` and the coworker prompt block. Vision and outcomes should travel the same path.

### What this keeps from Hoshin Kanri, and what it drops

It keeps the cascade: every outcome serves one parent outcome, so anyone can see why a piece of work exists. It also keeps the check: measurement at the lowest level, the item, rolls up the chain.

It drops catchball negotiation, the X-matrix, annual planning ceremonies and target-setting at every level. Nobody authors a separate aggregate. A parent's progress is derived from its children.

### Product objectives and the #6709 roll-up

`ProductObjective` is still where a business Product's measure lives (DI-1FCEE688F5D7). The epic and platform-work objectives that PR #6709 created are levels of this hierarchy, held in that table for now.

- In this change they are only roll-up containers for per-item observations (DI-19ED69C312FC).
- When the epic level gets its own outcome (follow-up), the epic objective becomes a projection over the epic and its items. It stops being a second place an epic's outcome is written.
- Removing or migrating the existing rows is part of that follow-up. This change does not touch them.

## Rules

- **The owner writes the instance outcomes.** An agent may prompt for them at setup and may draft a wording when the owner asks. It never invents what the organization's outcomes are. That is the owner's call, settled through WWWD.
- **Derived drafts are allowed only at the item level.** There, the item's own title is the evidence. A derived epic or instance outcome would be a guess about intent.
- **A missing parent is shown as missing, never refused.** An item with no epic, or an epic with no instance outcome, shows the gap and is still worked.

## Delivered here (BI-8DE5429B)

- The item outcome is a field, derived when missing and backfilled hourly.
- A room reads its item's outcome.
- Observations are per item: achieved, not achieved or regressed.

See `2026-10-27-outcomes-define-done-design.md`, amendment of 2026-10-28.

## The boundary: how an epic links to an instance outcome

A separate delivery stream builds the instance level: the owner entry UI and the step in initial platform setup. This section fixes the contract between that stream and the epic level, so the two can be built apart.

**Instance outcome record (owned by the instance stream).**

- One row per top-level outcome, scoped to an organization: `organizationId`, a stable semantic id such as `IO-XXXXXXXX`, `statement` (what will be true, and for whom), an optional `measure`, `status` (`active` or `retired`), `ordinal`, and audit timestamps.
- Mission and vision stay on `BusinessContext`. That stream adds `vision` beside the existing `mission`.
- Only the owner, or an action the owner takes, writes these rows. No agent path derives or invents them.
- A retired outcome is never deleted. Links that point to it stay readable and are shown as "serves a retired outcome".

**Epic link (owned by the epic stream, BI-7CD178F8).**

- `Epic.servesInstanceOutcomeId`: a nullable foreign key to the instance outcome row's id. It is indexed, with `ON DELETE SET NULL`, and there is at most one per epic.
- `Epic.outcome` and `Epic.outcomeSource` follow the `BacklogItem` pattern, except that `derived` is not allowed for an epic.
- Null means "serves no recorded instance outcome yet". It is shown as a gap and never refused.
- An epic links only to an outcome in its own organization. Platform-scoped epics link to the outcomes of the organization that owns the platform-development work.

**Below the epic (delivered in this change).** These levels already link up through existing columns, and neither stream changes them:

- `BacklogItem.epicId` links an item to its epic.
- `Workroom.backlogItemId` links a room to its item.

**Read contract for the decision layers (BI-8AB6B4F7).**

- The org context bundle (`apps/web/lib/mcp/org-context-bundle.ts`) gains `vision` and `instanceOutcomes: [{ id, statement, measure }]` for active rows, in `ordinal` order.
- WWMD, WWWD and WSID read the bundle as context and record on the decision ledger which outcome ids they read.

## Follow-up (filed, not built here)

1. Instance mission, vision and outcomes: entry at setup and owner edit. **This is built by the separate instance stream, not here.** BI-916216E7 was filed under EP-OUTCOME-HIERARCHY before that was decided. Merge it into that stream's item or retire it as covered.
2. BI-8AB6B4F7: WWMD, WWWD and WSID read those outcomes as their prime context.
3. BI-7CD178F8: each epic states its outcome and its `servesInstanceOutcomeId`. Its #6709 objective becomes a roll-up over the epic.
