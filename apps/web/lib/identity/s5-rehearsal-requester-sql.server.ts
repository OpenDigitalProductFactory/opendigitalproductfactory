import "server-only";

import type { Prisma } from "@dpf/db";

import type { RequesterSql } from "./s5-rehearsal-enrollment.server";

/**
 * BI-9F7192F9: every SQL statement the S5 rehearsal requester code runs, as
 * named constants, and the one served Prisma adapter. The adapter dispatches
 * each registered statement to a static `$queryRawUnsafe(CONSTANT, ...)` call,
 * so every raw statement is statically auditable. An unregistered statement is
 * refused, never passed through.
 */

/**
 * Every owner fact in one statement, so one snapshot decides. $1 is the acting
 * User id; $2 is the text[] of role keys that grant manage_platform. Role keys
 * come only from UserGroup → PlatformRole: isSuperuser grants nothing here.
 */
export const OWNER_SNAPSHOT_SQL = `
WITH orgs AS (
  SELECT "topAccountablePrincipalId" AS top_id FROM "Organization" ORDER BY "createdAt" ASC, id ASC LIMIT 2
), org AS (
  SELECT count(*)::int AS n, (array_agg(top_id))[1] AS top_id FROM orgs
), top_user AS (
  SELECT count(a.*)::int AS alias_count, bool_and(u."isActive") AS local_active
  FROM org JOIN "PrincipalAlias" a ON a."principalId" = org.top_id AND a."aliasType" = 'user' AND a.issuer = ''
  LEFT JOIN "User" u ON u.id = a."aliasValue"
), fallback AS (
  SELECT coalesce(array_agg(DISTINCT p.id ORDER BY p.id), ARRAY[]::text[]) AS ids
  FROM "Principal" p
  JOIN "PrincipalAlias" a ON a."principalId" = p.id AND a."aliasType" = 'user' AND a.issuer = ''
  JOIN "User" u ON u.id = a."aliasValue" AND u."isActive"
  JOIN "UserGroup" g ON g."userId" = u.id
  JOIN "PlatformRole" r ON r.id = g."platformRoleId" AND r."roleId" = ANY($2::text[])
  WHERE p.kind = 'human' AND p.status = 'active'
), actor AS (
  SELECT u.*,
    (SELECT coalesce(array_agg(DISTINCT r."roleId" ORDER BY r."roleId"), ARRAY[]::text[])
       FROM "UserGroup" g JOIN "PlatformRole" r ON r.id = g."platformRoleId" WHERE g."userId" = u.id) AS role_keys,
    (SELECT a."principalId" FROM "PrincipalAlias" a
       WHERE a."aliasType" = 'user' AND a."aliasValue" = u.id AND a.issuer = '') AS principal_id,
    EXISTS (SELECT 1 FROM "S5RehearsalRequesterEnrollment" e WHERE e."userId" = u.id) AS governed
  FROM "User" u WHERE u.id = $1
)
SELECT json_build_object(
  'orgCount', org.n,
  'topPrincipalId', org.top_id,
  'top', (SELECT CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
            'kind', p.kind, 'status', p.status,
            'userAliasCount', top_user.alias_count, 'localUserActive', top_user.local_active) END
          FROM top_user LEFT JOIN "Principal" p ON p.id = org.top_id),
  'fallback', (SELECT to_json(ids) FROM fallback),
  'actor', json_build_object(
    'userExists', actor.id IS NOT NULL,
    'isActive', coalesce(actor."isActive", false),
    'isSuperuser', coalesce(actor."isSuperuser", false),
    'automation', actor."automationVerificationId" IS NOT NULL OR actor."automationProfile" IS NOT NULL
                  OR actor."automationSlot" IS NOT NULL OR actor."automationExpiresAt" IS NOT NULL,
    'handedOver', actor."workHandedOverAt" IS NOT NULL,
    'roleKeys', coalesce(to_json(actor.role_keys), '[]'::json),
    'principalId', actor.principal_id,
    'governedRequester', coalesce(actor.governed, false))
) AS snapshot
FROM org LEFT JOIN actor ON true`;

/** Every requester fact the shared verification needs, in one statement (one snapshot). $1 is the setup digest. */
export const REQUESTER_STATE_SQL = `
SELECT r."setupDigest" AS "setupDigest", r."userId" AS "userId", r."principalId" AS "principalId",
  r."rulingRef" AS "rulingRef", r."reservationRef" AS "reservationRef", r."attemptRef" AS "attemptRef", r."fixtureRef" AS "fixtureRef",
  r.lifecycle::text AS lifecycle,
  (r."lifecycleAt" IS NOT NULL AND r."retirementReason" IS NOT NULL AND r."retiredByPrincipalId" IS NOT NULL) AS terminal,
  u."isActive" AS "userActive", p.status AS "principalStatus",
  (SELECT count(*) FROM "PrincipalAlias" a WHERE a."principalId" = r."principalId")::int AS "aliasCount",
  EXISTS (SELECT 1 FROM "PrincipalAlias" a WHERE a."principalId" = r."principalId"
          AND a."aliasType" = 'user' AND a."aliasValue" = r."userId" AND a.issuer = '') AS "exactAlias",
  (SELECT count(*) FROM "AuthorityBinding" b WHERE b."oauthUserId" = r."userId" AND b.status <> 'revoked')::int AS "liveBindings",
  ((SELECT count(*) FROM "McpApiToken" t WHERE t."userId" = r."userId" AND t."revokedAt" IS NULL)
   + (SELECT count(*) FROM "OAuthRefreshToken" t WHERE t."userId" = r."userId" AND t."revokedAt" IS NULL))::int AS "liveTokens",
  (SELECT count(*) FROM "OAuthClient" c WHERE c."ownerUserId" = r."userId"
          AND c."registrationKind"::text = 'credentials' AND c."revokedAt" IS NULL)::int AS "liveClients"
FROM "S5RehearsalRequesterEnrollment" r
JOIN "User" u ON u.id = r."userId"
JOIN "Principal" p ON p.id = r."principalId"
WHERE r."setupDigest" = $1`;

/** Shared try-lock on the clone destination fence; the first statement of every request transaction. */
export const FENCE_TRY_SHARED_SQL = `SELECT pg_try_advisory_xact_lock_shared(hashtextextended($1, 0)) AS entered`;
export const SET_LOCK_TIMEOUT_SQL = `SELECT set_config('lock_timeout', $1, true) AS applied`;
export const SETUP_XACT_LOCK_SQL = `SELECT true AS locked FROM pg_advisory_xact_lock(hashtextextended($1, 0))`;
export const RECORD_PRESENT_SQL = `SELECT 1 AS present FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1`;
export const EMAIL_PRESENT_SQL = `SELECT 1 AS present FROM "User" WHERE email = $1`;
export const RETIRE_LOCK_RECORD_SQL = `
SELECT "userId", "principalId", lifecycle::text AS lifecycle, "rulingRef", "reservationRef", "attemptRef", "fixtureRef",
  "installationRef", "leaseRef", "dbIdentityRef"
FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1 FOR UPDATE`;
export const ALIAS_COUNT_SQL = `
SELECT count(*)::int AS total,
  count(*) FILTER (WHERE "aliasType" = 'user' AND "aliasValue" = $2 AND issuer = '')::int AS exact
FROM "PrincipalAlias" WHERE "principalId" = $1`;
export const REVOKE_BINDINGS_SQL = `
UPDATE "AuthorityBinding" SET status = 'revoked', "updatedAt" = now()
WHERE "oauthUserId" = $1 AND status <> 'revoked' RETURNING 1 AS revoked`;
export const DEACTIVATE_USER_SQL = `UPDATE "User" SET "isActive" = false WHERE id = $1 RETURNING 1 AS updated`;
export const DEACTIVATE_PRINCIPAL_SQL = `UPDATE "Principal" SET status = 'inactive', "updatedAt" = now() WHERE id = $1 RETURNING 1 AS updated`;
export const RETIRE_TERMINAL_SQL = `
UPDATE "S5RehearsalRequesterEnrollment"
SET lifecycle = 'retired', "lifecycleAt" = now(),
    "retirementReason" = $2::"S5RehearsalRequesterRetirementReason", "retiredByPrincipalId" = $3
WHERE "setupDigest" = $1 AND lifecycle = 'active' RETURNING 1 AS retired`;

/** Status recovery runs on a pinned pg connection, not through the Prisma adapter. */
export const SETUP_SESSION_LOCK_SQL = `SELECT true AS locked FROM pg_advisory_lock(hashtextextended($1, 0))`;
export const SETUP_SESSION_UNLOCK_SQL = `SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked`;
export const BEGIN_READ_ONLY_SNAPSHOT_SQL = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;
export const COMMIT_SQL = `COMMIT`;
export const ROLLBACK_SQL = `ROLLBACK`;

type Row = Record<string, unknown>;

/** Run one registered statement on a Prisma transaction client; refuses anything else. */
async function runRegistered(tx: Prisma.TransactionClient, sql: string, v: unknown[]): Promise<Row[]> {
  switch (sql) {
    case FENCE_TRY_SHARED_SQL: return tx.$queryRawUnsafe<Row[]>(FENCE_TRY_SHARED_SQL, ...v);
    case SET_LOCK_TIMEOUT_SQL: return tx.$queryRawUnsafe<Row[]>(SET_LOCK_TIMEOUT_SQL, ...v);
    case SETUP_XACT_LOCK_SQL: return tx.$queryRawUnsafe<Row[]>(SETUP_XACT_LOCK_SQL, ...v);
    case RECORD_PRESENT_SQL: return tx.$queryRawUnsafe<Row[]>(RECORD_PRESENT_SQL, ...v);
    case EMAIL_PRESENT_SQL: return tx.$queryRawUnsafe<Row[]>(EMAIL_PRESENT_SQL, ...v);
    case OWNER_SNAPSHOT_SQL: return tx.$queryRawUnsafe<Row[]>(OWNER_SNAPSHOT_SQL, ...v);
    case REQUESTER_STATE_SQL: return tx.$queryRawUnsafe<Row[]>(REQUESTER_STATE_SQL, ...v);
    case RETIRE_LOCK_RECORD_SQL: return tx.$queryRawUnsafe<Row[]>(RETIRE_LOCK_RECORD_SQL, ...v);
    case ALIAS_COUNT_SQL: return tx.$queryRawUnsafe<Row[]>(ALIAS_COUNT_SQL, ...v);
    case REVOKE_BINDINGS_SQL: return tx.$queryRawUnsafe<Row[]>(REVOKE_BINDINGS_SQL, ...v);
    case DEACTIVATE_USER_SQL: return tx.$queryRawUnsafe<Row[]>(DEACTIVATE_USER_SQL, ...v);
    case DEACTIVATE_PRINCIPAL_SQL: return tx.$queryRawUnsafe<Row[]>(DEACTIVATE_PRINCIPAL_SQL, ...v);
    case RETIRE_TERMINAL_SQL: return tx.$queryRawUnsafe<Row[]>(RETIRE_TERMINAL_SQL, ...v);
    default: throw new Error("unregistered S5 requester statement");
  }
}

/** The served adapter: RequesterSql over a Prisma transaction client, registered statements only. */
export function prismaRequesterSql(tx: Prisma.TransactionClient): RequesterSql {
  return { query: (sql, values = []) => runRegistered(tx, sql, values) };
}
