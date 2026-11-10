-- Adopt undelivered mirrors orphaned on a revoked link, for peers we can PROVE
-- are the same installation.
--
-- BI-6C33AF7C. demand-digest.ts walks FederatedRecordMirror by
-- `federationLinkId` for the CURRENT link only. Anything still owed on a link
-- that was later revoked is therefore never visited by any digest cycle again:
-- not dead, unreachable. Re-enrolling a peer silently orphaned its whole
-- in-flight backlog, and the reheal path (which resurrects dead letters when the
-- peer says it still needs them) could never fire for those rows -- rehealCount
-- was 0 on every row in the estate.
--
-- IDENTITY RULE -- the load-bearing part. Matched on peerInstallationId, NOT on
-- peerAuthorityUrl. The URL is an address, not an identity. On the install that
-- surfaced this, three revoked links shared ONE address but carried TWO
-- different installation ids plus a NULL, because the peer had been reinstalled:
--
--   prior link   peer installation   non-terminal mirrors
--   ----------   -----------------   --------------------
--   b618d2...    inst_5825a80...     867 pending + 7 conflict   <- same install
--   8048c7...    inst_fa9ec6...      543 dead + 97 pending      <- DIFFERENT
--   be7aa8...    (null)              780 dead + 41 pending      <- unknown
--
-- Only the first is provably the same peer as the current trusted link. The
-- other 1,461 rows are NOT touched here: adopting them would hand records
-- addressed to one installation to a different one, or guess at an identity the
-- data never recorded. They stay where they are, for an operator to decide
-- deliberately.
--
-- Moves only work the peer has not taken: pending, dead-letter, conflict.
-- `synced` and `withdrawn` are finished and are left alone.
--
-- SKIPS DUPLICATES. FederatedRecordMirror is unique on
-- (federationLinkId, recordType, localRecordRef), and most orphaned rows are
-- STALE rather than lost: when the peer was re-enrolled the record was mirrored
-- again on the new link, so the orphan is a superseded copy. Of 874 orphaned
-- rows on the same-installation prior link, 827 already had a live mirror and
-- only 47 did not. Adopting a duplicate would violate that unique index, so the
-- NOT EXISTS below adopts only records the live link does not already carry.
-- Superseded copies are left in place: they are unreachable and redundant, and
-- deleting history is a separate, deliberate decision.
--
-- @migration-safety: data-safe: re-points a foreign key between two rows that
-- both already exist; no row is created, deleted, or given a new column, and no
-- constraint is added or tightened. Only mirrors whose current link is revoked
-- AND whose peer installation matches a live link are touched, so a mirror on a
-- healthy link cannot move. Idempotent -- after it runs, no non-terminal mirror
-- sits on a revoked link that has a live same-installation sibling, so a second
-- run matches nothing. Applies cleanly against any data state, including one
-- with no federation links at all.

UPDATE "FederatedRecordMirror" AS m
SET "federationLinkId" = live."linkId"
FROM "FederationLink" AS revoked
JOIN "FederationLink" AS live
  ON live."peerInstallationId" = revoked."peerInstallationId"
 AND live."linkState" <> 'revoked'
 AND live."revokedAt" IS NULL
 AND live."linkId" <> revoked."linkId"
WHERE m."federationLinkId" = revoked."linkId"
  AND revoked."linkState" = 'revoked'
  AND revoked."peerInstallationId" IS NOT NULL
  AND m."syncStatus" IN ('pending', 'dead-letter', 'conflict')
  AND NOT EXISTS (
    SELECT 1
    FROM "FederatedRecordMirror" AS existing
    WHERE existing."federationLinkId" = live."linkId"
      AND existing."recordType" = m."recordType"
      AND existing."localRecordRef" = m."localRecordRef"
  );
