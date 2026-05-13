-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerPrincipalId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "documentKind" TEXT NOT NULL,
    "contentFormat" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT 'managed',
    "externalLocator" JSONB,
    "currentVersionId" TEXT,
    "currentState" TEXT NOT NULL DEFAULT 'draft',
    "accessScope" TEXT NOT NULL DEFAULT 'organization',
    "classification" TEXT,
    "semanticIndexedAt" TIMESTAMP(3),
    "fullTextIndexedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdByPrincipalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentFormat" TEXT NOT NULL,
    "contentText" TEXT,
    "contentBlobId" TEXT,
    "contentSha256" TEXT,
    "sizeBytes" INTEGER,
    "summary" TEXT,
    "createdByPrincipalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentBlob" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentBlob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentReference" (
    "id" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "sourceVersionId" TEXT,
    "targetDocumentId" TEXT,
    "targetVersionId" TEXT,
    "targetExternalRef" TEXT,
    "refType" TEXT NOT NULL,
    "anchor" TEXT,
    "createdByPrincipalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTag" (
    "documentId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTag_pkey" PRIMARY KEY ("documentId","tag")
);

-- CreateTable
CREATE TABLE "DocumentAccessGrant" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "principalId" TEXT,
    "grantKind" TEXT NOT NULL,
    "createdByPrincipalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "DocumentAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLifecycleEvent" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "reason" TEXT,
    "actorPrincipalId" TEXT,
    "toolExecutionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRendition" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "renditionKind" TEXT NOT NULL,
    "contentText" TEXT,
    "blobId" TEXT,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRendition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_documentId_key" ON "Document"("documentId");

-- CreateIndex
CREATE INDEX "Document_organizationId_currentState_idx" ON "Document"("organizationId", "currentState");

-- CreateIndex
CREATE INDEX "Document_ownerPrincipalId_idx" ON "Document"("ownerPrincipalId");

-- CreateIndex
CREATE INDEX "Document_createdByPrincipalId_idx" ON "Document"("createdByPrincipalId");

-- CreateIndex
CREATE INDEX "Document_documentKind_idx" ON "Document"("documentKind");

-- CreateIndex
CREATE INDEX "Document_contentFormat_idx" ON "Document"("contentFormat");

-- CreateIndex
CREATE INDEX "Document_sourceKind_idx" ON "Document"("sourceKind");

-- CreateIndex
CREATE INDEX "Document_updatedAt_idx" ON "Document"("updatedAt");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");

-- CreateIndex
CREATE INDEX "DocumentVersion_contentBlobId_idx" ON "DocumentVersion"("contentBlobId");

-- CreateIndex
CREATE INDEX "DocumentVersion_contentSha256_idx" ON "DocumentVersion"("contentSha256");

-- CreateIndex
CREATE INDEX "DocumentVersion_createdByPrincipalId_idx" ON "DocumentVersion"("createdByPrincipalId");

-- CreateIndex
CREATE INDEX "DocumentVersion_createdAt_idx" ON "DocumentVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- Full-text search projection for managed documents. Prisma does not model
-- tsvector directly here; Postgres keeps it current through the trigger below.
ALTER TABLE "DocumentVersion" ADD COLUMN "searchVector" tsvector;

CREATE INDEX "DocumentVersion_searchVector_idx" ON "DocumentVersion" USING GIN ("searchVector");

CREATE OR REPLACE FUNCTION "document_version_search_vector_update"()
RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector(
    'english',
    coalesce(NEW."title", '') || ' ' ||
    coalesce(NEW."summary", '') || ' ' ||
    coalesce(NEW."contentText", '')
  );
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "document_version_search_vector_trigger"
BEFORE INSERT OR UPDATE OF "title", "summary", "contentText"
ON "DocumentVersion"
FOR EACH ROW EXECUTE FUNCTION "document_version_search_vector_update"();

-- CreateIndex
CREATE UNIQUE INDEX "DocumentBlob_sha256_key" ON "DocumentBlob"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentBlob_storageKey_key" ON "DocumentBlob"("storageKey");

-- CreateIndex
CREATE INDEX "DocumentBlob_sizeBytes_idx" ON "DocumentBlob"("sizeBytes");

-- CreateIndex
CREATE INDEX "DocumentReference_sourceDocumentId_idx" ON "DocumentReference"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "DocumentReference_sourceVersionId_idx" ON "DocumentReference"("sourceVersionId");

-- CreateIndex
CREATE INDEX "DocumentReference_targetDocumentId_idx" ON "DocumentReference"("targetDocumentId");

-- CreateIndex
CREATE INDEX "DocumentReference_targetVersionId_idx" ON "DocumentReference"("targetVersionId");

-- CreateIndex
CREATE INDEX "DocumentReference_refType_idx" ON "DocumentReference"("refType");

-- CreateIndex
CREATE INDEX "DocumentReference_createdByPrincipalId_idx" ON "DocumentReference"("createdByPrincipalId");

-- CreateIndex
CREATE INDEX "DocumentTag_tag_idx" ON "DocumentTag"("tag");

-- CreateIndex
CREATE INDEX "DocumentAccessGrant_documentId_idx" ON "DocumentAccessGrant"("documentId");

-- CreateIndex
CREATE INDEX "DocumentAccessGrant_principalId_idx" ON "DocumentAccessGrant"("principalId");

-- CreateIndex
CREATE INDEX "DocumentAccessGrant_grantKind_idx" ON "DocumentAccessGrant"("grantKind");

-- CreateIndex
CREATE INDEX "DocumentAccessGrant_createdByPrincipalId_idx" ON "DocumentAccessGrant"("createdByPrincipalId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAccessGrant_documentId_principalId_grantKind_key" ON "DocumentAccessGrant"("documentId", "principalId", "grantKind");

-- CreateIndex
CREATE INDEX "DocumentLifecycleEvent_documentId_createdAt_idx" ON "DocumentLifecycleEvent"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentLifecycleEvent_toState_idx" ON "DocumentLifecycleEvent"("toState");

-- CreateIndex
CREATE INDEX "DocumentLifecycleEvent_actorPrincipalId_idx" ON "DocumentLifecycleEvent"("actorPrincipalId");

-- CreateIndex
CREATE INDEX "DocumentLifecycleEvent_toolExecutionId_idx" ON "DocumentLifecycleEvent"("toolExecutionId");

-- CreateIndex
CREATE INDEX "DocumentRendition_documentVersionId_idx" ON "DocumentRendition"("documentVersionId");

-- CreateIndex
CREATE INDEX "DocumentRendition_blobId_idx" ON "DocumentRendition"("blobId");

-- CreateIndex
CREATE INDEX "DocumentRendition_renditionKind_idx" ON "DocumentRendition"("renditionKind");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRendition_documentVersionId_renditionKind_key" ON "DocumentRendition"("documentVersionId", "renditionKind");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerPrincipalId_fkey" FOREIGN KEY ("ownerPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdByPrincipalId_fkey" FOREIGN KEY ("createdByPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_contentBlobId_fkey" FOREIGN KEY ("contentBlobId") REFERENCES "DocumentBlob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_createdByPrincipalId_fkey" FOREIGN KEY ("createdByPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReference" ADD CONSTRAINT "DocumentReference_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReference" ADD CONSTRAINT "DocumentReference_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReference" ADD CONSTRAINT "DocumentReference_targetDocumentId_fkey" FOREIGN KEY ("targetDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReference" ADD CONSTRAINT "DocumentReference_targetVersionId_fkey" FOREIGN KEY ("targetVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReference" ADD CONSTRAINT "DocumentReference_createdByPrincipalId_fkey" FOREIGN KEY ("createdByPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTag" ADD CONSTRAINT "DocumentTag_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessGrant" ADD CONSTRAINT "DocumentAccessGrant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessGrant" ADD CONSTRAINT "DocumentAccessGrant_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessGrant" ADD CONSTRAINT "DocumentAccessGrant_createdByPrincipalId_fkey" FOREIGN KEY ("createdByPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLifecycleEvent" ADD CONSTRAINT "DocumentLifecycleEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLifecycleEvent" ADD CONSTRAINT "DocumentLifecycleEvent_actorPrincipalId_fkey" FOREIGN KEY ("actorPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLifecycleEvent" ADD CONSTRAINT "DocumentLifecycleEvent_toolExecutionId_fkey" FOREIGN KEY ("toolExecutionId") REFERENCES "ToolExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRendition" ADD CONSTRAINT "DocumentRendition_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRendition" ADD CONSTRAINT "DocumentRendition_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "DocumentBlob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
