CREATE TABLE "CodeGraphIndexState" (
    "graphKey" TEXT NOT NULL,
    "graphVersion" INTEGER NOT NULL DEFAULT 1,
    "indexStatus" TEXT NOT NULL DEFAULT 'stale',
    "workspaceRoot" TEXT NOT NULL,
    "lastIndexedAt" TIMESTAMP(3),
    "lastIndexedBranch" TEXT,
    "lastIndexedHeadSha" TEXT,
    "workspaceDirty" BOOLEAN NOT NULL DEFAULT false,
    "workspaceDirtyObservedAt" TIMESTAMP(3),
    "indexedFileCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeGraphIndexState_pkey" PRIMARY KEY ("graphKey")
);

CREATE TABLE "CodeGraphFileHash" (
    "id" TEXT NOT NULL,
    "graphKey" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "authority" TEXT NOT NULL DEFAULT 'git',
    "lastIndexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeGraphFileHash_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodeGraphFileHash_graphKey_filePath_key" ON "CodeGraphFileHash"("graphKey", "filePath");
CREATE INDEX "CodeGraphFileHash_graphKey_idx" ON "CodeGraphFileHash"("graphKey");

ALTER TABLE "CodeGraphFileHash"
ADD CONSTRAINT "CodeGraphFileHash_graphKey_fkey"
FOREIGN KEY ("graphKey") REFERENCES "CodeGraphIndexState"("graphKey")
ON DELETE CASCADE ON UPDATE CASCADE;
