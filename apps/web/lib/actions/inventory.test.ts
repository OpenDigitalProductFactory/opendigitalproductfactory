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
    inventoryEntity: {
      update: vi.fn(),
    },
    taxonomyNode: {
      findUnique: vi.fn(),
    },
    portfolio: {
      findUnique: vi.fn(),
    },
  },
  promoteInventoryEntities: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { prisma, promoteInventoryEntities } from "@dpf/db";
import { acceptAttribution, reassignTaxonomy, dismissEntity } from "./inventory";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCan = can as ReturnType<typeof vi.fn>;
const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;
const mockPromoteInventoryEntities = promoteInventoryEntities as ReturnType<typeof vi.fn>;
const mockInventoryEntityUpdate = prisma.inventoryEntity.update as ReturnType<typeof vi.fn>;
const mockTaxonomyNodeFindUnique = prisma.taxonomyNode.findUnique as ReturnType<typeof vi.fn>;
const mockPortfolioFindUnique = prisma.portfolio.findUnique as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("inventory actions", () => {
  it("denies attribution changes when the user lacks discovery management rights", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-300", isSuperuser: false },
    });
    mockCan.mockReturnValue(false);

    await expect(acceptAttribution("entity-1")).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
  });

  it("revalidates discovery surfaces after accepting attribution", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockInventoryEntityUpdate.mockResolvedValue({});
    mockPromoteInventoryEntities.mockResolvedValue({});

    await expect(acceptAttribution("entity-1")).resolves.toEqual({ ok: true });

    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools/discovery");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/inventory");
  });

  it("revalidates discovery surfaces after manual taxonomy reassignment", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockTaxonomyNodeFindUnique.mockResolvedValue({ id: "tax-1", nodeId: "foundational/network/wifi" });
    mockPortfolioFindUnique.mockResolvedValue({ id: "portfolio-1" });
    mockInventoryEntityUpdate.mockResolvedValue({});
    mockPromoteInventoryEntities.mockResolvedValue({});

    await expect(reassignTaxonomy("entity-1", "tax-1")).resolves.toEqual({ ok: true });

    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools/discovery");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/inventory");
  });

  it("revalidates discovery surfaces after dismissing an entity", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockInventoryEntityUpdate.mockResolvedValue({});

    await expect(dismissEntity("entity-1")).resolves.toEqual({ ok: true });

    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools/discovery");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/inventory");
  });
});
