import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

import { prisma } from "@dpf/db";
import { scanCustomerAccountDuplicates, scanCustomerContactDuplicates } from "./batch-scan";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scanCustomerAccountDuplicates", () => {
  it("returns scored pairs strongest-first, keeping name-only weak matches (surface over miss)", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      // Name-only fuzzy pair — the Emma3D shape.
      {
        a_id: "a1", a_name: "Emma 3D", a_status: "prospect", a_website: null,
        b_id: "a2", b_name: "Emma3D", b_status: "active", b_website: null,
      },
      // Exact-name + same-domain pair — strongest.
      {
        a_id: "a3", a_name: "Managing Digital", a_status: "active", a_website: "https://managingdigital.com",
        b_id: "a4", b_name: "Managing Digital Ltd", b_status: "prospect", b_website: "managingdigital.com",
      },
    ] as never);

    const pairs = await scanCustomerAccountDuplicates();

    expect(pairs).toHaveLength(2);
    // Strongest first: the name+domain pair outranks name-only.
    expect(pairs[0]!.a.id).toBe("a3");
    expect(pairs[0]!.recommendation).toBe("likely-duplicate");
    // The weak name-only pair still surfaces as possible.
    expect(pairs[1]!.a.id).toBe("a1");
    expect(pairs[1]!.recommendation).toBe("possible-duplicate");
  });

  it("drops pairs with no scoring signal at all", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        a_id: "a1", a_name: "Alpha Corp", a_status: "active", a_website: null,
        b_id: "a2", b_name: "Zeta Industrial", b_status: "active", b_website: null,
      },
    ] as never);
    const pairs = await scanCustomerAccountDuplicates();
    expect(pairs).toEqual([]);
  });
});

describe("scanCustomerContactDuplicates", () => {
  it("surfaces same-account same-name contacts under different emails", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        a_id: "c1", a_email: "ian@emma3d.co.uk", a_name: "Ian Wright",
        b_id: "c2", b_email: "ian.wright@gmail.com", b_name: "Ian Wright",
        account_id: "a1",
      },
    ] as never);
    const pairs = await scanCustomerContactDuplicates();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.a.label).toBe("Ian Wright");
    expect(["possible-duplicate", "likely-duplicate"]).toContain(pairs[0]!.recommendation);
  });
});
