-- Repair rooms that already carry more than one active Process Overseer.
--
-- BI-061B2BC0. appoint_room_coordinator's `replaceExisting` authorized the
-- appointment and then wrote ONLY the appointee -- nothing ever stood the
-- incumbent down. The tool reported "X is now the Process Overseer" while
-- leaving the previous one active, so a deliberate handover silently produced
-- two coordinators. selectRoomCoordinator throws on that (multiple_active_
-- coordinators) and conformance treats it as blocking, so the "replacement"
-- left the room MORE stuck than before and every later read of it failed.
--
-- Observed on this operator install: one room (WC-60566397, "Work on
-- BI-B19AF1F3", status blocked) with two active coordinators appointed 84
-- minutes apart, the second explicitly reasoned as a replacement for the first.
-- The Inngest step that reads that room had been failing on every attempt.
--
-- Repair rule: keep the MOST RECENT coordinator and demote the earlier ones.
-- The latest appointment is the one the operator most recently intended, and on
-- this install that is exactly the documented intent of the second row.
--
-- Demote, do not evict: a handover removes the coordinator role but keeps the
-- principal in the room. If coordinator was their only role they become a
-- contributor, so no participant is left with an empty role set. This mirrors
-- rolesAfterStandDown() in appoint-room-coordinator.ts -- same rule, applied
-- once to history here and on every future handover there.
--
-- @migration-safety: data-safe: touches ONLY rows that are already in a state
-- the application treats as a hard error, and only rooms with MORE THAN ONE
-- active coordinator. Every such room keeps exactly one. No row is deleted, no
-- participant loses room membership, no column or constraint changes. Idempotent
-- -- a second run matches nothing because no room has two coordinators left.
-- Applies cleanly against any data state, including one with no affected rows.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "workroomId"
      ORDER BY "createdAt" DESC, id DESC
    ) AS rn
  FROM "WorkCapsuleParticipant"
  WHERE lifecycle = 'active'
    AND 'coordinator' = ANY(roles)
)
UPDATE "WorkCapsuleParticipant" AS p
SET
  roles = CASE
    WHEN array_length(array_remove(p.roles, 'coordinator'::"WorkroomParticipantRole"), 1) IS NULL
      THEN ARRAY['contributor']::"WorkroomParticipantRole"[]
    ELSE array_remove(p.roles, 'coordinator'::"WorkroomParticipantRole")
  END,
  "lifecycleReason" = 'Stood down as Process Overseer: room carried multiple active coordinators (BI-061B2BC0 repair).',
  "lifecycleAt" = NOW()
FROM ranked AS r
WHERE p.id = r.id
  AND r.rn > 1;
