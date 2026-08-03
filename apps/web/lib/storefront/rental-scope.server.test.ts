import { describe, expect, it, vi } from "vitest";
import { resolveRentalStorefront, type RentalScopeDb } from "./rental-scope.server";

function db(configs: Array<{ id: string; organizationId: string; archetypeId: string }>): RentalScopeDb {
  return { storefrontConfig: { findMany: vi.fn(async () => configs) } };
}

describe("rental storefront scope", () => {
  it("resolves the only configured organization", async () => {
    await expect(resolveRentalStorefront(db([
      { id: "sf-1", organizationId: "org-1", archetypeId: "equipment-rental" },
    ]))).resolves.toEqual({ id: "sf-1", organizationId: "org-1", archetypeId: "equipment-rental" });
  });

  it("uses an explicit organization and refuses an unknown one", async () => {
    const source = db([
      { id: "sf-1", organizationId: "org-1", archetypeId: "equipment-rental" },
      { id: "sf-2", organizationId: "org-2", archetypeId: "self-storage" },
    ]);
    await expect(resolveRentalStorefront(source, "org-2")).resolves.toMatchObject({ id: "sf-2" });
    await expect(resolveRentalStorefront(source, "org-missing")).resolves.toBeNull();
  });

  it("fails closed when multiple organizations exist without an active organization", async () => {
    await expect(resolveRentalStorefront(db([
      { id: "sf-1", organizationId: "org-1", archetypeId: "equipment-rental" },
      { id: "sf-2", organizationId: "org-2", archetypeId: "self-storage" },
    ]))).rejects.toThrow(/multiple organizations/i);
  });
});
