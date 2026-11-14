---
status: draft
---

# Room read cursor: each participant reads what is unread for it

**Date:** 2026-11-11

**Status:** Draft; awaiting independent spec approval

**Backlog:** `BI-31E0C874` (B2b of the agent dialog broker) under `EP-E1F1DB58`.

**Workroom:** `WC-E9AEA5FD`

**Parent design:** [Agent dialog broker](2026-10-27-agent-dialog-broker-design.md) §6.1 and the B2b row in §11. This document is the canonical design for B2b. It amends §6.1 on one point, where the cursor is stored (§3 below), and §6.1 now points here.

**Decision:** `DI-87225C71AAE4`: store the cursor on `WorkItemPresence`. Scored 12.68; on `WorkroomParticipant` 6.35; a new model 8.72. High confidence, no commandment conflict.

## 1. What this adds

A coworker can read a Work Room with `unreadForMe: true` and get only what it has not yet been handed: messages addressed to it, or to the room as a whole, since its own position. The read moves that position forward, so asking twice never returns a message twice. A coworker that was disconnected for a day picks up exactly where it stopped.

Nothing else changes. Without `unreadForMe`, `read_room_messages` behaves as it does today.

## 2. What exists today (origin/main `aee1da65778`, re-checked at `89b09949eb0f` on 2026-11-13)

- **Paging.** `read_room_messages` (`apps/web/lib/mcp/packs/room-messaging-pack.ts`) pages a room's messages, and its admitted child rooms', by an opaque `(createdAt, messageId)` cursor from `room-message-cursor.ts`. The caller has to keep that cursor itself. A disconnected client that lost it can only re-read the newest page.
- **Addressing.** A message records who it is addressed to in `structuredPayload.addressing` (`room-message-addressing.ts`): agent ids, the roles `coordinator` and `accountable`, and GAID `#session=` qualifiers. A message with no `addressing` is addressed to the room.
- **The wake.** An addressed message wakes its in-platform recipient through `room-message-wake.server.ts`. The woken coworker's prompt hands it a `sinceCursor` at its own last post in the room. That is the stand-in §6.1 names until this item lands.
- **Where people are.** Messages belong to a `WorkItem`. `WorkItemPresence` is the existing row per (work item, principal type, principal), written when a coworker posts (`room-agent-presence.server.ts`) and when a person views the room.
- **Push and supervised turns (built since, PRs #6977 and #6981).** Item C stores `McpResourceSubscription` rows and sends a content-free `notifications/resources/updated`. Item D gives a supervised session an addressed message as its next turn, with at most 20 room-wide messages since the session's own `deliveredCursor`, which is kept in the Workroom's `workspaceState.runtimeSession` (`apps/web/lib/workroom-runtime/supervised-turn-delivery.ts`).
- **Workrooms.** A `Workroom` is one claim of the work, and a work item can carry several over its life. The B2 live fix (PR #6964) says so: "A work item can carry several Workrooms over its life." `WorkroomParticipant` is one principal's place in one Workroom.

## 3. Where the cursor lives, and why §6.1 is amended

§6.1 put the cursor on `WorkroomParticipant`. Three facts on main argue against it:
1. **A room outlives its Workrooms.** The message stream is keyed by the work item. A backlog item gains a new Workroom on each claim, so a cursor on one participant row resets, or forks, every time the work is re-claimed.
2. **Some rooms have no Workroom at all.** A customer case room still has messages.
3. **Some readers have no participant row.** A coworker can be admitted by the room charter or by outcome scope without an invitation. It may read, but it has no `WorkroomParticipant` row to hold a cursor.

`WorkItemPresence` has none of these gaps. It is already one row per (room, principal), for agents and people, and is already written by posting. Its meaning, "where this principal is in this room", is the meaning a read position needs. The cursor is added there as two nullable columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `readCursorAt` | `timestamp(3)`, null | `createdAt` of the newest message handed to this principal |
| `readCursorMessageId` | `text`, null | that message's `messageId`, which breaks `createdAt` ties |

Both are null together, or set together. The pair is compared exactly as the paging cursor compares, so a stored cursor and an issued one agree.

**Rejected:**
- `WorkroomParticipant` (the §6.1 text), for the three reasons above. Taking the newest across every Workroom of the item would patch reason 1, but not 2 or 3.
- A new `RoomReadCursor` model. It would key the same pair the presence row already keys, so there would be two homes for one fact.

## 4. The "unread for me" read

`read_room_messages` gains `unreadForMe: true`. It cannot be combined with `sinceCursor` or `beforeCursor`.

**Who "me" is.** The acting coworker, as the canonical `principalId` that room access already resolves. Admission is checked first, exactly as for every read, so revocation still stops reads at the next call.

**Where it starts.**
1. The stored cursor, when there is one.
2. Otherwise, the coworker's own newest post in the room. A coworker that has spoken has seen what came before it, which is the assumption B2's wake already makes.
3. Otherwise, the start of the room.

**What counts as "for me".** Messages past the start, oldest first, across the room and its admitted child rooms, that the reader did not send and that are:
- addressed to the room (no `addressing`), including system notices;
- addressed to this agent, by id, by GAID or by @mention, since all three resolve to `addressing.agents`;
- addressed to a role (`coordinator` or `accountable`) that this principal holds on a live Workroom of the item;
- addressed to a session of this agent's own GAID (`<gaid>#session=…`).

A message addressed only to someone else is passed over, and the cursor still moves past it.

**How much it returns.**
- The read scans a bounded window of messages past the start (200). It returns at most `limit` of them (default 20, at most 100).
- The cursor moves to the last message it **considered**, not the last one it returned. If the page filled up, that is the last message returned. Otherwise it is the end of the scanned window.
- `hasMore` is true when messages past the new cursor remain. A room full of messages for other agents therefore still makes progress, and nothing for this reader is skipped.

**Exactly once.** The cursor moves by compare-and-set: the update applies only if the stored cursor is still the one the read started from. If another read moved it first, the read starts again from the new position, up to three times, then answers `conflict`. Two concurrent reads therefore never both return the same message, and the cursor never moves backwards.

**The result** keeps today's shape (`messages`, `hasMore`, `newestCursor`, `oldestCursor`, `order: "oldest-first"`) and adds `readCursor`, the position after this read. `readCursor` is the same opaque form, so it can be passed as `sinceCursor` in an ordinary read.

## 5. Channels that hand messages over

§6.1 says the cursor records the newest message handed to a participant on any channel. Precisely, it records the newest message handed to the principal itself, by a read or by any channel that hands over everything up to a position. One helper, `advanceRoomReadCursor({ workItemId, principalType, principalId, to })`, moves a cursor forward and never back. It creates the presence row when there is none.

- **B2 wake (built).** The wake hands over no message, only a prompt to read the room, so it does not move the cursor. Its prompt changes from "read with `sinceCursor` at your own last post" to "read with `unreadForMe: true`". The cursor then decides what the woken coworker sees.
- **C push (`BI-ED52AB82`, built).** A push notification is a hint that carries no message, so it does not move the cursor. The client then reads with `unreadForMe`, and that read moves it.
- **D supervised turns (`BI-F5D58F29`, built).** D keeps its own position per session, `deliveredCursor` on the Workroom's runtime session, which decides the room context a turn carries. It does not move the principal's read cursor, for two reasons:
  - **The session is a sub-unit of the principal.** It is one `<gaid>#session=` of an agent, the way a Matrix device belongs to a user. Read markers are kept per user, not per device.
  - **A turn hands over only some of what is unread.** It carries one addressed message and at most 20 context messages. Advancing the principal's cursor to that message would skip addressed messages outside those 20.

  A principal that later reads with `unreadForMe` may therefore see a message its session was already given as a turn. That is at least once, never a loss. The helper stays exported, so a channel that hands over everything up to a position can call it.
- **Client hooks.** A hook may call `read_room_messages` with `unreadForMe` at session start or on prompt submit. That needs no new endpoint.

## 6. Data, migration and rollout

- **Migration.** Two nullable columns on `WorkItemPresence`, with no default and no backfill. A lock timeout is set, and the change is metadata-only in Postgres. Every existing row reads as "no cursor yet", which is AC-ADB-B2b-03.
- **Lifecycle.** The columns follow their row. `WorkItemPresence` rows are deleted only with their work item.
- **Sensitivity.** Internal. A cursor names a message id and a time, and it reveals no message content.
- **Rollback.** Code that ignores the columns reads exactly as today. Dropping the columns loses only read positions, and every reader then falls back to start rule 2.

## 7. Failure analysis

| Failure | What happens |
| --- | --- |
| Two reads by one coworker at once | Compare-and-set lets one move the cursor; the other restarts from the new position. No message is returned twice. |
| The read fails after selecting messages but before the cursor moves | Nothing is returned to the caller, so the next read returns the same messages. Delivery is at least once across failures and exactly once across successful reads. |
| The cursor's message is deleted | The comparison is positional on `(createdAt, messageId)`, not a join, so the read still starts after that position. |
| The coworker loses admission | Admission is checked before the cursor is read. The read is refused and the cursor stays as it was. |
| The room is huge and the coworker has no cursor | Start rule 2 begins at its last post. Rule 3 begins at the start and pages, 200 messages scanned at a time. |
| A new Workroom is claimed for the item | The cursor is on the item's presence row, so it is unaffected. |

## 8. Objectives and acceptance

**OBJ-RRC1:** A room participant reads only what is unread for it, and its position moves forward as it reads.

**OBJ-RRC2:** Existing reads and rooms are unchanged until a participant opts in.

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-RRC-01 | OBJ-RRC1 | A coworker that reads a room with `unreadForMe` twice gets each message addressed to it, or to the room, exactly once, and never a message addressed only to another agent. |
| AC-RRC-02 | OBJ-RRC1 | After messages are posted while a coworker is not reading, its next `unreadForMe` read returns every one addressed to it or to the room since its last read, oldest first, paging with `hasMore` when they exceed the limit. |
| AC-RRC-03 | OBJ-RRC2 | A read without `unreadForMe`, and a room where no participant has read with it, return exactly what they return today. |
| AC-RRC-04 | OBJ-RRC1 | Two concurrent `unreadForMe` reads by one coworker never return the same message, and the stored cursor never moves backwards. |
| AC-RRC-05 | OBJ-RRC1 | A woken coworker's reply prompt asks it to read with `unreadForMe`, and a re-claimed work item keeps each coworker's position. |

Acceptance is functional, run on the live install after `request_self_upgrade`. Unit tests are prerequisites only.

## Design grounding

**Specs read:** [Agent dialog broker](2026-10-27-agent-dialog-broker-design.md), [Work Room communication substrate](2026-08-12-work-room-multi-agent-communication-substrate-design.md).

**Code substrate read:**
- `apps/web/lib/mcp/packs/room-messaging-pack.ts`
- `apps/web/lib/work-management/{room-message-cursor,room-message-addressing,room-message-wake.server,room-agent-presence.server,work-item-presence,room-participation-prisma.server,room-participant-assignment.server,room-agent-access.server}.ts`
- `packages/db/prisma/schema/work-coordination.prisma` (`Workroom`, `WorkroomParticipant`, `WorkItemMessage`, `WorkItemPresence`)
- PR #6964 (`fix/room-wake-live-room`), for the several-Workrooms fact

**Comparable designs:**
- **Matrix client-server API.** Read markers (`m.fully_read`) and receipts are kept per (room, user) in room account data, not per device or session. The `since` token is the client's position. Adopted: one position per (room, principal), owned by the server.
- **Slack conversations API.** `last_read` is per (channel, member) and moved by `conversations.mark`. Adopted: the position belongs to the membership in the conversation, not to a sub-unit of it.
- **Kafka consumer groups.** The committed offset is the authority, delivery is at least once, and a commit only moves forward. Adopted: compare-and-set, monotonic advance, at-least-once across failures.
