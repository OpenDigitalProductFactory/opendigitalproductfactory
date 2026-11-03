---
status: active
---

# Outcomes define done: delivery closes an item by default

**Backlog item:** BI-B1B44777 (medium). **Authority:** founder direction, 2026-10-27. **Kernel decision:** DI-1263D968DC26.

## Direction

Mark Bodman, 2026-10-27, approved in thread:

> Outcomes is the way to know [...] Only when not obvious, we need to ask for how to know. The default is, someone who uses a change, will complain and we open a new BI. [...] not worry so much about the acceptance unless its a contractual thing. This is rare, so not the norm.

He also asked for it to apply at intake on all services.

## Problem

`apps/web/lib/backlog/initiative-readiness/backlog-completion-evaluation.ts` already counts a merge through CI and the merge queue as delivery, acceptance, objective reconciliation and the design/plan lanes (`recognizeMergeThroughGates`, EP-4614F35E). It does this only when `isDirectMergePlatformWork` holds: the item is scoped `platform` or `common`, and has no DigitalProduct, no active build and no linked ProductObjective.

On 2026-10-27 the backlog held 352 awaiting-acceptance items. 190 were platform-scoped. The other 162 waited for a separate acceptance reviewer whom nobody had been asked to be.

`BacklogItem` has no field that marks an item contractual. `sensitivity` controls cross-org sharing, and `proposedOutcome` holds a triage suggestion.

## Options (scored with `principle_decide`, DI-1263D968DC26)

| Option | Composite | Disposition |
|---|---|---|
| Reserve one value, `contractual`, in the existing `BacklogItem.lifecycleTags` array. It is already settable through `create_backlog_item` and `update_backlog_item` and filterable through `query_backlog`. No migration. | 8.52 | **Chosen** |
| Add an `acceptanceRequirement` column, with a migration and UI. | 7.55 | Rejected. It adds new substrate when an existing governed field can carry the fact. |
| Infer contractual from existing links (DigitalProduct, build, objective). | 4.15 | Rejected. Those links say what a change is for, not that a customer was promised a sign-off. Most customer work would stay stuck. |

## Shape

- **Completion gate.** The merge-recognition predicate becomes `deliveryClosesItem(item)`, which is true when the item is not contractual. These guards are unchanged:
  - An aggregate (xlarge) item still owes its children.
  - A current failing `ux` or `manual` evidence row still blocks (BI-4A222439).
  - A `conflict` or `malformed` objective reconciliation still blocks.
  - Without a merge, delivery is still owed.
- **Contractual items** keep today's behaviour exactly: acceptance evidence and objective reconciliation are owed.
- **Acceptance sweep.** No code change. It reads the same evaluation through `get_backlog_item`, so under the recorded operator pre-authorisation (BI-45D3BBF4) it closes merged non-contractual items. A test covers this path.
- **Intake.** `ingestBacklogItem` takes an optional `outcome` and an optional `howWeKnow`. Every caller of the ingest front door can pass them; it writes them into the body as `## Outcome` and `## How we'll know`. `create_backlog_item` exposes both, and returns a soft advisory when the item states no outcome. The advisory never refuses. The portal backlog form gets an Outcome field. Build Studio intake files through `create_backlog_item`, and coworker intake files through `create_backlog_item` or the ingest front door, so both reach the same capture.
- **Every other filing route (BI-458CCA8D).** Routes where no person types an outcome derive one from what they observed, in fixed text with no model call (kernel DI-E7C174B8C21E):
  - issue-report triage and the admin "send to Build Studio" fix: the reported problem no longer happens on its route;
  - `register_tech_debt`: takes `outcome` / `howWeKnow`; without them, the shortcut is replaced by the intended design;
  - Build Studio decomposition children: the child's scope summary, as one part of the parent; design-review auto-intake: the build's constrained goal;
  - detectors: the waste or failure that stops. For example, an MCP efficiency retry storm files "`<tool>` calls stop retry-storming". This covers A2A health, improvement signals, the process observer, corrective build and self-upgrade failures, functional smoke failures, acceptance misses, flow-review escalation, the local-only knowledge sweep, the canonical digest, improvement proposals, client-capability drift and catalog gaps;
  - requests carried from elsewhere (peer demand, upstream issues, founder demand clusters) keep the requester's stated outcome and derive one only when there is none.

  `outcome-every-intake-route.test.ts` fails when a new filing call site in `apps/web` passes no outcome. Excluded: federation work-sync, which replicates a peer's item as it is, and the one-off seed, restore and reconcile scripts under `packages/db/scripts`.

## Comparable practice

- Continuous delivery and trunk-based development (Humble & Farley, *Continuous Delivery*; DORA): a change merged through the pipeline is done, and a regression is new work.
- Scrum's Definition of Done: one team-wide standard instead of per-item sign-off.
- User acceptance testing: kept for contractual deliverables.

DPF adopts the first two as the default, and keeps the third only for items tagged `contractual`.

## Amendment 2026-10-28: the outcome is a field (BI-8DE5429B)

Founder direction, 2026-10-28: "The outcome is an aspect of the BI. No BI should be without a clear outcome." This supersedes the "Intake" bullet above, which kept the outcome in the body.

- `BacklogItem.outcome` holds the outcome, and `outcomeSource` is `stated` or `derived` (WWMD DI-342D45001EF5). The ingest front door and `create_backlog_item` write the field. With no outcome given, an Outcome section in the body is lifted as stated. Otherwise a deterministic draft is derived from the title and work type and stored as derived (DI-D50BBC916B6D). `update_backlog_item` takes `outcome` and marks it stated.
- The hourly job `ops/backlog-outcome-reconcile` fills open items with no outcome through the same derivation, 250 per run. That includes routes that still compose an Outcome section into the body.
- A Workroom's outcome is the outcome of the item it carries, read when the room is read. A claim sets `Workroom.objective` to it (DI-139981F74A44).
- Outcome observations are per item, linked by `ProductOutcomeObservation.backlogItemId`. Delivery records achieved, a reopen from done records regressed, and failing evidence while done records not achieved. The epic and platform-work objectives are only the roll-up (DI-19ED69C312FC). This supersedes the cohort hold rate of BI-42399593 (DI-321FE7AC7AA4).
