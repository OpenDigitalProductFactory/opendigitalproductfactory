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

## Follow-up (filed, not built)

Filed under EP-OUTCOME-HIERARCHY:

1. BI-916216E7: the instance captures its mission, vision and top-level outcomes at install setup, and the owner can edit them.
2. BI-8AB6B4F7: WWMD, WWWD and WSID read those outcomes as their prime context.
3. BI-7CD178F8: each epic declares its own outcome and the instance outcome it serves. Its #6709 objective becomes a roll-up over it.
