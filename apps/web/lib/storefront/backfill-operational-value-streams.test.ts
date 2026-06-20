import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  storefrontConfigFindMany: vi.fn(),
  eaViewFindFirst: vi.fn(),
  storefrontArchetypeFindUnique: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: {
      findMany: (...args: unknown[]) => prismaMock.storefrontConfigFindMany(...args),
    },
    eaView: {
      findFirst: (...args: unknown[]) => prismaMock.eaViewFindFirst(...args),
    },
    storefrontArchetype: {
      findUnique: (...args: unknown[]) => prismaMock.storefrontArchetypeFindUnique(...args),
    },
  },
}));

const projectMock = vi.hoisted(() => vi.fn());
vi.mock("./project-operational-value-stream", () => ({
  projectOperationalValueStreamForArchetype: (...args: unknown[]) => projectMock(...args),
}));

import { backfillOperationalValueStreamsOnBoot } from "./backfill-operational-value-streams";

const silent = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.storefrontConfigFindMany.mockResolvedValue([]);
  prismaMock.eaViewFindFirst.mockResolvedValue(null);
  prismaMock.storefrontArchetypeFindUnique.mockResolvedValue(null);
  projectMock.mockResolvedValue({ viewId: "view-1", createdElements: 9 });
});

describe("backfillOperationalValueStreamsOnBoot", () => {
  it("projects the OVSM for a storefront missing its value-stream view, using the resolved slug", async () => {
    prismaMock.storefrontConfigFindMany.mockResolvedValue([
      { organizationId: "org-1", archetypeId: "cuid-1" },
    ]);
    prismaMock.eaViewFindFirst.mockResolvedValue(null); // no existing view
    prismaMock.storefrontArchetypeFindUnique.mockResolvedValue({ archetypeId: "software-platform" });

    const res = await backfillOperationalValueStreamsOnBoot(silent);

    expect(res).toEqual({ created: 1, present: 0, skipped: 0 });
    // Resolved the DB id -> stable slug before projecting (the projection keys on slug).
    expect(projectMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      archetypeId: "software-platform",
    });
    // Existence check used the canonical scope (scopeType + `${orgId}:operational`).
    expect(prismaMock.eaViewFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scopeType: "archetype_value_stream", scopeRef: "org-1:operational" },
      }),
    );
  });

  it("skips a storefront that already has its operational value-stream view", async () => {
    prismaMock.storefrontConfigFindMany.mockResolvedValue([
      { organizationId: "org-1", archetypeId: "cuid-1" },
    ]);
    prismaMock.eaViewFindFirst.mockResolvedValue({ id: "view-existing" });

    const res = await backfillOperationalValueStreamsOnBoot(silent);

    expect(res).toEqual({ created: 0, present: 1, skipped: 0 });
    expect(projectMock).not.toHaveBeenCalled();
    expect(prismaMock.storefrontArchetypeFindUnique).not.toHaveBeenCalled();
  });

  it("skips (does not crash) when the archetype row cannot be resolved", async () => {
    prismaMock.storefrontConfigFindMany.mockResolvedValue([
      { organizationId: "org-1", archetypeId: "cuid-missing" },
    ]);
    prismaMock.eaViewFindFirst.mockResolvedValue(null);
    prismaMock.storefrontArchetypeFindUnique.mockResolvedValue(null);

    const res = await backfillOperationalValueStreamsOnBoot(silent);

    expect(res).toEqual({ created: 0, present: 0, skipped: 1 });
    expect(projectMock).not.toHaveBeenCalled();
  });

  it("is non-fatal per org: a projection error (no template / unseeded EA) is logged and skipped", async () => {
    prismaMock.storefrontConfigFindMany.mockResolvedValue([
      { organizationId: "org-1", archetypeId: "cuid-1" },
      { organizationId: "org-2", archetypeId: "cuid-2" },
    ]);
    prismaMock.eaViewFindFirst.mockResolvedValue(null);
    prismaMock.storefrontArchetypeFindUnique
      .mockResolvedValueOnce({ archetypeId: "no-template-archetype" })
      .mockResolvedValueOnce({ archetypeId: "software-platform" });
    projectMock
      .mockRejectedValueOnce(new Error("Template archetype no-template-archetype not found in ALL_ARCHETYPES"))
      .mockResolvedValueOnce({ viewId: "view-2", createdElements: 9 });

    const res = await backfillOperationalValueStreamsOnBoot(silent);

    // org-1 skipped on the throw, org-2 still processed.
    expect(res).toEqual({ created: 1, present: 0, skipped: 1 });
  });

  it("is non-fatal overall: returns null when the top-level query throws", async () => {
    prismaMock.storefrontConfigFindMany.mockRejectedValue(new Error("db down"));
    const res = await backfillOperationalValueStreamsOnBoot(silent);
    expect(res).toBeNull();
  });
});
