-- AlterTable
ALTER TABLE "BacklogItem" ADD COLUMN     "epicId" TEXT;

-- CreateTable
CREATE TABLE "Epic" (
    "id" TEXT NOT NULL,
    "epicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Epic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpicPortfolio" (
    "epicId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,

    CONSTRAINT "EpicPortfolio_pkey" PRIMARY KEY ("epicId","portfolioId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Epic_epicId_key" ON "Epic"("epicId");

-- AddForeignKey
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpicPortfolio" ADD CONSTRAINT "EpicPortfolio_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpicPortfolio" ADD CONSTRAINT "EpicPortfolio_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
