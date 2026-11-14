-- BI-ED52AB82 (agent dialog broker item C, spec 2026-10-27 §6.7): MCP clients
-- subscribe to a room and hear new messages on the GET stream, from whichever
-- portal process wrote them.
--
-- 1. McpResourceSubscription: one row per (subscriber, resource). Additive.
-- 2. A trigger on WorkItemMessage insert sends pg_notify('dpf_room_message').
--    Postgres delivers a NOTIFY only when the inserting transaction commits,
--    so a stream never hears of a message a reader cannot yet see, and the
--    trigger covers every writer (people, coworkers, system notices, any
--    process) without changing them. The payload is ids only (< 200 bytes,
--    far under the 8000-byte NOTIFY limit); it carries no message content.
--    A failed notify cannot fail the insert: NOTIFY only queues, and the
--    message table stays the record that read_room_messages serves.
-- Safe against any data state and re-runnable.
CREATE TABLE IF NOT EXISTS "McpResourceSubscription" (
    "id" TEXT NOT NULL,
    "subscriberKey" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "caseKey" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpResourceSubscription_pkey" PRIMARY KEY ("id")
);

-- @migration-safety: data-safe: the table is created empty by this migration, so no existing row can violate the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "McpResourceSubscription_subscriberKey_uri_key"
  ON "McpResourceSubscription"("subscriberKey", "uri");

CREATE INDEX IF NOT EXISTS "McpResourceSubscription_workItemId_expiresAt_idx"
  ON "McpResourceSubscription"("workItemId", "expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'McpResourceSubscription_workItemId_fkey'
  ) THEN
    ALTER TABLE "McpResourceSubscription"
      ADD CONSTRAINT "McpResourceSubscription_workItemId_fkey"
      FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "work_item_message_notify_room"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'dpf_room_message',
    json_build_object(
      'workItemId', NEW."workItemId",
      'messageId', NEW."messageId",
      'createdAt', to_char(NEW."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "work_item_message_notify_room" ON "WorkItemMessage";
CREATE TRIGGER "work_item_message_notify_room"
  AFTER INSERT ON "WorkItemMessage"
  FOR EACH ROW EXECUTE FUNCTION "work_item_message_notify_room"();
