-- BI-84792669 — re-triage ModelProfile rows quarantined by the collation-drift
-- dedupe (20260720193000) using explicit profileSource-aware precedence.
--
-- 20260720193000's generic dedupe ranked ModelProfile duplicates purely on
-- `"lastEvalAt" DESC NULLS LAST, "evalCount" DESC, "generatedAt" DESC, id DESC`
-- — no awareness of `profileSource`. For local/docker.io/ai/qwen3-coder:latest
-- that kept a `seed` row (toolFidelity 40, capabilityOverrides null) at the
-- live key while quarantining the `evaluated` row (toolFidelity 100,
-- capabilityOverrides {"toolUse":true}), silently discarding a real eval
-- result and an operator's manual capability pin. `resolveSyncedToolUse`
-- (apps/web/lib/inference/ai-provider-internals.ts) and `resolveToolUse`
-- (apps/web/lib/routing/loader.ts) both treat `evaluated`/`admin` as
-- authoritative over `seed`/`catalog` — this dedupe inverted that precedence.
--
-- Precedence (BI-84792669, mirrors packages/db/src/model-profile-precedence.ts
-- — keep the two in lockstep, SQL can't import the TS module):
--   profileSource: evaluated(4) > admin(3) > catalog(2) > seed(1)
--   (unrecognised profileSource ranks alongside catalog=2)
--   tie-break: evalCount, then toolFidelity, then lastEvalAt, then generatedAt.
--
-- For every (providerId, natural modelId) group where a currently-quarantined
-- row (`__dpf_quarantined__<id>__<natural modelId>`) outranks the row
-- currently holding the natural key, this migration swaps them: the
-- higher-precedence row reclaims the natural key, the demoted row takes a
-- quarantined key and is retired using the tombstone convention established
-- by 20260721190000_retire_quarantined_duplicate_rows (so it does not
-- reappear as a live phantom under its old key — the exact bug that
-- migration fixed for the *original* dedupe losers). Deliberately does NOT
-- touch the promoted row's modelStatus/retiredAt/retiredReason: whether a
-- restored profile should also be reactivated is an operational decision
-- outside this repair's scope (see BI-84792669 resolution notes) — this
-- migration only fixes *which row is the highest-precedence duplicate* and
-- *that its capabilityOverrides pin is never dropped*.
--
-- Independently of any swap, a capabilityOverrides pin present on ANY
-- duplicate in a group (survivor or not) is copied onto the eventual
-- survivor when the survivor itself has none — requirement #2 of
-- BI-84792669, "never let a repair drop a manual pin".
--
-- Quarantine-key matching uses a plain equality check
-- (`modelId = '__dpf_quarantined__' || id || '__' || naturalModelId`), the
-- exact format the quarantine helper in 20260720193000 produces before any
-- collision-suffix loop runs. A collision-suffixed key (requires two prior
-- quarantine attempts landing on the identical computed key) is out of scope
-- — none exist in the live data behind this repair.
--
-- Idempotent: a second run finds zero groups where a quarantined row
-- outranks the current survivor (the swap already happened) and zero groups
-- with a still-unmerged capabilityOverrides pin, so it changes nothing.
-- @migration-safety: data-safe: no schema change; only ModelProfile.modelId (identity swap between two already-existing rows), .capabilityOverrides (only ever set from null to a duplicate's existing non-null value, never overwritten), and — for the demoted row only — .modelStatus/.retiredAt/.retiredReason (only set when not already retired, via COALESCE, so an existing reason is preserved) are touched; no row is created or deleted.

BEGIN;

CREATE TEMP TABLE "_bi84792669_groups" AS
WITH profile_rows AS (
  SELECT
    id,
    "providerId",
    "modelId",
    "profileSource",
    "evalCount",
    "toolFidelity",
    "lastEvalAt",
    "generatedAt",
    "capabilityOverrides",
    ("modelId" LIKE '__dpf_quarantined__%') AS "isQuarantined"
  FROM "ModelProfile"
),
live_rows AS (
  SELECT id AS live_id, "providerId", "modelId" AS natural_model_id
  FROM profile_rows
  WHERE NOT "isQuarantined"
),
group_members AS (
  -- the current live-key holder
  SELECT
    lr.live_id, lr."providerId", lr.natural_model_id,
    n.id AS member_id, n."profileSource", n."evalCount", n."toolFidelity",
    n."lastEvalAt", n."generatedAt", n."capabilityOverrides",
    false AS member_is_quarantined
  FROM live_rows lr
  JOIN profile_rows n ON n.id = lr.live_id
  UNION ALL
  -- its quarantined siblings (exact-format match against the known natural key)
  SELECT
    lr.live_id, lr."providerId", lr.natural_model_id,
    q.id, q."profileSource", q."evalCount", q."toolFidelity",
    q."lastEvalAt", q."generatedAt", q."capabilityOverrides",
    true
  FROM live_rows lr
  JOIN profile_rows q
    ON q."isQuarantined"
   AND q."providerId" = lr."providerId"
   AND q."modelId" = ('__dpf_quarantined__' || q.id || '__' || lr.natural_model_id)
),
ranked AS (
  SELECT
    gm.*,
    row_number() OVER (
      PARTITION BY live_id
      ORDER BY
        CASE "profileSource"
          WHEN 'evaluated' THEN 4
          WHEN 'admin'     THEN 3
          WHEN 'catalog'   THEN 2
          WHEN 'seed'      THEN 1
          ELSE 2
        END DESC,
        "evalCount" DESC,
        "toolFidelity" DESC,
        COALESCE("lastEvalAt", '-infinity'::timestamp) DESC,
        COALESCE("generatedAt", '-infinity'::timestamp) DESC,
        member_id ASC
    ) AS precedence_rn,
    row_number() OVER (
      PARTITION BY live_id, ("capabilityOverrides" IS NOT NULL)
      ORDER BY
        CASE "profileSource"
          WHEN 'evaluated' THEN 4
          WHEN 'admin'     THEN 3
          WHEN 'catalog'   THEN 2
          WHEN 'seed'      THEN 1
          ELSE 2
        END DESC,
        "evalCount" DESC,
        "toolFidelity" DESC,
        COALESCE("lastEvalAt", '-infinity'::timestamp) DESC,
        COALESCE("generatedAt", '-infinity'::timestamp) DESC,
        member_id ASC
    ) AS overrides_rn
  FROM group_members gm
),
groups_with_quarantined_sibling AS (
  SELECT DISTINCT live_id FROM ranked WHERE member_is_quarantined
),
best AS (
  SELECT
    r.live_id, r."providerId", r.natural_model_id,
    r.member_id AS best_id, r.member_is_quarantined AS best_is_quarantined
  FROM ranked r
  JOIN groups_with_quarantined_sibling g USING (live_id)
  WHERE r.precedence_rn = 1
),
best_overrides AS (
  SELECT r.live_id, r."capabilityOverrides" AS chosen_overrides
  FROM ranked r
  JOIN groups_with_quarantined_sibling g USING (live_id)
  WHERE r.overrides_rn = 1 AND r."capabilityOverrides" IS NOT NULL
)
SELECT b.live_id, b."providerId", b.natural_model_id, b.best_id, b.best_is_quarantined, bo.chosen_overrides
FROM best b
LEFT JOIN best_overrides bo USING (live_id);

-- Case A (precedence swap): demote the current live-key holder first, to free
-- the natural key before the promoted row claims it (the unique index on
-- (providerId, modelId) is not deferrable).
UPDATE "ModelProfile" mp
SET "modelId" = '__dpf_quarantined__' || mp.id || '__' || g.natural_model_id,
    "modelStatus" = 'retired',
    "retiredAt" = COALESCE(mp."retiredAt", now()),
    "retiredReason" = COALESCE(
      mp."retiredReason",
      'Superseded by higher-precedence duplicate during BI-84792669 quarantine re-triage'
    )
FROM "_bi84792669_groups" g
WHERE g.best_is_quarantined
  AND mp.id = g.live_id;

-- Case A (continued): promote the higher-precedence quarantined row onto the
-- now-free natural key, and give it the group's best available
-- capabilityOverrides pin (its own if it already had one).
UPDATE "ModelProfile" mp
SET "modelId" = g.natural_model_id,
    "capabilityOverrides" = g.chosen_overrides
FROM "_bi84792669_groups" g
WHERE g.best_is_quarantined
  AND mp.id = g.best_id;

-- Case B (pin-only merge): the current live-key holder is already the
-- correct survivor, but a quarantined sibling carries a capabilityOverrides
-- pin the survivor lacks — copy it forward without touching modelId/status.
UPDATE "ModelProfile" mp
SET "capabilityOverrides" = g.chosen_overrides
FROM "_bi84792669_groups" g
WHERE NOT g.best_is_quarantined
  AND mp.id = g.live_id
  AND mp."capabilityOverrides" IS NULL
  AND g.chosen_overrides IS NOT NULL;

DROP TABLE "_bi84792669_groups";

-- Fail closed: the repair must never leave a duplicate (providerId, modelId)
-- key behind (that would violate ModelProfile_providerId_modelId_key).
DO $$
DECLARE
  dupes int;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT 1 FROM "ModelProfile" GROUP BY "providerId", "modelId" HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'BI-84792669 re-triage left % duplicate (providerId, modelId) key(s)', dupes;
  END IF;
END $$;

COMMIT;
