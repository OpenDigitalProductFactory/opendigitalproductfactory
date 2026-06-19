-- BI-3E0EE3BA: self-fix-feasibility class for escalations raised by an
-- autonomous producer (Build Studio) that could not self-repair a unit of work.
-- One of: auto-recoverable | needs-human | needs-external-capability.
-- Nullable: ordinary PlatformIssueReport rows leave it null. Downstream consumers
-- are hive learning (BI-76B4317F) and support-tier routing (BI-5090F4AA).

-- AlterTable
ALTER TABLE "PlatformIssueReport" ADD COLUMN "selfFixClass" TEXT;
