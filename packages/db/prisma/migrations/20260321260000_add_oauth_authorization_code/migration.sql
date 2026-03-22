-- AlterTable
ALTER TABLE "CredentialEntry" ADD COLUMN     "refreshToken" TEXT;

-- AlterTable
ALTER TABLE "ModelProvider" ADD COLUMN     "authorizeUrl" TEXT,
ADD COLUMN     "oauthClientId" TEXT,
ADD COLUMN     "tokenUrl" TEXT;

-- CreateTable
CREATE TABLE "OAuthPendingFlow" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthPendingFlow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthPendingFlow_state_key" ON "OAuthPendingFlow"("state");
