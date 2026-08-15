-- @migration-safety: data-safe: additive data remediation only; no constraint
-- is tightened and no row or existing clearance value is removed.
--
-- Backfill Principal + PrincipalAlias rows for humans (User / EmployeeProfile)
-- that were created AFTER the one-time 20260426150500_backfill_missing_principals
-- migration by an identity-creation path that omitted principal sync
-- (BI-4150F4D6): the Admin createUserAccount path, the first-login
-- EmployeeProfile auto-provisioner, and the MCP create_employee tool. Those code
-- paths are fixed in the same change; this migration repairs already-stranded
-- rows on every install (e.g. the owner + admins onboarded through Admin).
--
-- Idempotent: every section filters on "alias not yet present", so re-running on
-- an already-complete DB inserts zero rows. The clearance step appends only
-- missing values. Mirrors the runtime helpers in
-- apps/web/lib/identity/principal-linking.ts (syncUserPrincipal /
-- syncEmployeePrincipal) and the resolvePrincipalSensitivityClearance floor in
-- packages/db/src/principal-sensitivity.ts.

-- ============================================================
-- Section 1: Users without a 'user' alias -> new human Principal + 'user' alias
-- ============================================================
WITH missing_user AS (
  SELECT u.id, u.email, u."isActive"
  FROM "User" u
  LEFT JOIN "PrincipalAlias" pa
    ON pa."aliasType" = 'user' AND pa."aliasValue" = u.id AND pa.issuer = ''
  WHERE pa.id IS NULL
),
new_user_principal AS (
  INSERT INTO "Principal" (id, "principalId", kind, status, "displayName", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    'PRN-' || gen_random_uuid()::text,
    'human',
    CASE WHEN mu."isActive" THEN 'active' ELSE 'inactive' END,
    mu.email,
    now(),
    now()
  FROM missing_user mu
  RETURNING id, "displayName"
)
INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
SELECT gen_random_uuid()::text, p.id, 'user', mu.id, '', now()
FROM new_user_principal p
JOIN "User" mu ON mu.email = p."displayName"
LEFT JOIN "PrincipalAlias" existing
  ON existing."aliasType" = 'user' AND existing."aliasValue" = mu.id AND existing.issuer = ''
WHERE existing.id IS NULL;

-- ============================================================
-- Section 2a: EmployeeProfiles linked to a User with a Principal -> attach
-- 'employee' alias to that same Principal (converges, matches
-- syncEmployeePrincipal). Section 1 above guarantees the User principal exists.
-- ============================================================
INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
SELECT
  gen_random_uuid()::text,
  pa_user."principalId",
  'employee',
  ep."employeeId",
  '',
  now()
FROM "EmployeeProfile" ep
JOIN "PrincipalAlias" pa_user
  ON pa_user."aliasType" = 'user' AND pa_user."aliasValue" = ep."userId" AND pa_user.issuer = ''
LEFT JOIN "PrincipalAlias" existing
  ON existing."aliasType" = 'employee' AND existing."aliasValue" = ep."employeeId" AND existing.issuer = ''
WHERE ep."userId" IS NOT NULL
  AND existing.id IS NULL;

-- ============================================================
-- Section 2b: EmployeeProfiles with no User link and no 'employee' alias ->
-- new human Principal anchored on displayName + 'employee' alias.
-- ============================================================
WITH unlinked_employee AS (
  SELECT ep.id, ep."employeeId", ep."displayName", ep.status
  FROM "EmployeeProfile" ep
  LEFT JOIN "PrincipalAlias" pa
    ON pa."aliasType" = 'employee' AND pa."aliasValue" = ep."employeeId" AND pa.issuer = ''
  WHERE ep."userId" IS NULL
    AND pa.id IS NULL
),
new_employee_principal AS (
  INSERT INTO "Principal" (id, "principalId", kind, status, "displayName", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    'PRN-' || gen_random_uuid()::text,
    'human',
    CASE WHEN ue.status = 'inactive' THEN 'inactive' ELSE 'active' END,
    ue."displayName",
    now(),
    now()
  FROM unlinked_employee ue
  RETURNING id, "displayName"
)
INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
SELECT gen_random_uuid()::text, p.id, 'employee', ue."employeeId", '', now()
FROM new_employee_principal p
JOIN "EmployeeProfile" ue ON ue."displayName" = p."displayName" AND ue."userId" IS NULL
LEFT JOIN "PrincipalAlias" existing
  ON existing."aliasType" = 'employee' AND existing."aliasValue" = ue."employeeId" AND existing.issuer = ''
WHERE existing.id IS NULL;

-- ============================================================
-- Section 3: Superuser clearance floor. A human Principal linked to a superuser
-- User must carry the installation-owner sensitivity floor
-- (public + internal + confidential), so the coworker-authority gate can
-- authorize tier-2 'confidential' coworkers. Append only the missing values, in
-- canonical order (public is the schema default), so a later runtime
-- syncEmployeePrincipal sees no drift. Matches
-- INSTALLATION_OWNER_SENSITIVITY_FLOOR.
-- ============================================================
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
  AND NOT ('internal'::"PrincipalSensitivity" = ANY(principal."sensitivityClearance"));

UPDATE "Principal" AS principal
SET "sensitivityClearance" = array_append(
  principal."sensitivityClearance",
  'confidential'::"PrincipalSensitivity"
)
FROM "PrincipalAlias" AS alias
JOIN "User" AS app_user
  ON app_user.id = alias."aliasValue"
WHERE alias."principalId" = principal.id
  AND alias."aliasType" = 'user'
  AND alias.issuer = ''
  AND app_user."isSuperuser" = true
  AND NOT ('confidential'::"PrincipalSensitivity" = ANY(principal."sensitivityClearance"));
