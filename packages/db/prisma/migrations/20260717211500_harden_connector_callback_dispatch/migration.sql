ALTER TABLE "IntegrationCallbackReceipt"
  ADD COLUMN "dispatchLeaseToken" TEXT,
  ADD COLUMN "dispatchLeaseExpiresAt" TIMESTAMP(3);

-- Existing duplicates are retained safely; only inbound responder drafts must
-- be unique. Abort with actionable evidence rather than silently deleting data.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "OutboundDraft"
    WHERE "sourceType" = 'inbound-channel-message' AND "sourceId" IS NOT NULL
    GROUP BY "sourceId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate inbound responder drafts must be reconciled before migration';
  END IF;
END $$;
CREATE UNIQUE INDEX "OutboundDraft_inbound_source_key"
  ON "OutboundDraft"("sourceId")
  WHERE "sourceType" = 'inbound-channel-message' AND "sourceId" IS NOT NULL;
