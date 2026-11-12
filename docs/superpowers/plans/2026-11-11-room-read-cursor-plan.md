# Room read cursor: implementation plan

**Design:** [2026-11-11 room read cursor](../specs/2026-11-11-room-read-cursor-design.md)

**Backlog:** `BI-31E0C874` (one item; the plan is atomic). Parent design: [agent dialog broker](../specs/2026-10-27-agent-dialog-broker-design.md) §6.1.

**Workroom:** `WC-E9AEA5FD`, branch `feat/bi-31e0c874-room-read-cursor`.

## Coverage

The four phases are one deliverable, delivered in one PR. None is independently shippable:
- the columns do nothing without the read;
- the read cannot persist without the columns;
- the wake prompt has nothing to point at without the read;
- the helper is the read's own advance, exported.

| Deliverable | Backlog item | Acceptance |
| --- | --- | --- |
| Per-participant read cursor and the `unreadForMe` read | `BI-31E0C874` | AC-RRC-01 to AC-RRC-05 |

Out of scope, owned elsewhere:
- calling the helper from the push channel (`BI-ED52AB82`);
- calling the helper from supervised turns (`BI-F5D58F29`).

## Phase 1: schema and migration

- `packages/db/prisma/schema/work-coordination.prisma`: add `readCursorAt DateTime?` and `readCursorMessageId String?` to `WorkItemPresence`, with a comment naming this item.
- `packages/db/prisma/migrations/<ts>_work_item_presence_read_cursor/migration.sql`:
  - two `ADD COLUMN`s with `lock_timeout`;
  - an `@migration-safety: data-safe` header;
  - no default and no backfill.
- `changes/work-item-presence-read-cursor.data-impact.json`: a model change for `WorkItemPresence`, with both fields `governed`.

## Phase 2: the cursor module (test first)

`apps/web/lib/work-management/room-read-cursor.ts`, pure:
- `isRoomMessageForReader(message, reader)`: the "for me" filter from design §4.
- `planUnreadPage(rows, reader, limit)`: picks the delivered rows, the position consumed and `hasMore` from a scanned window.
- `compareRoomMessagePosition(a, b)`.

`apps/web/lib/work-management/room-read-cursor.server.ts`:
- `loadRoomReadCursor`, the start rules from design §4;
- `advanceRoomReadCursor`, forward-only, creating the presence row when absent;
- `readUnreadRoomMessages`, the compare-and-set loop with three attempts, then `conflict`.

Tests: `room-read-cursor.test.ts` and `room-read-cursor.server.test.ts`, with a fake db that holds rows in memory. They cover:
- AC-RRC-01: exactly once over two reads; messages for others are excluded;
- AC-RRC-02: catch-up after a gap, with paging and `hasMore`;
- the scan window still moves past messages addressed to others;
- AC-RRC-04: a lost compare-and-set restarts, and the cursor never moves backwards;
- the start rules: stored cursor, own last post, start of room.

## Phase 3: the tool

`apps/web/lib/mcp/packs/room-messaging-pack.ts`:
- `read_room_messages` takes `unreadForMe` and refuses it combined with a cursor;
- with `unreadForMe` it uses the same admission check and admitted child rooms, then calls `readUnreadRoomMessages`;
- the result adds `readCursor`;
- without `unreadForMe` the code path is unchanged (AC-RRC-03).

Tests in `room-messaging-pack.test.ts`:
- `unreadForMe` delegates and returns `readCursor`;
- combining it with `sinceCursor` is refused;
- a plain read never touches the presence cursor.

## Phase 4: the wake prompt

`apps/web/lib/work-management/room-message-addressing.ts`: `buildRoomReplyPrompt` asks the woken coworker to read with `unreadForMe: true`. `room-message-wake.server.ts` stops computing a cursor at the coworker's own last post, because the read's start rule does that now.

Tests: update the prompt assertions in `room-message-addressing.test.ts` and `room-message-wake.server.test.ts` (AC-RRC-05).

## Verification

- Affected vitest files and `pnpm --filter web typecheck`.
- `pnpm run pregate`: the foreground local-CI gate, which applies the migration on the shared lease.
- The semantic review, with the failure analysis from design §7.
- **After merge and the operator's upgrade:** on the live install, two `unreadForMe` reads by one coworker return each addressed message once, and a later read after new posts returns exactly those. Record that on `BI-31E0C874`.
