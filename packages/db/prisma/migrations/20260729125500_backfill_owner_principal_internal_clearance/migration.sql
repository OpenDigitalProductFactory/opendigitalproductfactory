-- @migration-safety: data-safe: additive data remediation only; no constraint
-- is tightened and no row or existing clearance value is removed.
--
-- Installation owners must be able to govern internal platform coworkers.
-- PrincipalAlias is the canonical User -> Principal bridge, so resolve the
-- owner through that relationship and append only the missing internal value.
UPDATE "Principal" AS principal
SET "sensitivityClearance" = array_append(
  principal."sensitivityClearance",
  'internal'::"PrincipalSensitivity"
)
FROM "PrincipalAlias" AS alias
JOIN "User" AS app_user
  ON app_user.id = alias."aliasValue"
WHERE alias."principalId" = principal.id
  AND alias."aliasType" = 'user'
  AND alias.issuer = ''
  AND app_user."isSuperuser" = true
  AND NOT (
    'internal'::"PrincipalSensitivity"
    = ANY(principal."sensitivityClearance")
  );
