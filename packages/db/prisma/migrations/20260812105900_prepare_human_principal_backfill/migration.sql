-- @migration-safety: data-safe: additive identity projection only; no source
-- row, existing Principal, alias, or sensitivity value is changed or removed.
--
-- BI-2BD99239. The immutable 20260812110000 backfill originally correlated
-- inserted principals back to source rows through email/displayName. Those are
-- labels, not stable identity: two valid people can share either value, making
-- the join fan out and violate PrincipalAlias's canonical alias key. Prepare
-- every missing alias one source row at a time, keyed by User.id or
-- EmployeeProfile.employeeId, so the original migration becomes an idempotent
-- no-op for these sections when it runs next.

DO $$
DECLARE
  missing_user RECORD;
  created_principal_id TEXT;
  alias_rows INTEGER;
BEGIN
  FOR missing_user IN
    SELECT app_user.id, app_user.email, app_user."isActive"
    FROM "User" app_user
    LEFT JOIN "PrincipalAlias" alias
      ON alias."aliasType" = 'user'
      AND alias."aliasValue" = app_user.id
      AND alias.issuer = ''
    WHERE alias.id IS NULL
    ORDER BY app_user.id
  LOOP
    created_principal_id := gen_random_uuid()::text;

    INSERT INTO "Principal" (
      id, "principalId", kind, status, "displayName", "createdAt", "updatedAt"
    ) VALUES (
      created_principal_id,
      'PRN-' || gen_random_uuid()::text,
      'human',
      CASE WHEN missing_user."isActive" THEN 'active' ELSE 'inactive' END,
      missing_user.email,
      now(),
      now()
    );

    INSERT INTO "PrincipalAlias" (
      id, "principalId", "aliasType", "aliasValue", issuer, "createdAt"
    ) VALUES (
      gen_random_uuid()::text,
      created_principal_id,
      'user',
      missing_user.id,
      '',
      now()
    )
    ON CONFLICT ("aliasType", "aliasValue", issuer) DO NOTHING;

    GET DIAGNOSTICS alias_rows = ROW_COUNT;
    IF alias_rows = 0 THEN
      DELETE FROM "Principal" WHERE id = created_principal_id;
    END IF;
  END LOOP;
END $$;

-- Employee profiles linked to a User inherit that User's Principal. Conflict
-- handling makes a concurrent or already-complete alias harmless.
INSERT INTO "PrincipalAlias" (
  id, "principalId", "aliasType", "aliasValue", issuer, "createdAt"
)
SELECT
  gen_random_uuid()::text,
  user_alias."principalId",
  'employee',
  employee."employeeId",
  '',
  now()
FROM "EmployeeProfile" employee
JOIN "PrincipalAlias" user_alias
  ON user_alias."aliasType" = 'user'
  AND user_alias."aliasValue" = employee."userId"
  AND user_alias.issuer = ''
LEFT JOIN "PrincipalAlias" existing
  ON existing."aliasType" = 'employee'
  AND existing."aliasValue" = employee."employeeId"
  AND existing.issuer = ''
WHERE employee."userId" IS NOT NULL
  AND existing.id IS NULL
ON CONFLICT ("aliasType", "aliasValue", issuer) DO NOTHING;

DO $$
DECLARE
  missing_employee RECORD;
  created_principal_id TEXT;
  alias_rows INTEGER;
BEGIN
  FOR missing_employee IN
    SELECT employee."employeeId", employee."displayName", employee.status
    FROM "EmployeeProfile" employee
    LEFT JOIN "PrincipalAlias" alias
      ON alias."aliasType" = 'employee'
      AND alias."aliasValue" = employee."employeeId"
      AND alias.issuer = ''
    WHERE employee."userId" IS NULL
      AND alias.id IS NULL
    ORDER BY employee.id
  LOOP
    created_principal_id := gen_random_uuid()::text;

    INSERT INTO "Principal" (
      id, "principalId", kind, status, "displayName", "createdAt", "updatedAt"
    ) VALUES (
      created_principal_id,
      'PRN-' || gen_random_uuid()::text,
      'human',
      CASE WHEN missing_employee.status = 'inactive' THEN 'inactive' ELSE 'active' END,
      missing_employee."displayName",
      now(),
      now()
    );

    INSERT INTO "PrincipalAlias" (
      id, "principalId", "aliasType", "aliasValue", issuer, "createdAt"
    ) VALUES (
      gen_random_uuid()::text,
      created_principal_id,
      'employee',
      missing_employee."employeeId",
      '',
      now()
    )
    ON CONFLICT ("aliasType", "aliasValue", issuer) DO NOTHING;

    GET DIAGNOSTICS alias_rows = ROW_COUNT;
    IF alias_rows = 0 THEN
      DELETE FROM "Principal" WHERE id = created_principal_id;
    END IF;
  END LOOP;
END $$;
