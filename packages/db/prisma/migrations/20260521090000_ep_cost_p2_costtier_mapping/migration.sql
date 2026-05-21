-- EP-COST Phase 2: populate ModelProfile.costTier from capabilityCategory
-- All existing rows have costTier='$' (placeholder from initial discovery).
-- Map to the spec's three-tier vocabulary: critical | standard | routine.

UPDATE "ModelProfile"
SET "costTier" = CASE "capabilityCategory"
  WHEN 'deep-thinker' THEN 'critical'
  WHEN 'strong'       THEN 'standard'
  WHEN 'moderate'     THEN 'routine'
  WHEN 'deprecated'   THEN 'deprecated'
  WHEN 'basic'        THEN 'routine'
  ELSE 'standard'   -- safe fallback for future categories
END
WHERE "costTier" = '$';
