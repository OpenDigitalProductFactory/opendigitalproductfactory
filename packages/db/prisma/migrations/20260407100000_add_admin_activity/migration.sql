-- AdminActivity: audit log for all admin coworker tool calls (TAK-ADMIN-001)
CREATE TABLE IF NOT EXISTS "AdminActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "result" TEXT NOT NULL,
    "summary" TEXT,
    "tier" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdminActivity_userId_idx" ON "AdminActivity"("userId");
CREATE INDEX IF NOT EXISTS "AdminActivity_createdAt_idx" ON "AdminActivity"("createdAt");
CREATE INDEX IF NOT EXISTS "AdminActivity_toolName_idx" ON "AdminActivity"("toolName");

ALTER TABLE "AdminActivity" ADD CONSTRAINT "AdminActivity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
