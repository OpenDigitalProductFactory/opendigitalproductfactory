ALTER TABLE "QuiescenceRun"
  ADD COLUMN "readyToSwapBudgetMs" INTEGER,
  ADD COLUMN "readyToSwapDeadlineAt" TIMESTAMP(3);

ALTER TABLE "SelfUpgradeRun"
  ADD COLUMN "confirmedReadyToSwapMaxMs" INTEGER;
