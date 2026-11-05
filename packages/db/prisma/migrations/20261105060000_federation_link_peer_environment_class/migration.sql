-- BI-0716C8A8 / DI-13CEFD0A8156: the peer's CA-attested environment class on FederationLink.
-- @migration-safety: data-safe: two nullable columns, no default or backfill. Existing
-- links read as unattested (null), never as production, so no stance widens.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "FederationLink"
  ADD COLUMN "peerEnvironmentClass" TEXT,
  ADD COLUMN "peerEnvironmentAttestedAt" TIMESTAMP(3);

COMMIT;
