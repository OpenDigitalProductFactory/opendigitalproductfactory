-- Data-only migration: backfill Principal + PrincipalAlias rows for any
-- existing User, EmployeeProfile, Agent, or CustomerContact that does not
-- yet have a matching alias entry.
--
-- Idempotent: re-running this migration on an already-backfilled DB inserts
-- zero rows. Each section uses an "alias not yet present" filter so partial
-- prior runs are safe.
--
-- This implements task 1.3 of the BI-GAID-8D72B4 plan
-- (docs/superpowers/plans/2026-04-26-gaid-private-aidoc-projection.md).
--
-- The runtime helpers (apps/web/lib/identity/principal-linking.ts) handle
-- the same shape going forward — this migration covers historical rows.

-- ============================================================
-- Section 1: Users without a 'user' alias
-- ============================================================
-- Each missing User gets a fresh kind="human" Principal plus a 'user'
-- alias. EmployeeProfile attachment is handled in Section 2 because the
-- two-pass approach lets us reuse a User-anchored Principal for the
-- matching employee row.

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
-- Section 2: EmployeeProfiles without an 'employee' alias
-- ============================================================
-- If the employee already links to a User and that User has a Principal,
-- attach the 'employee' alias to that same Principal (matches what
-- syncEmployeePrincipal does at runtime). If no link exists, fall back
-- to creating a new kind="human" Principal anchored on displayName.

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

-- For employees with no userId link, create a new principal.
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
-- Section 3: Agents without an 'agent' alias
-- ============================================================
-- Agents need both an 'agent' alias and the canonical
-- 'gaid:priv:dpf.internal:<normalized>' alias. The normalization rule
-- mirrors buildPrivateAgentGaid() in
-- apps/web/lib/identity/principal-linking.ts: lowercase, replace
-- non-[a-z0-9._-] runs with '-', strip leading/trailing dashes.

WITH missing_agent AS (
  SELECT a.id AS db_id, a."agentId", a.name, a.status
  FROM "Agent" a
  LEFT JOIN "PrincipalAlias" pa
    ON pa."aliasType" = 'agent' AND pa."aliasValue" = a."agentId" AND pa.issuer = ''
  WHERE pa.id IS NULL
),
new_agent_principal AS (
  INSERT INTO "Principal" (id, "principalId", kind, status, "displayName", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    'PRN-' || gen_random_uuid()::text,
    'agent',
    COALESCE(NULLIF(ma.status, ''), 'active'),
    ma.name,
    now(),
    now()
  FROM missing_agent ma
  RETURNING id, "displayName"
),
agent_alias_inserted AS (
  INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
  SELECT gen_random_uuid()::text, p.id, 'agent', ma."agentId", '', now()
  FROM new_agent_principal p
  JOIN "Agent" ma ON ma.name = p."displayName"
  LEFT JOIN "PrincipalAlias" existing
    ON existing."aliasType" = 'agent' AND existing."aliasValue" = ma."agentId" AND existing.issuer = ''
  WHERE existing.id IS NULL
  RETURNING "principalId", "aliasValue"
)
INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
SELECT
  gen_random_uuid()::text,
  aa."principalId",
  'gaid',
  'gaid:priv:dpf.internal:' ||
    COALESCE(
      NULLIF(
        regexp_replace(
          regexp_replace(lower(aa."aliasValue"), '[^a-z0-9._-]+', '-', 'g'),
          '(^-+|-+$)', '', 'g'
        ),
        ''
      ),
      'agent'
    ),
  '',
  now()
FROM agent_alias_inserted aa
LEFT JOIN "PrincipalAlias" existing
  ON existing."aliasType" = 'gaid' AND existing."principalId" = aa."principalId" AND existing.issuer = ''
WHERE existing.id IS NULL;

-- ============================================================
-- Section 4: CustomerContacts without a 'customer_contact' alias
-- ============================================================
-- Each missing contact gets a kind="customer" Principal with a
-- 'customer_contact' alias on the contact id and an 'email' alias on
-- the lowercased email (matches syncCustomerPrincipal at runtime).

WITH missing_contact AS (
  SELECT cc.id, cc.email, cc."isActive"
  FROM "CustomerContact" cc
  LEFT JOIN "PrincipalAlias" pa
    ON pa."aliasType" = 'customer_contact' AND pa."aliasValue" = cc.id AND pa.issuer = ''
  WHERE pa.id IS NULL
),
new_contact_principal AS (
  INSERT INTO "Principal" (id, "principalId", kind, status, "displayName", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    'PRN-' || gen_random_uuid()::text,
    'customer',
    CASE WHEN mc."isActive" THEN 'active' ELSE 'inactive' END,
    mc.email,
    now(),
    now()
  FROM missing_contact mc
  RETURNING id, "displayName"
),
contact_alias_inserted AS (
  INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
  SELECT gen_random_uuid()::text, p.id, 'customer_contact', mc.id, '', now()
  FROM new_contact_principal p
  JOIN "CustomerContact" mc ON mc.email = p."displayName"
  LEFT JOIN "PrincipalAlias" existing
    ON existing."aliasType" = 'customer_contact' AND existing."aliasValue" = mc.id AND existing.issuer = ''
  WHERE existing.id IS NULL
  RETURNING "principalId", "aliasValue"
)
INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
SELECT
  gen_random_uuid()::text,
  ca."principalId",
  'email',
  lower(cc.email),
  '',
  now()
FROM contact_alias_inserted ca
JOIN "CustomerContact" cc ON cc.id = ca."aliasValue"
LEFT JOIN "PrincipalAlias" existing
  ON existing."aliasType" = 'email'
   AND existing."aliasValue" = lower(cc.email)
   AND existing."principalId" = ca."principalId"
   AND existing.issuer = ''
WHERE existing.id IS NULL;
