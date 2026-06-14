-- CreateTable
CREATE TABLE "StorefrontArchetypeComposition" (
    "id" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "archetypeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontArchetypeComposition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontArchetypeComposition_storefrontId_archetypeId_key" ON "StorefrontArchetypeComposition"("storefrontId", "archetypeId");

-- CreateIndex
CREATE INDEX "StorefrontArchetypeComposition_storefrontId_role_idx" ON "StorefrontArchetypeComposition"("storefrontId", "role");

-- AddForeignKey
ALTER TABLE "StorefrontArchetypeComposition" ADD CONSTRAINT "StorefrontArchetypeComposition_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontArchetypeComposition" ADD CONSTRAINT "StorefrontArchetypeComposition_archetypeId_fkey" FOREIGN KEY ("archetypeId") REFERENCES "StorefrontArchetype"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing StorefrontConfig row becomes a primary composition row.
-- New installs seed this row at setup completion (setup route).
-- ON CONFLICT is defence-in-depth; the table is empty at migration time.
INSERT INTO "StorefrontArchetypeComposition" (id, "storefrontId", "archetypeId", role, "sortOrder", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    sc.id,
    sc."archetypeId",
    'primary',
    0,
    NOW(),
    NOW()
FROM "StorefrontConfig" sc
ON CONFLICT ("storefrontId", "archetypeId") DO NOTHING;
