-- Mailroom follow-on (BI-1DDFC3D1): declare the principal and WorkItem references as
-- real foreign keys, type the last-poll outcome, and rename the public id to
-- mailboxRef so the FK-coverage ratchet does not read it as a bare foreign key.
-- The previous migration is immutable once committed; this one carries the delta.
--
-- Forward-only. Applies against any existing data state: MailboxAccount is empty
-- on every install that has not yet connected a mailbox, and the referenced
-- InboundChannelMessage columns are NULL on every row written before this
-- migration, so no constraint here can fail on existing data.

CREATE TYPE "MailboxPollStatus" AS ENUM ('ok', 'error');

-- @migration-safety: data-safe: every existing value of "lastPollStatus" was written
-- by the intake as 'ok' or 'error', the exact members of the new type; any other
-- value would be a defect and stops the migration rather than being coerced.
ALTER TABLE "MailboxAccount"
  ALTER COLUMN "lastPollStatus" TYPE "MailboxPollStatus"
  USING ("lastPollStatus"::"MailboxPollStatus");

ALTER TABLE "MailboxAccount" RENAME COLUMN "mailboxId" TO "mailboxRef";
ALTER INDEX "MailboxAccount_mailboxId_key" RENAME TO "MailboxAccount_mailboxRef_key";

CREATE INDEX "MailboxAccount_createdByPrincipalId_idx" ON "MailboxAccount"("createdByPrincipalId");

-- @migration-safety: data-safe: "createdByPrincipalId" is written only by the connect
-- action from a resolved Principal, and is NULL otherwise; NOT VALID so a row from
-- a principal later removed can never block an upgrade.
ALTER TABLE "MailboxAccount"
  ADD CONSTRAINT "MailboxAccount_createdByPrincipalId_fkey"
  FOREIGN KEY ("createdByPrincipalId") REFERENCES "Principal"("principalId")
  ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- @migration-safety: data-safe: both columns are NULL on every row written before
-- this migration; NOT VALID so legacy rows can never block an upgrade, while new
-- rows are checked as they are written.
ALTER TABLE "InboundChannelMessage"
  ADD CONSTRAINT "InboundChannelMessage_routedWorkItemId_fkey"
  FOREIGN KEY ("routedWorkItemId") REFERENCES "WorkItem"("itemId")
  ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "InboundChannelMessage"
  ADD CONSTRAINT "InboundChannelMessage_acknowledgedByPrincipalId_fkey"
  FOREIGN KEY ("acknowledgedByPrincipalId") REFERENCES "Principal"("principalId")
  ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

CREATE INDEX "InboundChannelMessage_routedWorkItemId_idx"
  ON "InboundChannelMessage"("routedWorkItemId");
CREATE INDEX "InboundChannelMessage_acknowledgedByPrincipalId_idx"
  ON "InboundChannelMessage"("acknowledgedByPrincipalId");
