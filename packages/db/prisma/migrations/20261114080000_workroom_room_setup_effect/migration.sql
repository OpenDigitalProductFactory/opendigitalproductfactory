-- BI-C64EDA33 PR 3 (AC-5, plan 2026-11-14-workroom-runtime-core): a room's
-- WorkItem anchor, which claim and adopt used to create after their
-- transaction committed (lost to a crash in between), is now owed as a
-- WorkroomEffect committed with the room and run by the effect worker.
-- Additive enum value; safe against any data state and re-runnable.
ALTER TYPE "WorkroomEffectKind" ADD VALUE IF NOT EXISTS 'ensure-workitem-anchor';
