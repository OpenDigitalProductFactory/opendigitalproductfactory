-- Generalize supplier contracts so Finance can track AI providers plus
-- non-AI commitments such as domains, SaaS subscriptions, and one-time costs.

ALTER TABLE "SupplierContract" ALTER COLUMN "profileId" DROP NOT NULL;

ALTER TABLE "SupplierContract"
  ADD COLUMN "commitmentKind" TEXT NOT NULL DEFAULT 'ai_provider',
  ADD COLUMN "commitmentSource" TEXT NOT NULL DEFAULT 'ai_provider_registry',
  ADD COLUMN "externalReference" TEXT;

CREATE UNIQUE INDEX "SupplierContract_externalReference_key" ON "SupplierContract"("externalReference");
CREATE INDEX "SupplierContract_commitmentKind_status_idx" ON "SupplierContract"("commitmentKind", "status");
