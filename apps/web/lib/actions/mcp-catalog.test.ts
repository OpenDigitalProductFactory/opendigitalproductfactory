import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/mcp-catalog-sync", () => ({ runMcpCatalogSync: vi.fn() }));
vi.mock("@/lib/ai-provider-types", () => ({
  computeNextRunAt: vi.fn().mockReturnValue(new Date("2026-04-01")),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpCatalogSync: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    scheduledJob: {
      upsert: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    mcpIntegration: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { runMcpCatalogSync } from "@/lib/mcp-catalog-sync";
import { triggerMcpCatalogSync, queryMcpIntegrations, updateMcpCatalogSchedule, runMcpCatalogSyncIfDue } from "./mcp-catalog";

const mockAdminSession = {
  user: { id: "user-1", email: "admin@test.com", platformRole: "HR-000", isSuperuser: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockAdminSession as never);
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(prisma.mcpCatalogSync.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.mcpCatalogSync.create).mockResolvedValue({ id: "sync-1" } as never);
  vi.mocked(prisma.scheduledJob.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.scheduledJob.update).mockResolvedValue({} as never);
  vi.mocked(prisma.scheduledJob.findUnique).mockResolvedValue({ schedule: "weekly" } as never);
  vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([]);
  vi.mocked(prisma.mcpIntegration.count).mockResolvedValue(0);
  vi.mocked(runMcpCatalogSync).mockResolvedValue(undefined);
});

describe("triggerMcpCatalogSync", () => {
  it("rejects unauthenticated callers", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const result = await triggerMcpCatalogSync();
    expect(result.ok).toBe(false);
  });

  it("rejects callers without manage_provider_connections", async () => {
    vi.mocked(can).mockReturnValue(false);
    const result = await triggerMcpCatalogSync();
    expect(result.ok).toBe(false);
  });

  it("rejects when sync already running", async () => {
    vi.mocked(prisma.mcpCatalogSync.findFirst).mockResolvedValue({ id: "running-1", status: "running" } as never);
    const result = await triggerMcpCatalogSync();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("already in progress");
  });

  it("creates a sync record and returns syncId", async () => {
    const result = await triggerMcpCatalogSync();
    expect(prisma.mcpCatalogSync.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triggeredBy: "manual", triggeredByUserId: "user-1" }) })
    );
    expect(result.ok).toBe(true);
    expect(result.syncId).toBe("sync-1");
  });
});

describe("queryMcpIntegrations", () => {
  it("returns integrations matching query", async () => {
    vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
      {
        id: "1",
        name: "Stripe",
        slug: "stripe",
        category: "finance",
        status: "active",
        tags: ["payments"],
        rawMetadata: {},
      } as never,
    ]);
    const result = await queryMcpIntegrations({ query: "stripe" });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Stripe");
    expect(result[0].connectorProfile.authModes).toContain("api_key_header");
    expect(result[0].connectorProfile.capabilities).toContain("universal_api_call");
  });

  it("filters by category", async () => {
    await queryMcpIntegrations({ query: "payment", category: "finance" });
    expect(prisma.mcpIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: "finance" }),
      })
    );
  });

  it("filters by pricingModel", async () => {
    await queryMcpIntegrations({ query: "anything", pricingModel: "free" });
    expect(prisma.mcpIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pricingModel: "free" }),
      })
    );
  });

  it("only returns active status entries", async () => {
    await queryMcpIntegrations({ query: "stripe" });
    expect(prisma.mcpIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "active" }),
      })
    );
  });

  it("uses explicit connector metadata from rawMetadata when present", async () => {
    vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
      {
        id: "2",
        name: "Microsoft Teams",
        slug: "microsoft-teams",
        category: "communication",
        status: "active",
        tags: ["teams", "chat"],
        rawMetadata: {
          dpfConnectorProfile: {
            authModes: ["oauth_client_credentials"],
            transportModes: ["rest_json"],
            capabilities: ["list", "get", "polling_trigger", "webhook_trigger", "universal_api_call"],
            supportsGenericConnector: true,
          },
        },
      } as never,
    ]);

    const result = await queryMcpIntegrations({ query: "teams" });
    expect(result[0].connectorProfile.metadataSource).toBe("explicit");
    expect(result[0].connectorProfile.capabilities).toContain("webhook_trigger");
  });

  it("attaches native integration routing for ADP", async () => {
    vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
      {
        id: "3",
        name: "ADP Workforce Now",
        slug: "adp-workforce-now",
        category: "hr",
        status: "active",
        tags: ["adp", "payroll"],
        rawMetadata: {},
      } as never,
    ]);

    const result = await queryMcpIntegrations({ query: "adp" });
    expect(result[0].nativeIntegration?.route).toBe("/platform/tools/integrations/adp");
    expect(result[0].nativeIntegration?.activationKind).toBe("native_setup");
  });
});

describe("runMcpCatalogSyncIfDue", () => {
  it("skips when no job exists", async () => {
    vi.mocked(prisma.scheduledJob.findUnique).mockResolvedValue(null);
    await runMcpCatalogSyncIfDue();
    expect(prisma.mcpCatalogSync.create).not.toHaveBeenCalled();
  });

  it("skips when job is disabled", async () => {
    vi.mocked(prisma.scheduledJob.findUnique).mockResolvedValue({ schedule: "disabled", nextRunAt: null } as never);
    await runMcpCatalogSyncIfDue();
    expect(prisma.mcpCatalogSync.create).not.toHaveBeenCalled();
  });

  it("skips when nextRunAt is in the future", async () => {
    vi.mocked(prisma.scheduledJob.findUnique).mockResolvedValue({
      schedule: "weekly",
      nextRunAt: new Date(Date.now() + 86400000),
    } as never);
    await runMcpCatalogSyncIfDue();
    expect(prisma.mcpCatalogSync.create).not.toHaveBeenCalled();
  });

  it("skips when a sync is already running", async () => {
    vi.mocked(prisma.scheduledJob.findUnique).mockResolvedValue({
      schedule: "weekly",
      nextRunAt: new Date(Date.now() - 1000),
    } as never);
    vi.mocked(prisma.mcpCatalogSync.findFirst).mockResolvedValue({ id: "running-1", status: "running" } as never);
    await runMcpCatalogSyncIfDue();
    expect(prisma.mcpCatalogSync.create).not.toHaveBeenCalled();
  });

  it("creates a scheduled sync when due", async () => {
    vi.mocked(prisma.scheduledJob.findUnique).mockResolvedValue({
      jobId: "mcp-catalog-sync",
      schedule: "weekly",
      nextRunAt: new Date(Date.now() - 1000),
    } as never);
    await runMcpCatalogSyncIfDue();
    expect(prisma.mcpCatalogSync.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triggeredBy: "schedule" }) })
    );
  });
});

describe("updateMcpCatalogSchedule", () => {
  it("rejects callers without manage_provider_connections", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(updateMcpCatalogSchedule("weekly")).rejects.toThrow("Unauthorized");
  });

  it("upserts the ScheduledJob with new schedule and nextRunAt", async () => {
    await updateMcpCatalogSchedule("monthly");
    expect(prisma.scheduledJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: "mcp-catalog-sync" },
        update: expect.objectContaining({ schedule: "monthly" }),
      })
    );
  });
});
