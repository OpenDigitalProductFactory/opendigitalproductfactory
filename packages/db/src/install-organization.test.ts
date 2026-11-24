import { describe, expect, it } from "vitest";

import {
  findInstallOrganization,
  getInstallOrganization,
  InstallOrganizationAmbiguousError,
  InstallOrganizationMissingError,
} from "./install-organization";

// BI-EE2F38D5: the install is the tenant (W18). An unfiltered findFirst picked
// an arbitrary row when a second organization existed; the helper refuses.

type Row = { id: string; name: string; createdAt: Date };

function fakeDb(rows: Row[]) {
  const calls: unknown[] = [];
  const db = {
    organization: {
      findMany: async (args: { select: Record<string, boolean>; take: number }) => {
        calls.push(args);
        return [...rows]
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, args.take)
          .map((r) => Object.fromEntries(Object.keys(args.select).map((k) => [k, r[k as keyof Row]])));
      },
    },
  };
  return { db: db as never, calls };
}

const org = (id: string, iso: string): Row => ({ id, name: `Org ${id}`, createdAt: new Date(iso) });

describe("getInstallOrganization", () => {
  it("returns the one organization with the requested fields", async () => {
    const { db, calls } = fakeDb([org("org-1", "2026-01-01")]);
    await expect(getInstallOrganization(db, { id: true, name: true })).resolves.toEqual({ id: "org-1", name: "Org org-1" });
    expect(calls).toEqual([{ select: { id: true, name: true }, orderBy: { createdAt: "asc" }, take: 2 }]);
  });

  it("refuses an install with no organization", async () => {
    const { db } = fakeDb([]);
    await expect(getInstallOrganization(db, { id: true })).rejects.toBeInstanceOf(InstallOrganizationMissingError);
  });

  it("refuses an install with two organizations instead of picking one", async () => {
    const { db } = fakeDb([org("org-1", "2026-01-01"), org("org-2", "2026-02-01")]);
    await expect(getInstallOrganization(db, { id: true })).rejects.toBeInstanceOf(InstallOrganizationAmbiguousError);
  });
});

describe("findInstallOrganization", () => {
  it("returns null before setup has created the organization", async () => {
    const { db } = fakeDb([]);
    await expect(findInstallOrganization(db, { id: true })).resolves.toBeNull();
  });

  it("still refuses two organizations", async () => {
    const { db } = fakeDb([org("org-1", "2026-01-01"), org("org-2", "2026-02-01")]);
    await expect(findInstallOrganization(db, { id: true })).rejects.toMatchObject({ code: "install_organization_ambiguous" });
  });
});
