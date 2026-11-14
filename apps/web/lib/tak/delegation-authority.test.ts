import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({
  prisma: { delegationChain: { create: vi.fn(), findMany: vi.fn() } },
}));

import { prisma } from "@dpf/db";

import { startChain } from "./delegation-authority";

const create = prisma.delegationChain.create as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "link-1", ...data }));
});

// BI-FD00E416: the first hop records the intersection of the origin's authority
// and what the delegated work needs, never the origin's whole authority.
describe("startChain authority intersection", () => {
  it("AC-1: delegating a skill that needs X from an origin holding {X, Y} records scope {X}", async () => {
    const result = await startChain("AGT-A", "AGT-B", "skill-x", "user-1", ["X", "Y"], ["X"]);

    expect(result.allowed).toBe(true);
    expect(result.propagatedAuthority).toEqual(["X"]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authorityScope: ["X"], originAuthority: ["X", "Y"], status: "active" }),
    }));
  });

  it("AC-2: a skill whose required capability the origin lacks is refused and records no authority", async () => {
    const result = await startChain("AGT-A", "AGT-B", "skill-z", "user-1", ["X", "Y"], ["Z"]);

    expect(result.allowed).toBe(false);
    expect(result.propagatedAuthority).toEqual([]);
    expect(result.reason).toBe("Authority insufficient: missing Z");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authorityScope: [], status: "blocked", reason: "Authority insufficient: missing Z" }),
    }));
  });

  it("an unscoped first hop (no required capabilities) still propagates no more than the origin holds", async () => {
    const result = await startChain("AGT-A", "AGT-B", null, "user-1", ["X", "Y"], []);

    expect(result.allowed).toBe(true);
    expect(result.propagatedAuthority).toEqual(["X", "Y"]);
  });

  it("refuses self-delegation before writing anything", async () => {
    const result = await startChain("AGT-A", "AGT-A", null, "user-1", ["X"], []);

    expect(result.allowed).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
