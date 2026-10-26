---
title: COO surface Phase E research
date: 2026-10-26
status: chosen
backlogItem: BI-63FB1683
workroom: WC-CB413D1B
---

# COO surface — Phase E research (BI-63FB1683)

Medium research for Coordinated Workrooms Phase E. This note is the design
choice: problem, options considered, the option chosen. It does not approve
implementation and does not replace the parent spec.

**Parent spec:** [2026-09-03-coordinated-workrooms-design.md](../specs/2026-09-03-coordinated-workrooms-design.md) §5, §8, Phase E.
**Parent plan:** [2026-09-03-coordinated-workrooms.md](../plans/2026-09-03-coordinated-workrooms.md) Phase E.
**UX-fit already decided:** [2026-10-13-workrooms-human-operations.ux-fit.json](../../ux-fit/2026-10-13-workrooms-human-operations.ux-fit.json) `decidedOption: refactor-existing-inventory`.

## Problem

The COO cannot answer whether every live Workroom is progressing, or where work
is stuck, without walking room records one by one. `/ops/workrooms` already
lists rooms with accountable name, liveness, and a next-action badge, but it
does not show last cycle, last drive action, ticks since a completing advance,
next wake, span of control, unowned/paused sets, the nested escalation path, or
tracked broadcast acknowledgements. Stall cards also surface actions in
whatever coworker panel is open instead of routing them to the authorized
owner.

Verified on this worktree at `f5492f83e1fbddc43ffa9e88d9b1ca6abd04d114`
(origin/main):

- `apps/web/app/(shell)/ops/workrooms/page.tsx` renders `WorkroomActivitySection` plus `HeldWorkroomsList`.
- `WorkroomActivitySection` loads `loadCapsuleLivenessInventory` (limit 200) and `loadRoomAccountabilityBatch`. `latestAction` is hardcoded `null`.
- `WorkroomInventory` columns: Work, accountable, next, technical details. No cycle, wake, span, or ack columns.
- `apps/web/lib/ops/` does not exist.
- Drive last action/reason/cycle already live in `readStoredWorkroomDriveState` (`workspaceState.workroomDrive`).
- Nesting and escalation already live in `projectNestedRoomCoordination` (read-only).
- `post_room_message` posts to one room (`work_room_write`). No fan-out, no ack ledger.
- `WorkroomActivity.kind` is a free string with `commandKey` uniqueness. No Prisma model is required for ask/ack.

## Options considered

### A. New `/ops/coo` route

A dedicated COO home. Rejected. The BI body already says extend `/ops/workrooms`.
The measured UX-fit decision is `refactor-existing-inventory`. A second
Operations home splits the same inventory and fights `compose-report-kit-for-reporting-ux`.

### B. Extend `/ops/workrooms` with a COO projection and broadcast-with-ack

Add a read model under `apps/web/lib/ops/` that composes existing loaders:
liveness inventory, accountability, stored drive state, nested coordination.
Render the missing columns and sets on the existing page with report-kit.
Add one MCP broadcast tool that fans `post_room_message` down `contains`,
writes `WorkroomActivity` ask/ack rows keyed by `commandKey`, and reports
missing acks. The tool posts asks. It never dispatches stages.

### C. Wait for the allocation board (BI-7AE90091)

[2026-09-15-proactivity-and-capacity-allocation-design.md](../specs/2026-09-15-proactivity-and-capacity-allocation-design.md)
extends Coordinated Workrooms and adds the allocation dimension Phase E did not
include. That board is awaiting-acceptance with no code. Rejected for this
slice: allocation is a different axis. Building it here would steal
BI-7AE90091.

### D. Ship October 25 follow-through in this slice

The 25 October amendment on the same spec (BI-4B48E7FE; slices BI-756C899D,
BI-C43FD3E5) supersedes the report-only COO interpretation for a later
recovery-supervision program. Rejected here. Phase E still ships the original
joined seam: one view plus broadcast-with-ack. Amendment fields (last verified
progress, blocker, recovery action, next check) may render empty or unknown
honestly. This slice does not dispatch recovery.

## Chosen

**B.** Extend `/ops/workrooms`. One DCO PR on `feat/coo-surface` / WC-CB413D1B.

### Comparables (spec §8, applied to this seam)

| Comparator | Adopt | Reject |
| --- | --- | --- |
| [Holacracy Constitution 4.1](https://www.holacracy.org/constitution) Lead Link | Accountability attaches to the room; conferred from above (the owner ladder already does this). Surface the owner; do not invent one. | Governance meetings and role elections. |
| [FEMA ICS](https://www.fema.gov/emergency-managers/nims/components) span of control 3–7 | Workload measurable: direct reports per owner; flag above 7. | Fixed rank chart. |
| ICS all-hands with acknowledgement | Broadcast is an ask that records who heard it. | Treating an unacked ask as done. |
| [Kubernetes owner references](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/) | Ownership is a queryable edge (`contains` + ladder). Status rollup follows it. | Cascading deletion. |
| Kubernetes Events | Cheap supervisory signal. | Events have no ack; we need tracked ack. |
| Slack threads / emoji ack | Familiar human pattern. | Chat is not the ledger; `WorkroomActivity` is. |
| [NIST AI RMF Govern](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf) | Automated actors stay on a named human escalation path (`projectNestedRoomCoordination` already terminates at a person). | New authority. |

### Implementation shape

1. **Read model** `apps/web/lib/ops/` (new directory, existing data):
   - owner from accountability / owner ladder (unowned stays unowned).
   - last cycle = `lastCycleKey`; last action/reason from `readStoredWorkroomDriveState`.
   - ticks since advance = `floor((now − last completing drive receipt recordedAt) / 15m)` using the drive cadence `*/15`; unknown when no completing receipt exists. Do not add a `lastAdvanceAt` column.
   - next wake = next 15-minute cadence boundary after last cycle, or unknown when the room is paused/`do_not_wake`.
   - span of control = count of rooms whose resolved owner is this principal; over-span when count > 7.
   - unowned and paused sets; escalation path from `projectNestedRoomCoordination`.
   - derived owners remain suggestions and never become stall-item recipients.

2. **UX:** extend `WorkroomActivitySection` / `WorkroomInventory` with report-kit
   `DataTable` / `StatCard` / `StatusBadge`. New measured UX-fit JSON for this
   slice. Theme tokens only. No `/ops/coo`.

3. **Broadcast:** new MCP tool on the room-messaging pack, grant `work_room_write`.
   Fan-out down `contains`. Each target gets a `WorkroomActivity` row
   `kind: "coo-broadcast-ask"` with shared `commandKey`. Acknowledgement writes
   `kind: "coo-broadcast-ack"` for that key. The COO view lists missing acks.
   Posts asks; never calls drive/dispatch; never `execute_workroom_stage`.

4. **Tests first:** failing unit tests for the projection (owner, cycle/action,
   ticks, span 7, next wake, unowned/paused, escalation) and for fan-out/ack
   (ask recorded, ack recorded, missing acks reported, dispatch never invoked).

### Out of scope

- BI-7AE90091 allocation board.
- BI-4B48E7FE / BI-756C899D / BI-C43FD3E5 follow-through and recovery dispatch.
- Phase F roster, Phase G OSM archetype (needs operator room/roster pass), Phase H appointments.
- New Prisma models, new Operations home, guessing owners.

## What this research does not establish

Live `/ops/workrooms` proof waits for merge plus canonical-runtime deploy.
Independent acceptance is owed after that. Native semantic review remains a
shadow publication unless a later policy change requires it.
