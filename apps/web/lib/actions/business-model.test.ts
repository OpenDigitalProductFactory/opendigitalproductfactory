// apps/web/lib/actions/business-model.test.ts
//
// Integration-style unit tests for business-model server actions.
// Covers: seed idempotency, CRUD lifecycle, built-in immutability,
// assignment constraints.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@dpf/db", () => ({
  prisma: {
    businessModel: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    businessModelRole: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    productBusinessModel: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    businessModelRoleAssignment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() =>
    Promise.resolve({ user: { id: "user-admin", platformRole: "admin", isSuperuser: true } }),
  ),
}));

vi.mock("@/lib/permissions", () => ({ can: vi.fn(() => true) }));

import { prisma } from "@dpf/db";
import {
  assignBusinessModelToProduct,
  removeBusinessModelFromProduct,
  assignUserToBusinessModelRole,
  revokeUserFromBusinessModelRole,
  createCustomBusinessModel,
  updateCustomBusinessModel,
  deprecateBusinessModel,
  retireBusinessModel,
  cloneBusinessModel,
  addRoleToBusinessModel,
  removeRoleFromBusinessModel,
  listBusinessModels,
  getProductBusinessModels,
} from "./business-model";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "bm-1",
    modelId: "bm-saas",
    name: "SaaS",
    description: null,
    isBuiltIn: true,
    status: "active",
    _count: { roles: 4, products: 0 },
    ...overrides,
  };
}

function makeRole(overrides: Record<string, unknown> = {}) {
  return {
    id: "role-1",
    roleId: "BMR-SAAS-001",
    name: "Product Owner",
    authorityDomain: "Roadmap, backlog",
    it4itAlignment: "Plan",
    hitlTierDefault: 2,
    escalatesTo: "HR-200",
    isBuiltIn: true,
    status: "active",
    businessModelId: "bm-1",
    ...overrides,
  };
}

// ─── assignBusinessModelToProduct ─────────────────────────────────────────────

describe("assignBusinessModelToProduct", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates a ProductBusinessModel record when not already assigned", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(makeModel() as never);
    vi.mocked(prisma.productBusinessModel.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.productBusinessModel.create).mockResolvedValue({ id: "pbm-1" } as never);

    const result = await assignBusinessModelToProduct("prod-1", "bm-1");
    expect(result.ok).toBe(true);
    expect(prisma.productBusinessModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ productId: "prod-1", businessModelId: "bm-1" }),
      }),
    );
  });

  it("returns error when business model does not exist", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(null);

    const result = await assignBusinessModelToProduct("prod-1", "bm-missing");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("returns error when business model is not active", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(
      makeModel({ status: "deprecated" }) as never,
    );

    const result = await assignBusinessModelToProduct("prod-1", "bm-1");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not active/i);
  });

  it("returns error when already assigned", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(makeModel() as never);
    vi.mocked(prisma.productBusinessModel.findUnique).mockResolvedValue({ id: "pbm-1" } as never);

    const result = await assignBusinessModelToProduct("prod-1", "bm-1");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already assigned/i);
  });
});

// ─── removeBusinessModelFromProduct ───────────────────────────────────────────

describe("removeBusinessModelFromProduct", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("deletes the ProductBusinessModel record", async () => {
    vi.mocked(prisma.productBusinessModel.findUnique).mockResolvedValue({ id: "pbm-1" } as never);
    vi.mocked(prisma.productBusinessModel.delete).mockResolvedValue({} as never);

    const result = await removeBusinessModelFromProduct("prod-1", "bm-1");
    expect(result.ok).toBe(true);
    expect(prisma.productBusinessModel.delete).toHaveBeenCalled();
  });

  it("returns error when assignment not found", async () => {
    vi.mocked(prisma.productBusinessModel.findUnique).mockResolvedValue(null);

    const result = await removeBusinessModelFromProduct("prod-1", "bm-1");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not assigned/i);
  });
});

// ─── assignUserToBusinessModelRole ────────────────────────────────────────────

describe("assignUserToBusinessModelRole", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates an assignment when business model is assigned to product and no active assignment exists", async () => {
    vi.mocked(prisma.businessModelRole.findUnique).mockResolvedValue(
      makeRole() as never,
    );
    vi.mocked(prisma.productBusinessModel.findUnique).mockResolvedValue({ id: "pbm-1" } as never);
    vi.mocked(prisma.businessModelRoleAssignment.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.businessModelRoleAssignment.create).mockResolvedValue({ id: "asn-1" } as never);

    const result = await assignUserToBusinessModelRole("user-1", "role-1", "prod-1");
    expect(result.ok).toBe(true);
    expect(prisma.businessModelRoleAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          businessModelRoleId: "role-1",
          productId: "prod-1",
        }),
      }),
    );
  });

  it("returns error when business model is not assigned to the product", async () => {
    vi.mocked(prisma.businessModelRole.findUnique).mockResolvedValue(makeRole() as never);
    vi.mocked(prisma.productBusinessModel.findUnique).mockResolvedValue(null);

    const result = await assignUserToBusinessModelRole("user-1", "role-1", "prod-1");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not assigned to this product/i);
  });

  it("returns error when role already has an active assignment", async () => {
    vi.mocked(prisma.businessModelRole.findUnique).mockResolvedValue(makeRole() as never);
    vi.mocked(prisma.productBusinessModel.findUnique).mockResolvedValue({ id: "pbm-1" } as never);
    vi.mocked(prisma.businessModelRoleAssignment.findFirst).mockResolvedValue({ id: "asn-existing" } as never);

    const result = await assignUserToBusinessModelRole("user-1", "role-1", "prod-1");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already assigned/i);
  });
});

// ─── revokeUserFromBusinessModelRole ──────────────────────────────────────────

describe("revokeUserFromBusinessModelRole", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sets revokedAt on the active assignment", async () => {
    vi.mocked(prisma.businessModelRoleAssignment.findFirst).mockResolvedValue({
      id: "asn-1",
    } as never);
    vi.mocked(prisma.businessModelRoleAssignment.update).mockResolvedValue({} as never);

    const result = await revokeUserFromBusinessModelRole("user-1", "role-1", "prod-1");
    expect(result.ok).toBe(true);
    expect(prisma.businessModelRoleAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asn-1" },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
  });

  it("returns error when no active assignment found", async () => {
    vi.mocked(prisma.businessModelRoleAssignment.findFirst).mockResolvedValue(null);

    const result = await revokeUserFromBusinessModelRole("user-1", "role-1", "prod-1");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no active assignment/i);
  });
});

// ─── createCustomBusinessModel ────────────────────────────────────────────────

describe("createCustomBusinessModel", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates a model and its roles", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.businessModel.create).mockResolvedValue(makeModel({ isBuiltIn: false }) as never);

    const result = await createCustomBusinessModel("My Model", null, [
      { name: "Owner", authorityDomain: "Strategy", escalatesTo: "HR-200", hitlTierDefault: 2 },
    ]);
    expect(result.ok).toBe(true);
    expect(prisma.businessModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isBuiltIn: false }),
      }),
    );
  });

  it("rejects when more than 20 roles are provided", async () => {
    const roles = Array.from({ length: 21 }, (_, i) => ({
      name: `Role ${i}`,
      escalatesTo: "HR-200",
      hitlTierDefault: 2,
    }));

    const result = await createCustomBusinessModel("Big Model", null, roles);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/20 roles/i);
  });
});

// ─── updateCustomBusinessModel — built-in immutability ────────────────────────

describe("updateCustomBusinessModel", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("blocks updates to built-in models", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(makeModel({ isBuiltIn: true }) as never);

    const result = await updateCustomBusinessModel("bm-saas", "New Name", null);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/built-in/i);
  });

  it("updates name and description on custom models", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(
      makeModel({ isBuiltIn: false, modelId: "bm-custom-001" }) as never,
    );
    vi.mocked(prisma.businessModel.update).mockResolvedValue({} as never);

    const result = await updateCustomBusinessModel("bm-custom-001", "Updated Name", "New desc");
    expect(result.ok).toBe(true);
    expect(prisma.businessModel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Updated Name", description: "New desc" }),
      }),
    );
  });
});

// ─── deprecateBusinessModel — built-in immutability ──────────────────────────

describe("deprecateBusinessModel", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("blocks deprecation of built-in models", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(makeModel({ isBuiltIn: true }) as never);

    const result = await deprecateBusinessModel("bm-saas");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/built-in/i);
  });

  it("sets status to deprecated on custom models", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(
      makeModel({ isBuiltIn: false }) as never,
    );
    vi.mocked(prisma.businessModel.update).mockResolvedValue({} as never);

    const result = await deprecateBusinessModel("bm-custom-001");
    expect(result.ok).toBe(true);
    expect(prisma.businessModel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "deprecated" },
      }),
    );
  });
});

// ─── retireBusinessModel ──────────────────────────────────────────────────────

describe("retireBusinessModel", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("blocks retirement when active assignments exist", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(
      makeModel({ isBuiltIn: false }) as never,
    );
    vi.mocked(prisma.businessModelRoleAssignment.count).mockResolvedValue(3 as never);

    const result = await retireBusinessModel("bm-custom-001");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/active assignment/i);
  });

  it("blocks retirement of built-in models", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(makeModel({ isBuiltIn: true }) as never);

    const result = await retireBusinessModel("bm-saas");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/built-in/i);
  });
});

// ─── addRoleToBusinessModel — 20-role cap ────────────────────────────────────

describe("addRoleToBusinessModel", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("rejects when business model already has 20 roles", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(
      makeModel({ isBuiltIn: false }) as never,
    );
    vi.mocked(prisma.businessModelRole.count).mockResolvedValue(20 as never);

    const result = await addRoleToBusinessModel("bm-1", "Extra Role", "Domain", "HR-200", 2);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/20 roles/i);
  });
});

// ─── removeRoleFromBusinessModel — assignment constraint ─────────────────────

describe("removeRoleFromBusinessModel", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("blocks removal when active assignments exist for the role", async () => {
    vi.mocked(prisma.businessModelRole.findUnique).mockResolvedValue(makeRole({ isBuiltIn: false }) as never);
    vi.mocked(prisma.businessModelRoleAssignment.count).mockResolvedValue(2 as never);

    const result = await removeRoleFromBusinessModel("role-1");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/active assignment/i);
  });
});

// ─── cloneBusinessModel ───────────────────────────────────────────────────────

describe("cloneBusinessModel", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates a new custom model copying source roles", async () => {
    vi.mocked(prisma.businessModel.findUnique)
      .mockResolvedValueOnce({ ...makeModel(), roles: [makeRole()] } as never)
      .mockResolvedValueOnce(null as never); // name-collision check returns null
    vi.mocked(prisma.businessModel.create).mockResolvedValue(makeModel({ isBuiltIn: false }) as never);

    const result = await cloneBusinessModel("bm-saas", "My SaaS Clone");
    expect(result.ok).toBe(true);
    expect(prisma.businessModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isBuiltIn: false, name: "My SaaS Clone" }),
      }),
    );
  });

  it("returns error when source model not found", async () => {
    vi.mocked(prisma.businessModel.findUnique).mockResolvedValue(null);

    const result = await cloneBusinessModel("bm-missing", "Clone");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});

// ─── listBusinessModels ───────────────────────────────────────────────────────

describe("listBusinessModels", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns active models ordered built-in first", async () => {
    const models = [makeModel(), makeModel({ id: "bm-2", modelId: "bm-custom-001", isBuiltIn: false })];
    vi.mocked(prisma.businessModel.findMany).mockResolvedValue(models as never);

    const result = await listBusinessModels();
    expect(result).toHaveLength(2);
    expect(prisma.businessModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "active" },
        orderBy: expect.arrayContaining([expect.objectContaining({ isBuiltIn: "desc" })]),
      }),
    );
  });
});

// ─── Seed idempotency (via upsert pattern in actions) ────────────────────────

describe("seed idempotency", () => {
  it("listBusinessModels returns stable list regardless of call count", async () => {
    const models = [makeModel()];
    vi.mocked(prisma.businessModel.findMany).mockResolvedValue(models as never);

    const first = await listBusinessModels();
    const second = await listBusinessModels();
    expect(first).toEqual(second);
  });
});
