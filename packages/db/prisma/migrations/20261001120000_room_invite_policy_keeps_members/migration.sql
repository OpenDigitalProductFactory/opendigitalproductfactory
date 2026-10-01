-- BI-16DA79C5: an invite into a room with no prior policy wrote a policy that
-- admitted only the invitee. Room access treats an explicit policy as a
-- restriction, so the room's own active members were locked out.
--
-- Repair: for each WorkItem whose latest workroomPolicy leaves out an active
-- member of its room, append a corrected snapshot (evidence is append-only and
-- latest-wins). Active members are admitted; those whose role acts also get
-- action rights. Nothing is removed. Idempotent: a repaired item no longer
-- leaves anyone out, so a re-run touches nothing.
--
-- @migration-safety: data-safe — appends one evidence entry per affected
-- WorkItem; no row is deleted and no existing entry is changed.

WITH latest AS (
  SELECT wi.id AS work_item_id,
         CASE WHEN jsonb_typeof(wi.evidence) = 'array' THEN wi.evidence ELSE jsonb_build_array(wi.evidence) END AS evidence,
         (SELECT x.e -> 'workroomPolicy'
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(wi.evidence) = 'array' THEN wi.evidence ELSE jsonb_build_array(wi.evidence) END)
                 WITH ORDINALITY AS x(e, n)
           WHERE jsonb_typeof(x.e) = 'object' AND x.e ? 'workroomPolicy'
           ORDER BY x.n DESC LIMIT 1) AS policy
    FROM "WorkItem" wi
   WHERE wi.evidence IS NOT NULL AND wi.evidence::text LIKE '%workroomPolicy%'
),
members AS (
  SELECT w."workItemId" AS work_item_id,
         p."principalId" AS ref,
         bool_or(wp.roles && ARRAY['accountable', 'coordinator', 'contributor', 'specialist', 'approver', 'reviewer']::"WorkroomParticipantRole"[]) AS can_act
    FROM "WorkCapsule" w
    JOIN "WorkCapsuleParticipant" wp ON wp."workroomId" = w.id
    JOIN "Principal" p ON p.id = wp."principalId"
   WHERE wp.lifecycle = 'active' AND w."workItemId" IS NOT NULL
   GROUP BY w."workItemId", p."principalId"
),
broken AS (
  SELECT l.work_item_id, l.evidence, l.policy
    FROM latest l
   WHERE jsonb_typeof(l.policy) = 'object'
     AND jsonb_typeof(l.policy -> 'admittedPrincipalRefs') = 'array'
     AND EXISTS (SELECT 1 FROM members m
                  WHERE m.work_item_id = l.work_item_id
                    AND NOT (l.policy -> 'admittedPrincipalRefs') ? m.ref)
)
UPDATE "WorkItem" wi
   SET evidence = b.evidence || jsonb_build_array(jsonb_build_object('workroomPolicy',
         b.policy || jsonb_build_object(
           'admittedPrincipalRefs', (
             SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM (
               SELECT jsonb_array_elements_text(b.policy -> 'admittedPrincipalRefs') AS v
               UNION SELECT m.ref FROM members m WHERE m.work_item_id = b.work_item_id
             ) s),
           'actionPrincipalRefs', (
             SELECT COALESCE(jsonb_agg(DISTINCT v ORDER BY v), '[]'::jsonb) FROM (
               SELECT jsonb_array_elements_text(
                        CASE WHEN jsonb_typeof(b.policy -> 'actionPrincipalRefs') = 'array' THEN b.policy -> 'actionPrincipalRefs' ELSE '[]'::jsonb END) AS v
               UNION SELECT m.ref FROM members m WHERE m.work_item_id = b.work_item_id AND m.can_act
             ) s)
         )))
  FROM broken b
 WHERE wi.id = b.work_item_id;
