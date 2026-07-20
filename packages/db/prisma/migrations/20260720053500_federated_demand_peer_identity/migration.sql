-- A peer-canonical federated record needs a database-enforced identity just as
-- a local-canonical record does. Preserve the newest duplicate, quarantine any
-- older duplicates instead of deleting them, then add the inverse unique key.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "federationLinkId", "recordType", "peerRecordRef"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS duplicate_rank
  FROM "FederatedRecordMirror"
  WHERE "peerRecordRef" IS NOT NULL
)
UPDATE "FederatedRecordMirror" AS mirror
SET
  "peerRecordRef" = NULL,
  "syncStatus" = 'conflict',
  "conflictReason" = 'duplicate-peer-record-reference-remediated'
FROM ranked
WHERE mirror."id" = ranked."id"
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX "FederatedRecordMirror_link_type_peer_key"
ON "FederatedRecordMirror"("federationLinkId", "recordType", "peerRecordRef");

-- Local-canonical mirrors double as the protocol-specific durable outbox. This
-- state remains separate from the forge-operation queue while using the same
-- bounded retry discipline.
ALTER TABLE "FederatedRecordMirror"
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "lastDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "lastDeliveryError" TEXT,
  ADD COLUMN "acknowledgedVersion" INTEGER,
  ADD COLUMN "deadLetteredAt" TIMESTAMP(3);

CREATE INDEX "FederatedRecordMirror_delivery_due_idx"
ON "FederatedRecordMirror"("recordType", "canonicalSide", "syncStatus", "nextDeliveryAt");
