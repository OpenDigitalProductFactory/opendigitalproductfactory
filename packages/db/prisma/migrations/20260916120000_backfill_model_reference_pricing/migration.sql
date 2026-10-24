-- Backfill per-model list pricing so cost-aware routing has real numbers.
--
-- ModelProfile.inputPricePerMToken / outputPricePerMToken were left NULL by
-- model discovery, which wrote an empty pricing object for every model it
-- found. The router falls back through
--     ModelProfile.pricing -> ModelProfile.<col> -> ModelProvider.<col>
-- so every model under a provider collapsed to that provider's ONE flat rate.
--
-- On this install that made cost ranking not merely imprecise but INVERTED:
--
--   codex flat $1.50/$6.00 per MTok, but
--     gpt-6-astra   really $10/$50   -> output under-priced  8.3x
--     gpt-5.5       really  $5/$30   -> output under-priced  5.0x
--   zai flat $1.40/$4.40 per MTok, but
--     glm-5.3-flash really $0.15/$0.50 -> output OVER-priced 8.8x
--     glm-4.5-air   really $0.20/$1.10 -> output OVER-priced 4.0x
--
-- Frontier models looked cheap and budget models looked expensive, so a
-- cost-weighted route steered AWAY from the frugal option exactly when budget
-- pressure was the reason for asking. Any budget plan built on these numbers
-- was invalid.
--
-- Prices are USD per million tokens, list rates retrieved 2026-09-16 from the
-- providers' own pricing pages (OpenAI, Anthropic, Z.ai). The living source is
-- apps/web/lib/routing/model-pricing-reference.ts, which prices models at
-- discovery from now on; this migration is a one-time snapshot that repairs the
-- rows already written, and was generated from that file.
--
-- A list rate is not the same as cash. Under a subscription or prepaid
-- commitment the tokens are already bought, so the marginal call costs nothing
-- extra; budget-gate.ts consults AiProviderFinanceProfile.valuationMethod
-- before turning any of these rates into AgentBudgetEvent.amountUsd.
--
-- Idempotent and non-destructive: fills only NULL columns, never overwrites a
-- price already recorded, and matches on exact modelId. Models the reference
-- does not cover (e.g. Z.ai publishes no rate for glm-5-turbo, and speaches'
-- local Whisper model has no token price at all) are deliberately left NULL
-- rather than interpolated from a sibling.

WITH reference (model_id, input_per_mtoken, output_per_mtoken) AS (
  VALUES
    ('claude-3-haiku-20240307', 0.25, 1.25),
    ('claude-fable-5', 10, 50),
    ('claude-fable-5-1', 10, 50),
    ('claude-haiku-4-5-20251001', 1, 5),
    ('claude-opus-4-1-20250805', 15, 75),
    ('claude-opus-4-5-20251101', 5, 25),
    ('claude-opus-4-6', 5, 25),
    ('claude-opus-4-7', 5, 25),
    ('claude-opus-4-8', 5, 25),
    ('claude-opus-5', 5, 25),
    ('claude-sonnet-4-5-20250929', 3, 15),
    ('claude-sonnet-4-6', 3, 15),
    ('claude-sonnet-5', 2, 10),
    ('codex-mini-latest', 1.5, 6),
    ('glm-4.5', 0.6, 2.2),
    ('glm-4.5-air', 0.2, 1.1),
    ('glm-4.6', 0.6, 2.2),
    ('glm-4.7', 0.6, 2.2),
    ('glm-4.7-flashx', 0.07, 0.4),
    ('glm-5', 1, 3.2),
    ('glm-5.1', 1.4, 4.4),
    ('glm-5.2', 1.4, 4.4),
    ('glm-5.3', 1.4, 4.4),
    ('glm-5.3-flash', 0.15, 0.5),
    ('gpt-5', 1.25, 10),
    ('gpt-5-mini', 0.25, 2),
    ('gpt-5-nano', 0.05, 0.4),
    ('gpt-5.1', 1.25, 10),
    ('gpt-5.2', 1.75, 14),
    ('gpt-5.3-codex', 1.75, 14),
    ('gpt-5.3-codex-spark', 1.75, 14),
    ('gpt-5.4', 2.5, 15),
    ('gpt-5.4-mini', 0.75, 4.5),
    ('gpt-5.4-nano', 0.2, 1.25),
    ('gpt-5.4-pro', 30, 180),
    ('gpt-5.5', 5, 30),
    ('gpt-5.5-cyber', 12.5, 75),
    ('gpt-5.5-pro', 30, 180),
    ('gpt-5.6-cyber', 12.5, 75),
    ('gpt-5.6-luna', 0.2, 1.2),
    ('gpt-5.6-sol', 4, 20),
    ('gpt-5.6-terra', 2, 12),
    ('gpt-6-astra', 10, 50)
)
UPDATE "ModelProfile" mp
SET
  "inputPricePerMToken"  = COALESCE(mp."inputPricePerMToken",  r.input_per_mtoken),
  "outputPricePerMToken" = COALESCE(mp."outputPricePerMToken", r.output_per_mtoken)
FROM reference r
WHERE
  -- Discovery quarantines a model by prefixing "__dpf_quarantined__<cuid>__";
  -- the trailing segment is still the real model id, so price it too.
  regexp_replace(mp."modelId", '^__dpf_quarantined__[^_]+__', '') = r.model_id
  AND (mp."inputPricePerMToken" IS NULL OR mp."outputPricePerMToken" IS NULL);
