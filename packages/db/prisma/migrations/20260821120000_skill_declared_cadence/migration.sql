-- TAK §8.11: a skill must be able to declare that it runs on a cadence.
-- Nullable, no default: absent means "only when invoked", which is the
-- existing behaviour of every skill, so this is a pure expand.
ALTER TABLE "SkillDefinition" ADD COLUMN "cadence" TEXT;
