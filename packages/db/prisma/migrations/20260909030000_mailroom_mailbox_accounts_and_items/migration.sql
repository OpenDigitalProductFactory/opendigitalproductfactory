-- Mailroom: declared mailboxes and mailroom columns on the inbound message store
-- (BI-1DDFC3D1; design docs/superpowers/specs/2026-09-09-mailroom-email-triage-and-dispatch-design.md §4.3).
--
-- Forward-only. Applies against any existing data state: every new column on
-- "InboundChannelMessage" is nullable (or defaulted), so existing marketing rows
-- are untouched, and the new unique index tolerates them because Postgres treats
-- NULL "externalMessageId" values as distinct.

-- Closed sets (AGENTS.md §8).
CREATE TYPE "MailboxProvider" AS ENUM ('imap', 'microsoft365', 'postmark-inbound');
CREATE TYPE "MailboxStatus" AS ENUM ('pending', 'connected', 'error', 'paused');
CREATE TYPE "MailroomUrgency" AS ENUM ('immediate', 'hours', 'days', 'weeks');
CREATE TYPE "MailroomItemStatus" AS ENUM ('received', 'noise', 'quarantined', 'routed', 'acknowledged', 'replied', 'closed');

-- Where the business listens.
CREATE TABLE "MailboxAccount" (
  "id"                   TEXT NOT NULL,
  "mailboxId"            TEXT NOT NULL,
  "organizationId"       TEXT NOT NULL,
  "address"              TEXT NOT NULL,
  "displayName"          TEXT,
  "purposeKey"           TEXT NOT NULL,
  "provider"             "MailboxProvider" NOT NULL,
  "status"               "MailboxStatus" NOT NULL DEFAULT 'pending',
  "settings"             JSONB NOT NULL,
  "secretsEnc"           TEXT,
  "cursor"               JSONB,
  "pollIntervalMinutes"  INTEGER NOT NULL DEFAULT 60,
  "lastPolledAt"         TIMESTAMP(3),
  "nextPollAt"           TIMESTAMP(3),
  "lastPollStatus"       TEXT,
  "lastError"            TEXT,
  "lastMessageAt"        TIMESTAMP(3),
  "createdByPrincipalId" TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MailboxAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailboxAccount_mailboxId_key" ON "MailboxAccount"("mailboxId");
CREATE UNIQUE INDEX "MailboxAccount_organizationId_address_key" ON "MailboxAccount"("organizationId", "address");
CREATE INDEX "MailboxAccount_organizationId_status_idx" ON "MailboxAccount"("organizationId", "status");
CREATE INDEX "MailboxAccount_nextPollAt_idx" ON "MailboxAccount"("nextPollAt");

-- @migration-safety: data-safe: the table is created empty by the statement above,
-- so no row can violate the foreign key at the moment it is added.
ALTER TABLE "MailboxAccount"
  ADD CONSTRAINT "MailboxAccount_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Mailroom columns on the existing inbound message store. All nullable or
-- defaulted; marketing rows keep "classification" and gain nothing else.
ALTER TABLE "InboundChannelMessage"
  ADD COLUMN "mailboxAccountId"          TEXT,
  ADD COLUMN "toAddress"                 TEXT,
  ADD COLUMN "mailroomStatus"            "MailroomItemStatus",
  ADD COLUMN "reasonKey"                 TEXT,
  ADD COLUMN "urgency"                   "MailroomUrgency",
  ADD COLUMN "queueKey"                  TEXT,
  ADD COLUMN "subjectRef"                TEXT,
  ADD COLUMN "triageSummary"             TEXT,
  ADD COLUMN "triageFlagged"             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "routedWorkItemId"          TEXT,
  ADD COLUMN "acknowledgeBy"             TIMESTAMP(3),
  ADD COLUMN "acknowledgedAt"            TIMESTAMP(3),
  ADD COLUMN "acknowledgedByPrincipalId" TEXT,
  ADD COLUMN "repliedAt"                 TIMESTAMP(3);

-- @migration-safety: data-safe: the column is added NULL on every existing row by
-- the statement above, so no existing row can violate the foreign key.
ALTER TABLE "InboundChannelMessage"
  ADD CONSTRAINT "InboundChannelMessage_mailboxAccountId_fkey"
  FOREIGN KEY ("mailboxAccountId") REFERENCES "MailboxAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Idempotency as a database fact. Existing marketing rows with a duplicate
-- (channelId, externalMessageId) pair would block this index; the Postmark
-- route has keyed its durable delivery on externalMessageId since it shipped,
-- so none should exist. If one does, the duplicate is a defect to resolve, not
-- a row to silently drop — the migration stops and names it.
CREATE UNIQUE INDEX "InboundChannelMessage_channelId_externalMessageId_key"
  ON "InboundChannelMessage"("channelId", "externalMessageId");

CREATE INDEX "InboundChannelMessage_mailboxAccountId_receivedAt_idx"
  ON "InboundChannelMessage"("mailboxAccountId", "receivedAt");
CREATE INDEX "InboundChannelMessage_mailroomStatus_acknowledgeBy_idx"
  ON "InboundChannelMessage"("mailroomStatus", "acknowledgeBy");
