---
status: draft
---

# Hand over an account's live work in one governed approval

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

### 1.1 Scope widened after live inventory (2026-10-01)

After BI-67B27832 deployed and the four portfolios were given an accountable
person, the account still owns more than rooms:

| Live work owned by `admin@dpf.local` | Count |
|---|---|
| Workrooms it coordinates, not terminal | 187 |
| Build Studio builds it created, in plan, ideate, build, ship or review | 127 |
| Scheduled coworker tasks (`ScheduledAgentTask.ownerUserId`) | 93 (20 active) |

Each of these routes its approvals and actions to the absent account. A builder
that re-homes only rooms leaves builds and scheduled tasks orphaned. The
handover therefore covers all three kinds, chosen per item by the same
portfolio rule (§3.3). The code paths that still mint new admin-owned work are
fixed separately, by the item that removes the remaining "first superuser"
fallbacks.

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

The set has three kinds of item, all owned by the named source account:

- **Rooms:** not `complete`, `abandoned` or `archived`, and the source
  account's principal is the only active coordinator. A room with no
  coordinator, or with some other coordinator, is outside the set: no
  overwrite.
- **Builds:** `createdById` is the source account and the phase is not
  terminal (`complete`, `failed` or `abandoned`). The new owner comes from the
  build's portfolio. Only ownership changes; the build's history and phase stay
  as they are.
- **Scheduled tasks:** `ownerUserId` is the source account. The new owner comes
  from the task's portfolio when it has one, otherwise Foundational. Paused
  tasks move too, so they are not orphaned when resumed.

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
   (kind, id, from, to) tuples.
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

### 3.6 Whose authority runs the handover (live finding, 2026-09-30)

On 2026-09-30 the operator approved `appoint_room_coordinator` for
WC-6B9C448D (envelope cmuodfoinaw8101o3qlgcm6hn). Execution then refused it:
`workroom_access_denied`, "You or your assistant are not admitted to this
workroom." The refusal is correct:

- the calling assistant (AGT-EXT-CLAUDE) is not admitted to the room;
- an agent may not ride the superuser short-circuit (BI-154DAA7E);
- the only admitted human is the unused account.

No human path exists either: no server action or screen assigns a room's
coordinator. So a room owned by an absent account cannot be re-homed by
anyone today.

The handover therefore runs under the **approving human's** authority:

- The operator control is a server action. It admits a superuser as a human,
  which is the existing `authorizeWorkroomAccess` behaviour.
- The MCP tool proposes and dry-runs. Its apply step executes as the human who
  approved the envelope, never as the assistant.
- Every room's activity row records both people: the assistant that proposed
  and the human that authorized.

### 3.7 Operator surface (decided in implementation)

The first delivery is the two MCP tools, `plan_account_handover` (read-only)
and `apply_account_handover` (authority consequence), in the room-messaging
pack beside `appoint_room_coordinator`.

- An operator reaches them through their AI coworker. The apply step always
  arrives in the operator's inbox for approval.
- The handlers refuse unless the person behind the call holds
  `manage_platform`.
- Neither tool takes a `capsuleId`. The per-room OAuth admission check, which
  correctly refuses an assistant on a room it was never admitted to, is
  therefore not the gate. The approving person is.
- A dedicated screen is a follow-up. The orphaned-approval warning
  (BI-61DE8177) already names the account, and the coworker carries the rest.

Rooms are re-appointed through `executeCoordinatorAppointment`, extracted from
the `appoint_room_coordinator` handler, so both paths share one write rule.

## 4. Acceptance

- **AC-1:** One approval re-homes every live room, live build and scheduled
  task of the named account, and each item records the handover.
- **AC-2:** A dry run returns the exact room list, the new owner per room and
  the plan digest, and writes nothing.
- **AC-3:** If the set changed between the dry run and the approval (a room's
  coordinator, a build's owner, a new item), the digest differs and nothing
  moves. The operator re-runs the dry run. An item that fails during apply is
  reported and the rest continue; a re-run finishes it.
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

## Addendum (2026-10-14, BI-858FDE5A): the handover is recorded on the account

Re-homing existing items did not stop new work going to the retired account.
The drive named a new task's owner from a room's requester/creator, which are
history the handover rightly leaves alone. New seeded tasks went to "the oldest
superuser". By 2026-10-14 admin@dpf.local owned 10 tasks created after its
2026-10-01 handover.

An approved apply now also writes `User.workHandedOverAt` and
`workHandedOverById`. Rules that name an owner for new work skip a handed-over
account:

- the drive's `roomOwnerUserId` falls through to the room's accountable person;
- every scheduled-task seed and the `resolveWorkOwner` fallback use
  `findInstallWorkOwnerUserId` (`packages/db/src/install-work-owner.ts`).

If every active superuser was handed over, the fallback still returns the
oldest one, so a seed never stops an upgrade. Historical requester and creator
fields are unchanged. A migration backfills the marker from the BuildActivity
rows past applies left.


## Addendum (2026-10-14, BI-9D2199D4): a handover moves work, not access

A handed-over account can still sign in, and its agent credentials stay live.
On 2026-10-02 the operator connected Codex under admin@dpf.local, a day after
its handover, and the new room went back to admin. `User.isActive` stays the
access switch. The handover does not revoke credentials: the approver is often
the same account, and revoking would not have stopped a fresh sign-in
(principle_decide DI-F60AEA3E7D84 chose this over refusing or revoking).

- OAuth consent under a handed-over account says when its work was handed over.
  Connect needs a ticked `acknowledge_handover` naming the session's account;
  the POST refuses any other and shows the screen again. The audit row records
  `accountWorkHandedOverAt`.
- `plan_account_handover` reports `liveAgentCredentials` (live access tokens
  and refresh grants), outside the digest. The approver ends them through the
  per-account panel (see the BI-DB506554 addendum; the menu path first given
  here did not exist).

## Addendum (2026-10-21, BI-F0E946D2): seeds name the accountable person

Skipping the handed-over account was not enough. The seeds still guessed the
oldest remaining superuser, and on 2026-10-16 a new seeded task went to a
superuser who is not the accountable person. The portfolio owner walk
(`resolveWorkOwner`: portfolio, Foundational, organization, then the guess) now
lives in `packages/db/src/install-work-owner.ts`. apps/web re-exports it, and
every task seed names a new task's owner through `findTaskOwnerUserId`. A guard
test fails a seed that calls the guess directly.

## Addendum (2026-10-27, BI-DB506554): one place to see and end an account's agent access

On 2026-10-27 admin@dpf.local, handed over, still held 4 personal tokens, a
Codex refresh grant and the credentials client "DPF Grok connection", which
minted a token that day with no consent screen. The operator could not find
the revoke screen: the consent page and `plan_account_handover` named
"Admin › Platform Development › MCP", a path no menu shows.

- **Location from the nav model.** `lib/navigation/admin-location.ts` builds
  the path from `PORTAL_SHELL_SECTIONS`, the Admin record's `setupFor`, the
  area's Setup tab label and `ADMIN_FAMILIES`:
  Run the platform › Setup › Admin › Contributing & GitHub. A test walks every
  step against the model, so a menu change breaks the test, not the message.
- **Agent access for one account** (`/admin/platform-development?account=<email>#agent-access`,
  `lib/auth/account-agent-access.ts`): the account's live personal tokens,
  its OAuth access tokens and refresh grants grouped by client, and the
  credentials clients it owns. Operator-gated (`manage_provider_connections`).
- **End this account's agent access**: one governed action with a required
  reason. It revokes every unrevoked token and refresh grant of the account
  and its credentials clients, stamped
  `operator_revoked_person: <reason> (by <operator>)`, the same stamp and
  guards as the per-client control (`personRevocation`). It refuses the
  operator's own account. Interactive registrations the account merely
  created stay, because other people may hold grants under them.
- **Credentials clients at the token endpoint.** principle_decide
  DI-ECD8C6F6FFB4 chose surface (9.89) over refuse (5.93) and warn (5.76):
  nobody reads a warning on a headless call, and refusing would break an
  integration at handover, against DI-F60AEA3E7D84. The token endpoint is
  unchanged. `liveAgentCredentials` now also counts `credentialsClients`,
  and `plan_account_handover` names the panel's path and link whenever
  anything is live.
