-- Media asset management — see
-- docs/superpowers/specs/2026-06-12-media-asset-management-design.md.
-- Additive only: a first-class content-addressed MediaAsset, a polymorphic
-- ordered MediaAttachment, and the previously-missing AdoptableAnimal entity
-- behind the `animals-available` storefront section. Existing scalar image
-- columns (imageUrl/logoUrl/avatarUrl/heroImageUrl) are untouched and stay as a
-- denormalized primary-image cache.

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageDriver" TEXT NOT NULL DEFAULT 'filesystem',
    "kind" TEXT NOT NULL DEFAULT 'image',
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "altText" TEXT,
    "dominantColor" TEXT,
    "blurhash" TEXT,
    "focalX" DOUBLE PRECISION DEFAULT 0.5,
    "focalY" DOUBLE PRECISION DEFAULT 0.5,
    "originalName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'gallery',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdoptableAnimal" (
    "id" TEXT NOT NULL,
    "animalRef" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" TEXT,
    "breed" TEXT,
    "age" TEXT,
    "sex" TEXT,
    "size" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "primaryPhotoAssetId" TEXT,
    "attributes" JSONB,
    "publishedAt" TIMESTAMP(3),
    "adoptedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdoptableAnimal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_organizationId_sha256_key" ON "MediaAsset"("organizationId", "sha256");

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_kind_status_idx" ON "MediaAsset"("organizationId", "kind", "status");

-- CreateIndex
CREATE INDEX "MediaAttachment_ownerType_ownerId_role_sortOrder_idx" ON "MediaAttachment"("ownerType", "ownerId", "role", "sortOrder");

-- CreateIndex
CREATE INDEX "MediaAttachment_organizationId_idx" ON "MediaAttachment"("organizationId");

-- CreateIndex
CREATE INDEX "MediaAttachment_mediaAssetId_idx" ON "MediaAttachment"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "AdoptableAnimal_animalRef_key" ON "AdoptableAnimal"("animalRef");

-- CreateIndex
CREATE INDEX "AdoptableAnimal_storefrontId_status_sortOrder_idx" ON "AdoptableAnimal"("storefrontId", "status", "sortOrder");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAttachment" ADD CONSTRAINT "MediaAttachment_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdoptableAnimal" ADD CONSTRAINT "AdoptableAnimal_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
