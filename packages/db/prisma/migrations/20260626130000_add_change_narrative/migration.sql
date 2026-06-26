-- BI-D93CF6C0: plain-language change narrative (Band 2 of the Build Studio
-- overseer "Solution & Oversight" layer). Additive, nullable — older builds
-- simply have no narrative and fall back to the raw diffSummary dive-in.
ALTER TABLE "FeatureBuild" ADD COLUMN "changeNarrative" JSONB;
