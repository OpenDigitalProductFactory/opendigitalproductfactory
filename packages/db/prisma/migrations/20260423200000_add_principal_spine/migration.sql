-- CreateTable
CREATE TABLE "Principal" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Principal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrincipalAlias" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "aliasType" TEXT NOT NULL,
    "aliasValue" TEXT NOT NULL,
    "issuer" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrincipalAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Principal_principalId_key" ON "Principal"("principalId");

-- CreateIndex
CREATE INDEX "PrincipalAlias_principalId_idx" ON "PrincipalAlias"("principalId");

-- CreateIndex
CREATE UNIQUE INDEX "PrincipalAlias_aliasType_aliasValue_issuer_key" ON "PrincipalAlias"("aliasType", "aliasValue", "issuer");

-- AddForeignKey
ALTER TABLE "PrincipalAlias" ADD CONSTRAINT "PrincipalAlias_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing users into the principal spine.
CREATE TEMP TABLE "_principal_user_seed" AS
SELECT
    u."id" AS "sourceUserId",
    gen_random_uuid()::text AS "principalRowId",
    'PRN-' || replace(gen_random_uuid()::text, '-', '') AS "principalBusinessId",
    CASE
        WHEN u."isActive" THEN 'active'
        ELSE 'inactive'
    END AS "principalStatus",
    COALESCE(ep."displayName", u."email") AS "displayName",
    u."createdAt" AS "createdAt"
FROM "User" u
LEFT JOIN "EmployeeProfile" ep
    ON ep."userId" = u."id"
LEFT JOIN "PrincipalAlias" existingAlias
    ON existingAlias."aliasType" = 'user'
   AND existingAlias."aliasValue" = u."id"
   AND existingAlias."issuer" = ''
WHERE existingAlias."id" IS NULL;

INSERT INTO "Principal" (
    "id",
    "principalId",
    "kind",
    "status",
    "displayName",
    "createdAt",
    "updatedAt"
)
SELECT
    seed."principalRowId",
    seed."principalBusinessId",
    'human',
    seed."principalStatus",
    seed."displayName",
    seed."createdAt",
    CURRENT_TIMESTAMP
FROM "_principal_user_seed" seed;

INSERT INTO "PrincipalAlias" (
    "id",
    "principalId",
    "aliasType",
    "aliasValue",
    "issuer",
    "createdAt"
)
SELECT
    gen_random_uuid()::text,
    seed."principalRowId",
    'user',
    seed."sourceUserId",
    '',
    seed."createdAt"
FROM "_principal_user_seed" seed
ON CONFLICT ("aliasType", "aliasValue", "issuer") DO NOTHING;

-- Attach employee aliases to existing user-backed principals first.
INSERT INTO "PrincipalAlias" (
    "id",
    "principalId",
    "aliasType",
    "aliasValue",
    "issuer",
    "createdAt"
)
SELECT
    gen_random_uuid()::text,
    userAlias."principalId",
    'employee',
    ep."employeeId",
    '',
    ep."createdAt"
FROM "EmployeeProfile" ep
JOIN "PrincipalAlias" userAlias
    ON userAlias."aliasType" = 'user'
   AND userAlias."aliasValue" = ep."userId"
   AND userAlias."issuer" = ''
WHERE ep."userId" IS NOT NULL
ON CONFLICT ("aliasType", "aliasValue", "issuer") DO NOTHING;

-- Backfill employees without an attached user principal.
CREATE TEMP TABLE "_principal_employee_seed" AS
SELECT
    ep."id" AS "sourceEmployeeProfileId",
    ep."employeeId" AS "sourceEmployeeId",
    gen_random_uuid()::text AS "principalRowId",
    'PRN-' || replace(gen_random_uuid()::text, '-', '') AS "principalBusinessId",
    CASE
        WHEN ep."status" = 'inactive' THEN 'inactive'
        ELSE 'active'
    END AS "principalStatus",
    ep."displayName" AS "displayName",
    ep."createdAt" AS "createdAt"
FROM "EmployeeProfile" ep
LEFT JOIN "PrincipalAlias" existingAlias
    ON existingAlias."aliasType" = 'employee'
   AND existingAlias."aliasValue" = ep."employeeId"
   AND existingAlias."issuer" = ''
WHERE existingAlias."id" IS NULL;

INSERT INTO "Principal" (
    "id",
    "principalId",
    "kind",
    "status",
    "displayName",
    "createdAt",
    "updatedAt"
)
SELECT
    seed."principalRowId",
    seed."principalBusinessId",
    'human',
    seed."principalStatus",
    seed."displayName",
    seed."createdAt",
    CURRENT_TIMESTAMP
FROM "_principal_employee_seed" seed;

INSERT INTO "PrincipalAlias" (
    "id",
    "principalId",
    "aliasType",
    "aliasValue",
    "issuer",
    "createdAt"
)
SELECT
    gen_random_uuid()::text,
    seed."principalRowId",
    'employee',
    seed."sourceEmployeeId",
    '',
    seed."createdAt"
FROM "_principal_employee_seed" seed
ON CONFLICT ("aliasType", "aliasValue", "issuer") DO NOTHING;

-- Backfill AI workforce agents into the principal spine.
CREATE TEMP TABLE "_principal_agent_seed" AS
SELECT
    a."id" AS "sourceAgentRowId",
    a."agentId" AS "sourceAgentId",
    gen_random_uuid()::text AS "principalRowId",
    'PRN-' || replace(gen_random_uuid()::text, '-', '') AS "principalBusinessId",
    CASE
        WHEN a."archived" THEN 'inactive'
        ELSE COALESCE(a."status", 'active')
    END AS "principalStatus",
    a."name" AS "displayName",
    a."createdAt" AS "createdAt"
FROM "Agent" a
LEFT JOIN "PrincipalAlias" existingAlias
    ON existingAlias."aliasType" = 'agent'
   AND existingAlias."aliasValue" = a."agentId"
   AND existingAlias."issuer" = ''
WHERE existingAlias."id" IS NULL;

INSERT INTO "Principal" (
    "id",
    "principalId",
    "kind",
    "status",
    "displayName",
    "createdAt",
    "updatedAt"
)
SELECT
    seed."principalRowId",
    seed."principalBusinessId",
    'agent',
    seed."principalStatus",
    seed."displayName",
    seed."createdAt",
    CURRENT_TIMESTAMP
FROM "_principal_agent_seed" seed;

INSERT INTO "PrincipalAlias" (
    "id",
    "principalId",
    "aliasType",
    "aliasValue",
    "issuer",
    "createdAt"
)
SELECT
    gen_random_uuid()::text,
    seed."principalRowId",
    'agent',
    seed."sourceAgentId",
    '',
    seed."createdAt"
FROM "_principal_agent_seed" seed
ON CONFLICT ("aliasType", "aliasValue", "issuer") DO NOTHING;
