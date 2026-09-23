-- Converge every customer credential holder onto the canonical Principal
-- authority root before the application begins enforcing Principal-gated
-- customer and social sessions.
--
-- Forward-only and idempotent: every insert is protected by the canonical
-- PrincipalAlias unique key. Ambiguity is refused before any write instead of
-- selecting whichever alias happened to be read first.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CustomerContact" cc
    JOIN "PrincipalAlias" contact_alias
      ON contact_alias."aliasType" IN ('customer_contact', 'partner_contact')
     AND contact_alias."aliasValue" = cc.id
     AND contact_alias.issuer = ''
    JOIN "PrincipalAlias" email_alias
      ON email_alias."aliasType" = 'email'
     AND email_alias."aliasValue" = lower(cc.email)
     AND email_alias.issuer = ''
    WHERE contact_alias."principalId" <> email_alias."principalId"
  ) OR EXISTS (
    SELECT 1
    FROM "CustomerContact"
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'customer principal alias conflict: contact and email aliases do not identify exactly one Principal';
  END IF;
END $$;

-- Reuse a Principal already identified by either the canonical contact alias
-- or the lower-case email alias.
WITH resolved AS (
  SELECT
    cc.id AS contact_id,
    COALESCE(contact_alias."principalId", email_alias."principalId") AS principal_row_id
  FROM "CustomerContact" cc
  LEFT JOIN "PrincipalAlias" contact_alias
    ON contact_alias."aliasType" = 'customer_contact'
   AND contact_alias."aliasValue" = cc.id
   AND contact_alias.issuer = ''
  LEFT JOIN "PrincipalAlias" email_alias
    ON email_alias."aliasType" = 'email'
   AND email_alias."aliasValue" = lower(cc.email)
   AND email_alias.issuer = ''
  WHERE COALESCE(contact_alias."principalId", email_alias."principalId") IS NOT NULL
)
INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
SELECT gen_random_uuid()::text, resolved.principal_row_id, 'customer_contact', resolved.contact_id, '', now()
FROM resolved
ON CONFLICT ("aliasType", "aliasValue", issuer) DO NOTHING;

-- Only contacts with neither a contact nor an email Principal reach this
-- insertion. CustomerContact.email is unique; the preflight additionally
-- refuses case-folded duplicates.
WITH missing AS (
  SELECT
    cc.id,
    cc.email,
    cc."isActive",
    cc."mergedIntoId",
    ca.status AS account_status,
    ppe.status AS partner_status,
    ppe."endedAt" AS partner_ended_at
  FROM "CustomerContact" cc
  JOIN "CustomerAccount" ca ON ca.id = cc."accountId"
  LEFT JOIN "PartnerProgramEnrollment" ppe ON ppe."accountId" = ca.id
  LEFT JOIN "PrincipalAlias" contact_alias
    ON contact_alias."aliasType" = 'customer_contact'
   AND contact_alias."aliasValue" = cc.id
   AND contact_alias.issuer = ''
  LEFT JOIN "PrincipalAlias" email_alias
    ON email_alias."aliasType" = 'email'
   AND email_alias."aliasValue" = lower(cc.email)
   AND email_alias.issuer = ''
  WHERE contact_alias.id IS NULL AND email_alias.id IS NULL
), inserted AS (
  INSERT INTO "Principal" (
    id, "principalId", kind, status, "displayName", "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid()::text,
    'PRN-' || gen_random_uuid()::text,
    CASE
      WHEN m.partner_status IS NOT NULL
       AND m.partner_status <> 'ended'
       AND m.partner_ended_at IS NULL THEN 'partner'
      ELSE 'customer'
    END,
    CASE
      WHEN m."isActive"
       AND m."mergedIntoId" IS NULL
       AND m.account_status IN ('prospect', 'qualified', 'onboarding', 'active', 'at_risk')
      THEN 'active'
      ELSE 'inactive'
    END,
    m.email,
    now(),
    now()
  FROM missing m
  RETURNING id, "displayName"
)
INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
SELECT gen_random_uuid()::text, inserted.id, 'customer_contact', cc.id, '', now()
FROM inserted
JOIN "CustomerContact" cc ON cc.email = inserted."displayName"
ON CONFLICT ("aliasType", "aliasValue", issuer) DO NOTHING;

-- Every canonical contact Principal also carries the stable lower-case email
-- lookup alias. The preflight proves that an existing email alias cannot point
-- at a different Principal.
INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
SELECT gen_random_uuid()::text, contact_alias."principalId", 'email', lower(cc.email), '', now()
FROM "CustomerContact" cc
JOIN "PrincipalAlias" contact_alias
  ON contact_alias."aliasType" = 'customer_contact'
 AND contact_alias."aliasValue" = cc.id
 AND contact_alias.issuer = ''
ON CONFLICT ("aliasType", "aliasValue", issuer) DO NOTHING;

-- Partner is a live enrollment on the same customer party, not a second
-- identity. Add the partner alias to the same Principal.
INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
SELECT gen_random_uuid()::text, contact_alias."principalId", 'partner_contact', cc.id, '', now()
FROM "CustomerContact" cc
JOIN "CustomerAccount" ca ON ca.id = cc."accountId"
JOIN "PartnerProgramEnrollment" ppe
  ON ppe."accountId" = ca.id
 AND ppe.status <> 'ended'
 AND ppe."endedAt" IS NULL
JOIN "PrincipalAlias" contact_alias
  ON contact_alias."aliasType" = 'customer_contact'
 AND contact_alias."aliasValue" = cc.id
 AND contact_alias.issuer = ''
ON CONFLICT ("aliasType", "aliasValue", issuer) DO NOTHING;

-- A repeatable singleton aggregate for operators and smoke tests. It remains
-- bounded regardless of tenant size while still exposing every invariant class.
CREATE OR REPLACE VIEW "CustomerPrincipalAuthInvariant" AS
WITH contact_state AS (
  SELECT
    cc.id,
    cc.email,
    cc."isActive",
    cc."mergedIntoId",
    ca.status AS account_status,
    contact_alias."principalId" AS contact_principal_id,
    email_alias."principalId" AS email_principal_id,
    p.status AS principal_status
  FROM "CustomerContact" cc
  JOIN "CustomerAccount" ca ON ca.id = cc."accountId"
  LEFT JOIN "PrincipalAlias" contact_alias
    ON contact_alias."aliasType" = 'customer_contact'
   AND contact_alias."aliasValue" = cc.id
   AND contact_alias.issuer = ''
  LEFT JOIN "PrincipalAlias" email_alias
    ON email_alias."aliasType" = 'email'
   AND email_alias."aliasValue" = lower(cc.email)
   AND email_alias.issuer = ''
  LEFT JOIN "Principal" p ON p.id = contact_alias."principalId"
)
SELECT
  count(*) FILTER (
    WHERE "isActive" AND "mergedIntoId" IS NULL
      AND account_status IN ('prospect', 'qualified', 'onboarding', 'active', 'at_risk')
      AND contact_principal_id IS NULL
  )::bigint AS "activeContactsMissingPrincipal",
  count(*) FILTER (
    WHERE contact_principal_id IS NOT NULL
      AND email_principal_id IS NOT NULL
      AND contact_principal_id <> email_principal_id
  )::bigint AS "aliasConflicts",
  count(*) FILTER (
    WHERE "isActive" AND "mergedIntoId" IS NULL
      AND account_status IN ('prospect', 'qualified', 'onboarding', 'active', 'at_risk')
      AND principal_status <> 'active'
  )::bigint AS "activeContactsWithInactivePrincipal",
  count(*) FILTER (
    WHERE (NOT "isActive" OR "mergedIntoId" IS NOT NULL
      OR account_status NOT IN ('prospect', 'qualified', 'onboarding', 'active', 'at_risk'))
      AND principal_status = 'active'
  )::bigint AS "disabledContactsWithActivePrincipal"
FROM contact_state;
