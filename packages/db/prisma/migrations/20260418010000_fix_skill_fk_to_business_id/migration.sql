-- Repoint SkillAssignment.skillId and SkillMetric.skillId foreign keys from
-- SkillDefinition.id (cuid) to SkillDefinition.skillId (business identifier).
-- Every caller already treats the column as the business id. Previous FK made
-- inserts impossible against file-based seed data.

ALTER TABLE "SkillAssignment" DROP CONSTRAINT "SkillAssignment_skillId_fkey";
ALTER TABLE "SkillMetric"     DROP CONSTRAINT "SkillMetric_skillId_fkey";

ALTER TABLE "SkillAssignment"
  ADD CONSTRAINT "SkillAssignment_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("skillId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SkillMetric"
  ADD CONSTRAINT "SkillMetric_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("skillId")
  ON DELETE CASCADE ON UPDATE CASCADE;
