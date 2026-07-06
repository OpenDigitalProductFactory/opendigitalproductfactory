import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@dpf/db";
import { MERGE_ADAPTERS, MergeValidationFailure, mergeRecords } from "./merge";

type DelegateMock = {
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
};

function makeTx(rows: Record<string, Record<string, unknown>>): Record<string, DelegateMock> {
  const tx: Record<string, DelegateMock> = {};
  const models = new Set<string>([
    "customerAccount",
    "customerSite",
    "contactAccountRole",
    ...MERGE_ADAPTERS["customer-account"].hardRelations.map((s) => s.model),
    ...MERGE_ADAPTERS["customer-account"].softReferences.map((s) => s.model),
    ...MERGE_ADAPTERS["customer-site"].hardRelations.map((s) => s.model),
    ...MERGE_ADAPTERS["customer-site"].softReferences.map((s) => s.model),
    ...MERGE_ADAPTERS["customer-contact"].hardRelations.map((s) => s.model),
    ...MERGE_ADAPTERS["customer-contact"].softReferences.map((s) => s.model),
  ]);
  for (const model of models) {
    tx[model] = {
      findUnique: vi.fn(async (args: { where: { id: string } }) => rows[args.where.id] ?? null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    };
  }
  return tx;
}

function wireTransaction(tx: Record<string, DelegateMock>) {
  vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(tx));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mergeRecords validation", () => {
  it("rejects merging a record into itself without opening a transaction", async () => {
    await expect(mergeRecords("customer-account", "a1", "a1")).rejects.toThrow(
      MergeValidationFailure,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects unknown records", async () => {
    const tx = makeTx({});
    wireTransaction(tx);
    await expect(mergeRecords("customer-account", "a1", "a2")).rejects.toThrow(/not-found/);
  });

  it("rejects an already-superseded participant", async () => {
    const tx = makeTx({
      a1: { id: "a1", status: "superseded" },
      a2: { id: "a2", status: "active" },
    });
    wireTransaction(tx);
    await expect(mergeRecords("customer-account", "a1", "a2")).rejects.toThrow(
      /already-superseded/,
    );
  });
});

describe("mergeRecords customer-account", () => {
  it("repoints every declared step, tombstones the loser, returns the audit result", async () => {
    const tx = makeTx({
      a1: { id: "a1", status: "prospect", name: "Emma 3D", parentAccountId: null },
      a2: { id: "a2", status: "prospect", name: "Emma3D", parentAccountId: null },
    });
    tx["customerContact"]!.updateMany.mockResolvedValue({ count: 2 });
    tx["masterDataSourceRef"]!.updateMany.mockResolvedValue({ count: 1 });
    wireTransaction(tx);

    const result = await mergeRecords("customer-account", "a1", "a2");

    // Every hard relation + soft reference got an updateMany against the loser.
    const adapter = MERGE_ADAPTERS["customer-account"];
    for (const step of [...adapter.hardRelations, ...adapter.softReferences]) {
      expect(
        tx[step.model]!.updateMany,
        `${step.model}.${step.field} was not repointed`,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ [step.field]: "a1" }),
          data: expect.objectContaining({ [step.field]: "a2" }),
        }),
      );
    }

    // Crosswalk CHECK constraint: canonicalId moves with the typed FK.
    expect(tx["masterDataSourceRef"]!.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ canonicalId: "a2", customerAccountId: "a2" }),
      }),
    );

    // Tombstone, never delete.
    expect(tx["customerAccount"]!.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { status: "superseded", mergedIntoId: "a2" },
    });

    expect(result.repointed["customerContact.accountId"]).toBe(2);
    expect(result.loserSnapshot["name"]).toBe("Emma 3D");
    expect(result.nestedSiteMerges).toEqual([]);
  });

  it("merges colliding-name loser sites into the survivor's site instead of repointing", async () => {
    const tx = makeTx({
      a1: { id: "a1", status: "active", parentAccountId: null },
      a2: { id: "a2", status: "active", parentAccountId: null },
    });
    tx["customerSite"]!.findMany.mockImplementation(
      async (args: { where: { accountId: string } }) =>
        args.where.accountId === "a1"
          ? [{ id: "s-loser", nameNormalized: "head office", status: "active" }]
          : [{ id: "s-survivor", nameNormalized: "head office" }],
    );
    wireTransaction(tx);

    const result = await mergeRecords("customer-account", "a1", "a2");

    expect(result.nestedSiteMerges).toEqual([
      { loserSiteId: "s-loser", survivorSiteId: "s-survivor", priorStatus: "active" },
    ]);
    // The colliding site was tombstoned into the survivor site.
    expect(tx["customerSite"]!.update).toHaveBeenCalledWith({
      where: { id: "s-loser" },
      data: { status: "superseded", mergedIntoId: "s-survivor" },
    });
    // Site children repointed to the surviving site.
    expect(tx["customerSiteNode"]!.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ siteId: "s-loser" }),
        data: expect.objectContaining({ siteId: "s-survivor" }),
      }),
    );
  });

  it("drops duplicate contact roles that would violate the role uniqueness", async () => {
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const tx = makeTx({
      a1: { id: "a1", status: "active", parentAccountId: null },
      a2: { id: "a2", status: "active", parentAccountId: null },
    });
    tx["contactAccountRole"]!.findMany.mockImplementation(
      async (args: { where: { accountId: string } }) =>
        args.where.accountId === "a1"
          ? [{ id: "r-dup", contactId: "c1", startedAt }]
          : [{ contactId: "c1", startedAt }],
    );
    tx["contactAccountRole"]!.deleteMany.mockResolvedValue({ count: 1 });
    wireTransaction(tx);

    const result = await mergeRecords("customer-account", "a1", "a2");

    expect(tx["contactAccountRole"]!.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["r-dup"] } },
    });
    expect(result.repointed["contactAccountRole.dropped-duplicates"]).toBe(1);
  });

  it("re-parents the survivor when its parent is the loser (no self-cycle)", async () => {
    const tx = makeTx({
      a1: { id: "a1", status: "active", parentAccountId: "root" },
      a2: { id: "a2", status: "active", parentAccountId: "a1" },
    });
    wireTransaction(tx);

    await mergeRecords("customer-account", "a1", "a2");

    expect(tx["customerAccount"]!.update).toHaveBeenCalledWith({
      where: { id: "a2" },
      data: { parentAccountId: "root" },
    });
    // The generic child-repoint step must not touch the loser row itself.
    expect(tx["customerAccount"]!.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ parentAccountId: "a1", id: { not: "a1" } }),
      }),
    );
  });
});

describe("mergeRecords customer-contact", () => {
  it("tombstones via isActive+mergedIntoId (no status), repoints identity relations", async () => {
    const tx = makeTx({
      c1: { id: "c1", mergedIntoId: null, isActive: true, email: "ian@old.com" },
      c2: { id: "c2", mergedIntoId: null, isActive: true, email: "ian@emma3d.co.uk" },
    });
    tx["socialIdentity"]!.updateMany.mockResolvedValue({ count: 1 });
    wireTransaction(tx);

    const result = await mergeRecords("customer-contact", "c1", "c2");

    expect(tx["customerContact"]!.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { isActive: false, mergedIntoId: "c2" },
    });
    expect(result.repointed["socialIdentity.contactId"]).toBe(1);
  });

  it("rejects an already-merged contact", async () => {
    const tx = makeTx({
      c1: { id: "c1", mergedIntoId: "c9", isActive: false },
      c2: { id: "c2", mergedIntoId: null, isActive: true },
    });
    wireTransaction(tx);
    await expect(mergeRecords("customer-contact", "c1", "c2")).rejects.toThrow(
      /already-superseded/,
    );
  });
});

describe("mergeRecords customer-site", () => {
  it("repoints site relations and tombstones the loser site", async () => {
    const tx = makeTx({
      s1: { id: "s1", status: "active" },
      s2: { id: "s2", status: "active" },
    });
    tx["edgeNode"]!.updateMany.mockResolvedValue({ count: 3 });
    wireTransaction(tx);

    const result = await mergeRecords("customer-site", "s1", "s2");

    expect(result.repointed["edgeNode.customerSiteId"]).toBe(3);
    expect(tx["customerSite"]!.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { status: "superseded", mergedIntoId: "s2" },
    });
  });
});
