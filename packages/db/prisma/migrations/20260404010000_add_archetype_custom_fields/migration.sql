-- Add isBuiltIn and customVocabulary fields to StorefrontArchetype
-- isBuiltIn distinguishes pre-defined templates from user-created ones
-- customVocabulary stores portal-level labels for custom archetypes

ALTER TABLE "StorefrontArchetype" ADD COLUMN "isBuiltIn" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StorefrontArchetype" ADD COLUMN "customVocabulary" JSONB;
