-- BI-F4866228: retire the backlog copies the inbound issue triage filed from a
-- same-organization peer's demand envelopes.
--
-- A same-organization peer sends its whole backlog as demand envelopes, and
-- work sync already mirrors that backlog here. Until the intake read only live
-- cross-organization links, it filed each envelope as a new item: the first
-- commissioned production run created about 4,000 of them.
--
-- Scope: items still in `triaging` (untouched since filing) that carry an
-- `ecosystem-peer-demand` origin whose mirror belongs to a same-org-peer link.
-- Anything a person or agent has already moved is left alone. On an install
-- that never commissioned the intake this matches nothing.
--
-- Retire, never delete, so each row stays inspectable and restorable. A copy
-- whose title matches an item filed through any other path is recorded as its
-- duplicate; the rest are copies of work the peer installation tracks itself.

WITH copies AS (
  SELECT b.id, b.title
  FROM "BacklogItem" b
  JOIN "FederatedRecordMirror" m
    ON m."mirrorId" = substring(b.body FROM '\[origin:ecosystem-peer-demand:(fdm_[A-Za-z0-9]+)\]')
  JOIN "FederationLink" l ON l."linkId" = m."federationLinkId"
  WHERE b.status = 'triaging'
    AND b.body LIKE '%[origin:ecosystem-peer-demand:%'
    AND l.role = 'same-org-peer'
),
originals AS (
  SELECT DISTINCT ON (c.id) c.id AS copy_id, o.id AS original_id
  FROM copies c
  JOIN "BacklogItem" o
    ON o.title = c.title
   AND o.id <> c.id
   AND o.body NOT LIKE '%[origin:ecosystem-peer-demand:%'
  ORDER BY c.id, o."createdAt"
)
UPDATE "BacklogItem" b
SET status = 'retired',
    "triageOutcome" = CASE WHEN o.original_id IS NULL THEN 'discard' ELSE 'duplicate' END,
    "duplicateOfId" = o.original_id,
    resolution = CASE
      WHEN o.original_id IS NULL
        THEN 'Retired (BI-F4866228): copy of a same-organization peer installation''s own backlog item, filed by inbound issue triage. The peer installation tracks this work.'
      ELSE 'Retired (BI-F4866228): duplicate filed by inbound issue triage from a same-organization peer''s demand envelope.'
    END,
    "abandonReason" = CASE
      WHEN o.original_id IS NULL
        THEN 'Copy of a same-organization peer installation''s item (BI-F4866228)'
      ELSE NULL
    END,
    "completedAt" = now(),
    "updatedAt" = now()
FROM copies c
LEFT JOIN originals o ON o.copy_id = c.id
WHERE b.id = c.id;
