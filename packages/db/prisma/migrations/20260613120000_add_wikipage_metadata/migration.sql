-- Add a free-form frontmatter metadata bag to WikiPage (mirrors
-- PromptTemplate.metadata). Profession-corpus pages persist the WSID variant
-- axes (professionJurisdiction / professionCompetencyLevel) here so the AI
-- Coworker HRIS surface can query jurisdiction/competency coverage at runtime
-- without typed/indexed columns. Nullable + additive (no backfill required).
ALTER TABLE "WikiPage" ADD COLUMN "metadata" JSONB;
