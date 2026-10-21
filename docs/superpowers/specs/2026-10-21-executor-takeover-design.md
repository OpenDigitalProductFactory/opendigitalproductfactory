---
status: draft
---

# Take over an executor's unfinished work in one step

**Backlog:** BI-E2871BDE. **Epic:** none yet (candidate: EP-CLIENT-CONFIG).
**Builds on:** `reassign_workroom_executor`, `get_workroom`'s not-admitted
handover hint, [room handover design](2026-09-30-room-handover-design.md)
(BI-F25A5FC7). **Related:** BI-1DDCE164 owns stopping stage tasks on terminal
rooms. This design does not repeat it.

## 1. Problem

An assistant often reaches its capacity limit before its PR merges. The
operator then asks another assistant to finish the work. On 2026-10-13 Claude
took over PRs #6267, #6275 and #6276 from Codex. Five steps were slow or
blind:

1. **No lookup from a PR to its Workroom.** The operator gave only PR numbers.
   `list_workrooms` has no branch or PR filter. For an OAuth assistant it also
   returns only rooms where *both* the person and the calling assistant appear
   as lease holder, creator or requester (`list-observation.ts`). Rooms another
   assistant made for the same person are invisible. The three rooms were found
   only by calling `adopt_worktree` and reading its `branch_occupied` error.
2. **No record of work in flight.** The #6275 worktree held 13 uncommitted
   files with no note of which failing checks they addressed. The new
   assistant had to rebuild that by matching CI logs against the diff.
3. **One approval per room.** One instruction ("take over these PRs") raised
   three `reassign_workroom_executor` approvals. Until each was approved,
   `get_workroom` refused to show the room's history.
4. **Rooms never learned their PR merged.** All three rooms kept their
   pre-takeover head SHA and stale state. One stayed escalated as
   `true-merge-conflict`. Its drive then dispatched a "repair" agent every 15
   minutes for a week. That last part belongs to BI-1DDCE164.
5. **No written procedure.** Nothing tells a receiving agent what to do.

## 2. Research and benchmarking

| Practice | What it does | DPF takes | DPF leaves |
|---|---|---|---|
| Temporal activity heartbeats | A worker heartbeats with a small `details` payload. If the worker dies, the retried attempt receives the last details and resumes from that checkpoint. | The checkpoint rides the heartbeat the agent already sends, and the server hands it to whoever resumes. Recovery needs nothing from the dead worker. | Automatic retry. A person still decides who takes over. |
| Kubernetes `Lease` (coordination.k8s.io) | `holderIdentity` plus `renewTime`. A candidate may acquire an expired lease, and every holder change is a visible transition. | The existing lease expiry is the signal that a room is takeable. The handover records the transition. | Silent acquisition on expiry. DPF keeps the person's approval (BI-06AE037F). |
| GitHub: find work by branch or PR | Branch and PR number are the user's handle on work. `gh pr view` resolves either one. | Accept a PR number or branch as the lookup key. | — |
| Jira bulk change (also in the room handover design) | Preview, one confirmation, per-item history. | One approval bound to an exact set of rooms. | Free-form filters. |

The shared standard: **lookup by the handle the person holds, a
server-retained checkpoint, takeover only through an explicit audited
transition, and one confirmation per set.**

What DPF rejects:
- Letting any assistant read another assistant's room content without the
  person's approval. Admission stays the boundary.
- Inferring the work in flight from the client's disk on the server. The
  platform must not depend on a client being alive (kernel:
  `platform-function-never-depends-on-a-client`). The checkpoint therefore
  lives on the server and is written while the agent is working.

## 3. Design

### 3.1 Find a room by PR or branch

`list_workrooms` gains two optional filters, `headBranch` and
`pullRequestNumber`. Either one matches exact columns that already exist on
`WorkCapsule`.

Visibility does not change for unfiltered listings. For an OAuth assistant, a
filtered query matches rooms where the **person** is admitted (as lease holder,
creator, requester or coordinator), whether or not this assistant is.

- A row the assistant is not admitted to returns only the fields
  `get_workroom` already discloses in `workroom_assistant_not_admitted`:
  `capsuleId`, `status`, `backlogItemId`, `headBranch`, `pullRequestNumber`,
  `liveness`, and the exact `handover` call.
- Nothing else is disclosed. `adopt_worktree`'s `branch_occupied` already
  reveals the id and status for the same key, so this adds no new disclosure.
  It replaces the error with a lookup.

### 3.2 Keep a checkpoint on every heartbeat

`heartbeat_workroom` accepts an optional `checkpoint` (≤ 4 KB, schema
validated):

- `nextAction`
- `addressing[]`: the check names or failure ids the in-flight edits target
- `uncommittedPaths[]`: at most 50 entries
- `headSha` and `pushed`: whether the head is on the remote
- `openRisks[]`

The server stores only the latest checkpoint, in
`workspaceState.executorCheckpoint`, with `recordedAt` and the writer
principal. It is advisory text. It never authorizes an action.

The DPF skill pack's `dpf-finishing-a-development-branch` and heartbeat
guidance are updated so agents send a checkpoint at every stage boundary.

### 3.3 Show the checkpoint before admission, and take over a set in one approval

When an assistant is not admitted, the `workroom_assistant_not_admitted` result
(from `get_workroom` and from a filtered `list_workrooms` row) adds:

- `checkpoint`: the latest one
- `pullRequest`: number and state, if bound
- `leaseExpiresAt`

That is enough to decide on a takeover without reading the room's history.
Showing it to the person's own assistant matches what `branch_occupied`
already allows.

`reassign_workroom_executor` accepts `capsuleIds[]` (1–20) as an alternative to
`capsuleId`. It composes the single-room rule per room, following the room
handover design §3.1:

1. A dry run returns each room with its current executor and lease holder,
   plus a `planDigest`: the hash of the sorted (capsuleId, fromExecutor,
   expectedLeaseHolder) tuples.
2. Apply takes the same set and the `planDigest`. The approval envelope's
   input fingerprint binds both, so one approval covers exactly that set.
3. A room whose lease holder changed in between is skipped and reported, never
   overwritten. A different digest refuses the whole call.
4. Each room records its own `executor-changed` activity, carrying its
   checkpoint as the `handoffManifest`.

The capability (`manage_backlog`), consequence (`authority`) and approval
routing do not change.

### 3.4 Tell the room when its PR merges

When `pull-request-merged-binding` (the webhook) or the inventory sync observes
a bound PR as merged:

- it sets `workspaceState.prDelivery.status = "merged"`;
- it clears any open `prDelivery` escalation;
- it records the merge SHA.

The reaper's close-delivered path then archives the room as it already does.
Stopping the room's stage task belongs to BI-1DDCE164 AC-2, which this design
depends on rather than duplicates.

### 3.5 Takeover procedure in the delivery-surfaces runbook

Add a section "Taking over another executor's work" to
`docs/architecture/delivery-surfaces-runbook.md`:

1. Resolve each PR to its room with `list_workrooms {pullRequestNumber}`.
2. Read the checkpoint.
3. Take over the set in one approval.
4. Reconcile the uncommitted paths against the checkpoint before editing.
5. Re-run the exact-head gate after merging main.
6. Close out through the merge.

## 4. Deliverables, in order

| # | Deliverable | Shape | Depends on |
|---|---|---|---|
| D1 | §3.1 `list_workrooms` `headBranch` / `pullRequestNumber` filters, with person-scoped matching and a not-admitted row projection | small | — |
| D2 | §3.4 merged-PR observation updates `prDelivery` and clears stale escalation | small | — |
| D3 | §3.2 heartbeat `checkpoint`, plus skill-pack guidance | medium | — |
| D4 | §3.3 checkpoint in the not-admitted result, and batched `reassign_workroom_executor` | medium | D3 |
| D5 | §3.5 takeover runbook section | doc | D1, D4 |

Each deliverable ships on its own. D1 and D2 remove most of the observed
friction.

## 5. Acceptance criteria

- **AC-1:** Given a PR number or branch, an OAuth assistant acting for the
  room's person gets the room id, status and handover call from
  `list_workrooms`, even when another assistant created the room. An assistant
  acting for a different person gets nothing.
- **AC-2:** An unfiltered `list_workrooms` returns exactly what it returns
  today, for every caller kind.
- **AC-3:** A heartbeat with a checkpoint stores the latest one. A not-admitted
  `get_workroom` shows it, and an admitted one shows it in the room state.
- **AC-4:** One approval hands over a set of N rooms. A room whose lease holder
  changed after the dry run is skipped and reported. A changed set refuses the
  call.
- **AC-5:** A merged PR moves its room's `prDelivery` to `merged` and clears
  stale escalations within one sync.
- **AC-6:** The runbook section exists, and a takeover of three PRs follows it
  with one approval and no `branch_occupied` probing.

## 6. Risks

- **Disclosure through the filter (D1).** This is limited to the same person's
  rooms and to fields already disclosed. Tests cover another person's rooms
  and unfiltered listings.
- **Checkpoint accuracy (D3).** A checkpoint is the previous agent's claim, not
  evidence. The receiving agent still verifies against git and CI. The
  runbook says so.
- **Batch approval breadth (D4).** It is bound to an exact digest and capped at
  20 rooms. It never covers rooms of another person.
