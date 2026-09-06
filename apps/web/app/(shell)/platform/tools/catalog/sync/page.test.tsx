import { beforeEach, describe, expect, it, vi } from "vitest";

const findRecentSyncs = vi.fn();
const getScheduledJobs = vi.fn();
const upsertScheduledJob = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { platformRole: "HR-000", isSuperuser: true } })),
}));
vi.mock("@/lib/permissions", () => ({ can: vi.fn(() => true) }));
vi.mock("@dpf/db", () => ({
  prisma: {
    mcpCatalogSync: { findMany: (...args: unknown[]) => findRecentSyncs(...args) },
    scheduledJob: { upsert: (...args: unknown[]) => upsertScheduledJob(...args) },
  },
}));
vi.mock("@/lib/ai-provider-data", () => ({
  getScheduledJobs: (...args: unknown[]) => getScheduledJobs(...args),
}));
vi.mock("@/components/platform/McpSyncButton", () => ({ McpSyncButton: () => null }));
vi.mock("@/components/platform/ScheduledJobsTable", () => ({ ScheduledJobsTable: () => null }));
vi.mock("@/components/ui/LocalTime", () => ({ LocalTime: () => null }));

import IntegrationsSyncPage from "./page";

describe("IntegrationsSyncPage", () => {
  beforeEach(() => {
    findRecentSyncs.mockReset().mockResolvedValue([]);
    getScheduledJobs.mockReset().mockResolvedValue([]);
    upsertScheduledJob.mockReset().mockResolvedValue({ schedule: "weekly", nextRunAt: null });
  });

  it("is read-only and consumes the boot-provisioned schedule", async () => {
    await IntegrationsSyncPage();

    expect(findRecentSyncs).toHaveBeenCalledOnce();
    expect(getScheduledJobs).toHaveBeenCalledOnce();
    expect(upsertScheduledJob).not.toHaveBeenCalled();
  });
});
