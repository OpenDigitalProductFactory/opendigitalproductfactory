import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    standardChangeCatalog: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    changeRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    changeItem: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    calendarEvent: {
      create: vi.fn(),
    },
    employeeProfile: {
      findUnique: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  listCatalogEntries,
  getCatalogEntry,
  createCatalogEntry,
  createRFCFromCatalog,
} from "./standard-change-catalog";

const mockSession = {
  user: {
    id: "user-1",
    email: "ops@test.com",
    platformRole: "HR-000",
    isSuperuser: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
});

// ─── listCatalogEntries ──────────────────────────────────────────────────────

describe("listCatalogEntries", () => {
  it("returns valid catalog entries", async () => {
    vi.mocked(prisma.standardChangeCatalog.findMany).mockResolvedValue([
      { catalogKey: "scc-image-update", title: "Container Image Update" },
    ] as never);

    const result = await listCatalogEntries();
    expect(result).toHaveLength(1);
    expect(prisma.standardChangeCatalog.findMany).toHaveBeenCalledOnce();
  });

  it("filters by category", async () => {
    vi.mocked(prisma.standardChangeCatalog.findMany).mockResolvedValue([] as never);

    await listCatalogEntries({ category: "infrastructure" });

    const findCall = vi.mocked(prisma.standardChangeCatalog.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(findCall.where.category).toBe("infrastructure");
  });
});

// ─── getCatalogEntry ─────────────────────────────────────────────────────────

describe("getCatalogEntry", () => {
  it("returns entry by key", async () => {
    vi.mocked(prisma.standardChangeCatalog.findUnique).mockResolvedValue({
      catalogKey: "scc-image-update",
      title: "Container Image Update",
    } as never);

    const result = await getCatalogEntry("scc-image-update");
    expect(result.catalogKey).toBe("scc-image-update");
  });

  it("throws when not found", async () => {
    vi.mocked(prisma.standardChangeCatalog.findUnique).mockResolvedValue(null as never);

    await expect(getCatalogEntry("nonexistent")).rejects.toThrow("Catalog entry not found");
  });
});

// ─── createCatalogEntry ──────────────────────────────────────────────────────

describe("createCatalogEntry", () => {
  it("creates entry with correct data", async () => {
    vi.mocked(prisma.employeeProfile.findUnique).mockResolvedValue({
      id: "emp-1",
    } as never);
    vi.mocked(prisma.standardChangeCatalog.create).mockResolvedValue({
      catalogKey: "scc-cert-rotation",
    } as never);

    const result = await createCatalogEntry({
      catalogKey: "scc-cert-rotation",
      title: "TLS Certificate Rotation",
      description: "Rotate TLS certificates on all ingress controllers",
      category: "infrastructure",
      preAssessedRisk: "low",
      templateItems: [
        { itemType: "infrastructure", title: "Rotate ingress cert" },
      ],
    });

    expect(result.catalogKey).toBe("scc-cert-rotation");

    const createCall = vi.mocked(prisma.standardChangeCatalog.create).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createCall.data.approvedById).toBe("emp-1");
    expect(createCall.data.preAssessedRisk).toBe("low");
  });

  it("rejects high/critical risk for standard changes", async () => {
    await expect(
      createCatalogEntry({
        catalogKey: "scc-bad",
        title: "Bad",
        description: "Bad",
        category: "infrastructure",
        preAssessedRisk: "high",
        templateItems: [{ itemType: "infrastructure", title: "Test" }],
      })
    ).rejects.toThrow("Standard changes can only have low or medium risk");
  });

  it("rejects empty template items", async () => {
    await expect(
      createCatalogEntry({
        catalogKey: "scc-empty",
        title: "Empty",
        description: "Empty",
        category: "infrastructure",
        preAssessedRisk: "low",
        templateItems: [],
      })
    ).rejects.toThrow("At least one template item is required");
  });
});

// ─── createRFCFromCatalog ────────────────────────────────────────────────────

describe("createRFCFromCatalog", () => {
  it("creates RFC from catalog template with auto-approval", async () => {
    const futureDate = new Date("2027-12-31");
    vi.mocked(prisma.standardChangeCatalog.findUnique).mockResolvedValue({
      catalogKey: "scc-image-update",
      title: "Container Image Update",
      description: "Update container image to latest tag",
      preAssessedRisk: "low",
      approvedById: "emp-approver",
      validUntil: futureDate,
      templateItems: [
        { itemType: "code_deployment", title: "Update web image" },
        { itemType: "configuration", title: "Update env vars" },
      ],
    } as never);

    // createRFC calls
    vi.mocked(prisma.changeRequest.create).mockResolvedValue({} as never);
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      id: "cr-from-catalog",
      rfcId: "RFC-2026-CAFECAFE",
      status: "draft",
      approvedById: null,
    } as never);
    vi.mocked(prisma.changeItem.create).mockResolvedValue({} as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    const result = await createRFCFromCatalog("scc-image-update");

    expect(result.rfcId).toMatch(/^RFC-/);

    // Two change items created from template
    expect(prisma.changeItem.create).toHaveBeenCalledTimes(2);

    // RFC auto-transitions to approved
    const updateCall = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data.status).toBe("approved");
    expect(updateCall.data.approvedById).toBe("emp-approver");
    expect(updateCall.data.submittedAt).toBeInstanceOf(Date);
    expect(updateCall.data.assessedAt).toBeInstanceOf(Date);
    expect(updateCall.data.approvedAt).toBeInstanceOf(Date);
  });

  it("rejects expired catalog entry", async () => {
    vi.mocked(prisma.standardChangeCatalog.findUnique).mockResolvedValue({
      catalogKey: "scc-expired",
      validUntil: new Date("2020-01-01"),
    } as never);

    await expect(createRFCFromCatalog("scc-expired")).rejects.toThrow("expired");
  });

  it("throws when catalog entry not found", async () => {
    vi.mocked(prisma.standardChangeCatalog.findUnique).mockResolvedValue(null as never);

    await expect(createRFCFromCatalog("nonexistent")).rejects.toThrow("Catalog entry not found");
  });
});
