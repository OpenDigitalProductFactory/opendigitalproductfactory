-- BI-31E0C874 / DI-87225C71AAE4: each room participant's read position, kept on
-- its WorkItemPresence row for the room (design 2026-11-11-room-read-cursor §3).
-- @migration-safety: data-safe: two nullable columns, no default or backfill.
-- Every existing row reads as "no position yet", which read_room_messages treats
-- as today's behaviour; nothing is rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "WorkItemPresence"
  ADD COLUMN "readCursorAt" TIMESTAMP(3),
  ADD COLUMN "readCursorMessageId" TEXT;

COMMIT;
