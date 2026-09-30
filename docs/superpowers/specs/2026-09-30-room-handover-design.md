---
status: draft
---

# Hand over an account's rooms in one governed approval

**Backlog:** BI-F25A5FC7. **Epic:** EP-31815F97. **Depends on:** BI-67B27832
(`Portfolio.accountablePrincipalId`, `resolveWorkOwner`).

## 1. Problem

A Workroom runs only with exactly one explicit Process Overseer (coordinator).
On the live install, 187 live rooms are coordinated by `admin@dpf.local`, a
seeded bootstrap account nobody uses. They got there through two defects, both
now fixed:

- OAuth consent bound whatever session the browser held (BI-07D21B4A).
- Scheduled work was owned by the oldest superuser (BI-67B27832).

The rooms themselves were never repaired. While admin coordinates them:

- the operator's assistant is refused room actions (`not-admitted`);
- reviewer invites fail even after the operator approves them (BI-814F86E1,
  room WC-6B9C448D);
- approvals the rooms raise go to an inbox nobody reads.

The only repair today is `appoint_room_coordinator`, one room per call, and
each call needs its own approval that expires in fifteen minutes. That means
187 approvals. The same need recurs whenever a person leaves the organization.

## 2. Research and benchmarking

| Practice | What it does | DPF takes | DPF leaves |
|---|---|---|---|
| Google Workspace: transfer ownership on user deletion | An admin names a source user and a destination; every owned file moves in one job, with a report. | One source, one decision, a per-item report. | Deleting the source is a separate act, not part of the transfer. |
| Jira: bulk change of assignee | Filter the issues, preview them, confirm once, then per-issue history records the change. | Preview before commit; one confirmation; history on each item. | Free-form filters. The set here is fixed: every live room of one account. |
| ServiceNow: reassign a departing user's work | A manager reassigns open tasks to a group or person; the audit log records who did it. | Reassignment is explicit and audited. It is never implied by an administrator's power. | Group assignment. A room needs exactly one person. |

The standard shared by all three: **preview, one explicit confirmation, a
per-item audit trail, and no silent overwrite of an item that changed in
between.** DPF adopts that.

What DPF rejects:
- An administrator acting *as* the old owner (impersonation). This is BI-06AE037F's rule.
- Automatic reassignment when an account goes quiet. The orphan warning
  (BI-61DE8177) tells a person; a person decides.

## 3. Design

### 3.1 The rule, composed rather than re-implemented

Each room is handed over by the existing single-room rule:

- `planCoordinatorAppointment` with `replaceExisting: true`;
- `standDownCoordinators` in the same transaction.

The batch adds only three things: selection, the choice of new owner, and one
approval for the whole set.

### 3.2 Selection

A room is in the set when it is not `complete`, `abandoned` or `archived`, and
its only active coordinator is the named source account's principal. A room
with no coordinator, or with some other coordinator, is outside the set: no
overwrite.

### 3.3 The new owner per room

- The room's `portfolioRole` maps to its Portfolio: `foundational`,
  `manufactureAndDeliver`, `forEmployees` or `productsAndServicesSold`.
- `resolveWorkOwner` then picks, in order: that portfolio's accountable person,
  Foundational's, and the organization's top accountable person.
- A `fallback` result is refused for that room. The handover never assigns the
  guessed install owner. The room is reported as "no accountable person set for
  <portfolio>".
- The source account is never its own destination.

### 3.4 One approval, bound to the exact set

The tool is `hand_over_rooms`: capability `manage_platform`, consequence
`authority`. It runs in two modes:

1. **Dry run** (default) writes nothing. It returns every room with its
   current coordinator, its new owner and the source of that choice, the rooms
   it refuses, and a `planDigest`: a hash of the sorted
   (capsuleId, from, to) triples.
2. **Apply** takes the same source account and the `planDigest`. The approval
   envelope's input fingerprint covers both, so one approval authorizes exactly
   that set.

At apply time the plan is recomputed:
- A room whose coordinator or destination changed since the dry run is skipped
  and reported, never overwritten (AC-3).
- A different digest refuses the whole call: "the rooms changed; run the dry
  run again".

### 3.5 Audit

Every handed-over room gets a `WorkroomActivity` row recording:
- who asked;
- the reason;
- the approval (envelope) id;
- the old and new coordinator.

The tool returns counts: handed over, skipped (changed), refused (no
accountable person).

### 3.6 Operator surface

Add a "Hand over this account's rooms" control where the orphan warning card
(BI-61DE8177) points: Admin › Platform Development. It shows the dry run and a
single Approve. Coworkers reach the same rule through the MCP tool, never a
second path.

## 4. Acceptance

- **AC-1:** One approval re-appoints every live room of the named account, and
  each room records the handover.
- **AC-2:** A dry run returns the exact room list, the new owner per room and
  the plan digest, and writes nothing.
- **AC-3:** A room whose coordinator changed between the dry run and the
  approval is skipped and reported, not overwritten.
- **AC-4:** A room whose portfolio resolves only to `fallback` is refused with
  a reason, never assigned the guessed owner.
- **AC-5 (live proof):** After running for `admin@dpf.local`:
  - zero live rooms are coordinated by it;
  - the BI-814F86E1 reviewer invite succeeds.

## 5. Risks

- **The set is large (187 rooms).** Apply runs in bounded transactions of about
  25 rooms each, so a failure part-way leaves a reported partial result that a
  re-run completes. The digest is recomputed from what remains.
- **Wrong portfolio attribution on a room.** The dry run shows the destination
  per room before anyone approves.
