-- BI-EB4BB4A0: an approved Build Studio plan's build dispatch is owed as a
-- WorkroomEffect committed in the same transaction as the plan→build phase
-- write, and run once by the Workroom effect worker (the absorbed T3 outbox).
-- Additive enum value; safe against any data state and re-runnable.
ALTER TYPE "WorkroomEffectKind" ADD VALUE IF NOT EXISTS 'dispatch-build';
