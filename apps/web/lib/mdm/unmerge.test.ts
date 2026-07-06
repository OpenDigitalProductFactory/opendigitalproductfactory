import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    customerAccount: { findUnique: vi.fn() },
    activity: { findMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { UnmergeValidationFailure, unmergeRecords, type MergeResult } from "./merge";

type DelegateMock = {
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
};

function makeTx(): Record<string, DelegateMock> {
  return new Proxy(
    {} as Record<string, DelegateMock>,
    {
      get(target, prop: string) {
        target[prop] ??= {
          update: vi.fn(async () => ({})),
          updateMany: vi.fn(async () => ({ count: 1 })),
        };
        return target[prop];
      },
    },
  );
}

function lineage(overrides: Partial<MergeResult> = {}): MergeResult {
  return {
    domain: "customer-account",
    loserId: "a1",
    survivorId: "a2",
    repointed: { "customerContact.accountId": 2 },
    repointedIds: { "customerContact.accountId": ["c1", "c2"] },
    repointedIdsTruncated: [],
    nestedSiteMerges: [],
    loserSnapshot: { id: "a1", status: "prospect", name: "Emma 3D" },
    survivorship: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("unmergeRecords", () => {
  it("rejects a non-tombstone account", async () => {
    vi.mocked(prisma.customerAccount.findUnique).mockResolvedValue({
      id: "a1",
      status: "active",
      mergedIntoId: null,
    } as never);
    await expect(unmergeRecords("a1")).rejects.toThrow(UnmergeValidationFailure);
  });

  it("rejects when no merge audit exists", async () => {
    vi.mocked(prisma.customerAccount.findUnique).mockResolvedValue({
      id: "a1",
      status: "superseded",
      mergedIntoId: "a2",
    } as never);
    vi.mocked(prisma.activity.findMany).mockResolvedValue([] as never);
    await expect(unmergeRecords("a1")).rejects.toThrow(/no-audit/);
  });

  it("rejects when the lineage was truncated (lossy)", async () => {
    vi.mocked(prisma.customerAccount.findUnique).mockResolvedValue({
      id: "a1",
      status: "superseded",
      mergedIntoId: "a2",
    } as never);
    vi.mocked(prisma.activity.findMany).mockResolvedValue([
      { id: "act1", body: JSON.stringify(lineage({ repointedIdsTruncated: ["customerContact.accountId"] })) },
    ] as never);
    await expect(unmergeRecords("a1")).rejects.toThrow(/lossy-lineage/);
  });

  it("restores the loser, moves back exactly the recorded rows, restores nested sites", async () => {
    vi.mocked(prisma.customerAccount.findUnique).mockResolvedValue({
      id: "a1",
      status: "superseded",
      mergedIntoId: "a2",
    } as never);
    vi.mocked(prisma.activity.findMany).mockResolvedValue([
      { id: "act-other", body: "not json" },
      {
        id: "act1",
        body: JSON.stringify(
          lineage({
            repointedIds: {
              "customerContact.accountId": ["c1", "c2"],
              "masterDataSourceRef.customerAccountId": ["ref1"],
              "site:s-loser:customerSiteNode.siteId": ["n1"],
            },
            nestedSiteMerges: [{ loserSiteId: "s-loser", survivorSiteId: "s-surv", priorStatus: "planned" }],
          }),
        ),
      },
    ] as never);
    const tx = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

    const result = await unmergeRecords("a1");

    // Loser un-tombstoned to its snapshot status.
    expect(tx["customerAccount"]!.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { status: "prospect", mergedIntoId: null },
    });
    // Only the recorded ids move back — not a blanket repoint.
    expect(tx["customerContact"]!.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2"] } },
      data: { accountId: "a1" },
    });
    // Crosswalk CHECK constraint respected on the way back too.
    expect(tx["masterDataSourceRef"]!.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["ref1"] } },
      data: { customerAccountId: "a1", canonicalId: "a1" },
    });
    // Nested-site step rows return to the restored site.
    expect(tx["customerSiteNode"]!.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["n1"] } },
      data: { siteId: "s-loser" },
    });
    // Nested-merged site restored to its prior status.
    expect(tx["customerSite"]!.update).toHaveBeenCalledWith({
      where: { id: "s-loser" },
      data: { status: "planned", mergedIntoId: null },
    });
    expect(result.restoredStatus).toBe("prospect");
    expect(result.survivorId).toBe("a2");
  });
});
