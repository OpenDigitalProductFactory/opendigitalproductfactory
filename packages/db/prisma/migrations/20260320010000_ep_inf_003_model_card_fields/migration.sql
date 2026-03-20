-- EP-INF-003: Add ModelCard fields to ModelProfile
-- These columns support structured model metadata surfaced in the ModelCard UI component.

ALTER TABLE "ModelProfile"
  ADD COLUMN IF NOT EXISTS "modelFamily"             TEXT,
  ADD COLUMN IF NOT EXISTS "modelClass"              TEXT NOT NULL DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS "maxInputTokens"          INTEGER,
  ADD COLUMN IF NOT EXISTS "inputModalities"         JSONB NOT NULL DEFAULT '["text"]',
  ADD COLUMN IF NOT EXISTS "outputModalities"        JSONB NOT NULL DEFAULT '["text"]',
  ADD COLUMN IF NOT EXISTS "capabilities"            JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "pricing"                 JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "supportedParameters"     JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "defaultParameters"       JSONB,
  ADD COLUMN IF NOT EXISTS "instructType"            TEXT,
  ADD COLUMN IF NOT EXISTS "trainingDataCutoff"      TEXT,
  ADD COLUMN IF NOT EXISTS "reliableKnowledgeCutoff" TEXT,
  ADD COLUMN IF NOT EXISTS "deprecationDate"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "perRequestLimits"        JSONB,
  ADD COLUMN IF NOT EXISTS "metadataSource"          TEXT NOT NULL DEFAULT 'inferred',
  ADD COLUMN IF NOT EXISTS "metadataConfidence"      TEXT NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS "lastMetadataRefresh"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rawMetadataHash"         TEXT;
