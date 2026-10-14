-- @migration-safety: data-safe: rename immutable attribution columns and indexes
-- without changing their values, NULLs, types or history. These recorded references
-- intentionally outlive account deletion and do not pretend to be live FKs.
ALTER TABLE "TokenUsage" RENAME COLUMN "providerConnectionId" TO "recordedProviderConnectionRef";
ALTER INDEX "TokenUsage_providerConnectionId_createdAt_idx" RENAME TO "TokenUsage_recordedProviderConnectionRef_createdAt_idx";
ALTER TABLE "RouteOutcome" RENAME COLUMN "providerConnectionId" TO "recordedProviderConnectionRef";
ALTER INDEX "RouteOutcome_providerConnectionId_createdAt_idx" RENAME TO "RouteOutcome_recordedProviderConnectionRef_createdAt_idx";
