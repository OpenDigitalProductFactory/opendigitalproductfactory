-- @migration-safety: data-safe. BI-D2AA1064 changes only index semantics.
-- Existing publication receipts are untouched. Current remote identity and
-- duplicate prevention belong to ExternalChannelProjection; OutboundPublication
-- remains an append-only event ledger and may therefore contain one receipt per
-- create/update event against the same channel resource.

DROP INDEX IF EXISTS "OutboundPublication_channelId_externalId_key";

CREATE INDEX "OutboundPublication_channel_external_idx"
  ON "OutboundPublication"("channelId", "externalId");
