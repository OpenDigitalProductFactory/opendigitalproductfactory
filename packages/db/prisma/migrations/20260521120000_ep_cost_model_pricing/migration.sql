-- EP-COST-001: Accurate per-model pricing backfill
-- Source: Anthropic, Google, OpenAI published pricing as of 2026-05-21
--
-- These prices are used by computeTokenCost() in ai-inference.ts to populate
-- AdapterRunTelemetry.estimatedCostUsd and drive the Finance AP spend pipeline.
--
-- anthropic-sub models: per-call price is $0 (flat Max/Pro subscription).
--   Actual subscription cost is tracked separately in AiProviderFinanceProfile.
--   Setting $0/$0 here is CORRECT — it prevents double-counting.
--
-- Gemma / local models: $0/$0 (compute cost tracked separately via electricityRateKwh).
--
-- Gemini 3.x, nano-banana, robotics, veo, lyria: Google has not published stable
--   per-model pricing for these preview/specialised models. We assign them to the
--   nearest published tier as a conservative estimate until Google publishes rates.
--   All estimates are tagged so they can be updated when official rates land.

-- ── Anthropic (API key — anthropic provider) ─────────────────────────────────
-- Source: https://www.anthropic.com/pricing

-- Claude 3 Haiku (retired but may still route)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 0.25,  "outputPricePerMToken" = 1.25,  "costTier" = 'routine'
  WHERE "providerId" = 'anthropic' AND "modelId" LIKE 'claude-3-haiku%';

-- Claude 4 Haiku family ($0.80 input / $4.00 output)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 0.80,  "outputPricePerMToken" = 4.00,  "costTier" = 'routine'
  WHERE "providerId" IN ('anthropic', 'anthropic-sub') AND (
    "modelId" LIKE 'claude-haiku-4%' OR "modelId" LIKE 'claude-3-5-haiku%'
  );

-- Claude Sonnet 4.x ($3 input / $15 output)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 3.00,  "outputPricePerMToken" = 15.00, "costTier" = 'standard'
  WHERE "providerId" IN ('anthropic', 'anthropic-sub') AND "modelId" LIKE 'claude-sonnet-4%';

-- Claude Sonnet 3.x legacy
UPDATE "ModelProfile" SET "inputPricePerMToken" = 3.00,  "outputPricePerMToken" = 15.00, "costTier" = 'standard'
  WHERE "providerId" IN ('anthropic', 'anthropic-sub') AND "modelId" LIKE 'claude-3-%sonnet%';

-- Claude Opus 4.x ($15 input / $75 output)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 15.00, "outputPricePerMToken" = 75.00, "costTier" = 'critical'
  WHERE "providerId" IN ('anthropic', 'anthropic-sub') AND "modelId" LIKE 'claude-opus-4%';

-- anthropic-sub subscription models: $0 per-call (flat subscription billing)
-- These are already correct if set to 0/0; this UPDATE is a no-op guard.
UPDATE "ModelProfile" SET "inputPricePerMToken" = 0.00,  "outputPricePerMToken" = 0.00
  WHERE "providerId" = 'anthropic-sub'
    AND ("inputPricePerMToken" IS NULL OR "inputPricePerMToken" != 0);

-- ── Gemini (Google AI Studio / Cloud — gemini provider) ───────────────────────
-- Source: https://ai.google.dev/pricing (prices per million tokens)

-- Gemini 2.0 Flash family ($0.075 / $0.30)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 0.075, "outputPricePerMToken" = 0.30,  "costTier" = 'routine'
  WHERE "providerId" = 'gemini' AND (
    "modelId" LIKE 'gemini-2.0-flash%'
  );

-- Gemini 2.5 Flash family ($0.075 / $0.30)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 0.075, "outputPricePerMToken" = 0.30,  "costTier" = 'routine'
  WHERE "providerId" = 'gemini' AND "modelId" LIKE 'gemini-2.5-flash%';

-- Gemini 2.5 Flash Lite (~50% cheaper; estimate pending Google publish)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 0.04,  "outputPricePerMToken" = 0.15,  "costTier" = 'routine'
  WHERE "providerId" = 'gemini' AND "modelId" IN (
    'gemini-2.5-flash-lite', 'gemini-2.5-flash-lite-preview-09-2025', 'gemini-flash-lite-latest'
  );

-- Gemini 2.5 Pro ($1.25 / $5.00)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 1.25,  "outputPricePerMToken" = 5.00,  "costTier" = 'standard'
  WHERE "providerId" = 'gemini' AND "modelId" LIKE 'gemini-2.5-pro%';

-- Gemini 3.x Flash family (estimate: similar to 2.5 Flash until Google publishes)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 0.10,  "outputPricePerMToken" = 0.40,  "costTier" = 'routine'
  WHERE "providerId" = 'gemini' AND (
    "modelId" LIKE 'gemini-3-%flash%'
    OR "modelId" = 'gemini-flash-latest'
    OR "modelId" LIKE 'gemini-3.1-flash%'
    OR "modelId" LIKE 'gemini-3.5-flash%'
  );

-- Gemini 3.x Pro family (estimate: similar to 2.5 Pro)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 1.50,  "outputPricePerMToken" = 6.00,  "costTier" = 'standard'
  WHERE "providerId" = 'gemini' AND (
    "modelId" LIKE 'gemini-3-%pro%'
    OR "modelId" = 'gemini-pro-latest'
    OR "modelId" LIKE 'gemini-3.1-pro%'
  );

-- Gemini Deep Research (estimate: Pro pricing)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 1.25,  "outputPricePerMToken" = 5.00,  "costTier" = 'standard'
  WHERE "providerId" = 'gemini' AND "modelId" LIKE 'deep-research%';

-- Specialised Gemini preview models (robotics, veo, lyria, imagen, nano-banana):
-- No published per-token rate. Assign Pro-tier pricing as conservative estimate.
-- Tag with costTier=standard pending official rates.
UPDATE "ModelProfile" SET "inputPricePerMToken" = 1.25,  "outputPricePerMToken" = 5.00,  "costTier" = 'standard'
  WHERE "providerId" = 'gemini'
    AND "inputPricePerMToken" IS NULL
    AND "modelId" NOT LIKE 'gemma%';

-- Gemma (open-source): $0 per token — compute cost only
UPDATE "ModelProfile" SET "inputPricePerMToken" = 0.00,  "outputPricePerMToken" = 0.00,  "costTier" = 'routine'
  WHERE "providerId" = 'gemini' AND "modelId" LIKE 'gemma%';

-- ── OpenAI / Codex ────────────────────────────────────────────────────────────
-- Source: https://openai.com/api/pricing

-- GPT-5.3 Codex (Responses API) — $5 input / $20 output
UPDATE "ModelProfile" SET "inputPricePerMToken" = 5.00,  "outputPricePerMToken" = 20.00, "costTier" = 'critical'
  WHERE "providerId" IN ('codex', 'openai') AND "modelId" LIKE 'gpt-5.3-codex%';

-- Codex mini — $1.50 / $6.00
UPDATE "ModelProfile" SET "inputPricePerMToken" = 1.50,  "outputPricePerMToken" = 6.00,  "costTier" = 'standard'
  WHERE "modelId" LIKE 'codex-mini%';

-- GPT-5.4 — $10 input / $40 output (ChatGPT subscription: $0 per-call)
UPDATE "ModelProfile" SET "inputPricePerMToken" = 10.00, "outputPricePerMToken" = 40.00, "costTier" = 'critical'
  WHERE "providerId" = 'openai' AND "modelId" LIKE 'gpt-5.4%';

UPDATE "ModelProfile" SET "inputPricePerMToken" = 0.00,  "outputPricePerMToken" = 0.00,  "costTier" = 'critical'
  WHERE "providerId" = 'chatgpt' AND "modelId" LIKE 'gpt-5.4%';

-- ── Fix stale '$' costTier placeholder left from earlier migrations ────────────
-- The migration 20260521090000 only fixed rows WHERE costTier = '' (empty string).
-- Some rows may still have '$' / '$$' / '$$$' from the JSON seed.
UPDATE "ModelProfile" SET "costTier" = 'routine'  WHERE "costTier" = '$';
UPDATE "ModelProfile" SET "costTier" = 'standard' WHERE "costTier" = '$$';
UPDATE "ModelProfile" SET "costTier" = 'critical'  WHERE "costTier" = '$$$';
