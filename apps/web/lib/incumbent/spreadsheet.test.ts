import { beforeEach, describe, expect, it, vi } from "vitest";
import { importIncumbentRows, mapRowToIncumbentInput } from "./spreadsheet";
import { createIncumbentApplication } from "./intake";

// D2 P2 spreadsheet-import tests (BI-BF12C25C). The P1 core is mocked so these
// exercise the mapping + orchestration (created/matched/skipped/errors) without
// a live Prisma client — source-only-worktree verifiable.

vi.mock("./intake", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./intake")>();
  return { ...actual, createIncumbentApplication: vi.fn() };
});

const mockedCreate = vi.mocked(createIncumbentApplication);

describe("mapRowToIncumbentInput", () => {
  it("resolves name/vendor/cost/seats from headered columns", () => {
    const input = mapRowToIncumbentInput({
      Application: "Mindbody",
      Vendor: "Mindbody Inc",
      "Annual Cost": "$4,800",
      Seats: 12,
    });
    expect(input).toEqual({
      name: "Mindbody",
      vendor: "Mindbody Inc",
      annualCostDeclared: 4800,
      seatCount: 12,
    });
  });

  it("returns null when no name column resolves", () => {
    expect(mapRowToIncumbentInput({ Notes: "n/a", Cost: 10 })).toBeNull();
    expect(mapRowToIncumbentInput({ Software: "   " })).toBeNull();
  });

  it("tolerates missing optional columns", () => {
    expect(mapRowToIncumbentInput({ "Tool Name": "QuickBooks" })).toEqual({
      name: "QuickBooks",
      vendor: undefined,
      annualCostDeclared: undefined,
      seatCount: undefined,
    });
  });
});

describe("importIncumbentRows", () => {
  beforeEach(() => mockedCreate.mockReset());

  it("counts created vs matched and collects productIds", async () => {
    mockedCreate
      .mockResolvedValueOnce({ productId: "DP-incumbent-toast", matched: false, supplierId: "s1" })
      .mockResolvedValueOnce({ productId: "DP-incumbent-toast", matched: true, supplierId: "s1" });
    const db = {} as never;
    const result = await importIncumbentRows(db, [
      { Application: "Toast" },
      { Application: "Toast" }, // re-import → matched
    ]);
    expect(result.created).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.productIds).toEqual(["DP-incumbent-toast", "DP-incumbent-toast"]);
    expect(result.errors).toEqual([]);
  });

  it("skips rows with no name without calling the core", async () => {
    const db = {} as never;
    const result = await importIncumbentRows(db, [{ Notes: "x" }, { Application: "Xero" }]);
    mockedCreate.mockResolvedValue({ productId: "DP-incumbent-xero", matched: false, supplierId: null });
    expect(result.skipped).toBe(1);
    // only the named row reached the core
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("reports a failing row as an error and continues (never fatal)", async () => {
    mockedCreate
      .mockRejectedValueOnce(new Error("supplier write failed"))
      .mockResolvedValueOnce({ productId: "DP-incumbent-clio", matched: false, supplierId: "s2" });
    const db = {} as never;
    const result = await importIncumbentRows(db, [
      { Application: "Broken" },
      { Application: "Clio" },
    ]);
    expect(result.errors).toEqual([{ row: 1, message: "supplier write failed" }]);
    expect(result.created).toBe(1);
    expect(result.productIds).toEqual(["DP-incumbent-clio"]);
  });
});
