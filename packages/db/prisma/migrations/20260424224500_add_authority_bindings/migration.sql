-- CreateTable
CREATE TABLE "AuthorityBinding" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "resourceType" TEXT NOT NULL,
    "resourceRef" TEXT NOT NULL,
    "appliedAgentId" TEXT,
    "policyJson" JSONB,
    "authorityScope" JSONB,
    "approvalMode" TEXT NOT NULL DEFAULT 'none',
    "sensitivityCeiling" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorityBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorityBindingSubject" (
    "id" TEXT NOT NULL,
    "authorityBindingId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorityBindingSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorityBindingGrant" (
    "id" TEXT NOT NULL,
    "authorityBindingId" TEXT NOT NULL,
    "grantKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorityBindingGrant_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AuthorizationDecisionLog"
ADD COLUMN "authorityBindingId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AuthorityBinding_bindingId_key" ON "AuthorityBinding"("bindingId");

-- CreateIndex
CREATE INDEX "AuthorityBinding_scopeType_status_idx" ON "AuthorityBinding"("scopeType", "status");

-- CreateIndex
CREATE INDEX "AuthorityBinding_resourceType_resourceRef_idx" ON "AuthorityBinding"("resourceType", "resourceRef");

-- CreateIndex
CREATE INDEX "AuthorityBinding_appliedAgentId_idx" ON "AuthorityBinding"("appliedAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorityBindingSubject_authorityBindingId_subjectType_subjectRef_relation_key"
ON "AuthorityBindingSubject"("authorityBindingId", "subjectType", "subjectRef", "relation");

-- CreateIndex
CREATE INDEX "AuthorityBindingSubject_subjectType_subjectRef_idx" ON "AuthorityBindingSubject"("subjectType", "subjectRef");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorityBindingGrant_authorityBindingId_grantKey_key"
ON "AuthorityBindingGrant"("authorityBindingId", "grantKey");

-- CreateIndex
CREATE INDEX "AuthorityBindingGrant_grantKey_idx" ON "AuthorityBindingGrant"("grantKey");

-- CreateIndex
CREATE INDEX "AuthorizationDecisionLog_authorityBindingId_idx" ON "AuthorizationDecisionLog"("authorityBindingId");

-- AddForeignKey
ALTER TABLE "AuthorityBinding"
ADD CONSTRAINT "AuthorityBinding_appliedAgentId_fkey"
FOREIGN KEY ("appliedAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorityBindingSubject"
ADD CONSTRAINT "AuthorityBindingSubject_authorityBindingId_fkey"
FOREIGN KEY ("authorityBindingId") REFERENCES "AuthorityBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorityBindingGrant"
ADD CONSTRAINT "AuthorityBindingGrant_authorityBindingId_fkey"
FOREIGN KEY ("authorityBindingId") REFERENCES "AuthorityBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizationDecisionLog"
ADD CONSTRAINT "AuthorizationDecisionLog_authorityBindingId_fkey"
FOREIGN KEY ("authorityBindingId") REFERENCES "AuthorityBinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
