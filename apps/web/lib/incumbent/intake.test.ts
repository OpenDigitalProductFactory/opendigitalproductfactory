import { describe, expect, it, vi } from "vitest";
import {
  INCUMBENT_COVERAGE_STATUS,
  INCUMBENT_SOURCE_KIND,
  createIncumbentApplication,
  incumbentProductId,
} from "./intake";

// D2 P1 intake core tests (BI-BF12C25C). PrismaClient is injected, so a mock
// stands in — runs in the source-only worktree without a live client.

type DpRow = { id: string; productId?: string } | null;

function makeDb(opts: {
  portfolio?: { id: string } | null;
  supplier?: { id: string; supplierId: string } | null;
  existingProduct?: DpRow;
}) {
  const digitalProductCreate = vi.fn().mockResolvedValue({ id: "dp1" });
  const digitalProductUpdate = vi.fn().mockResolvedValue({ id: "dp1" });
  const supplierCreate = vi
    .fn()
    .mockImplementation(async (args: { data: { supplierId: string } }) => ({
      supplierId: args.data.supplierId,
    }));
  const db = {
    portfolio: {
      findFirst: vi.fn().mockResolvedValue(
        opts.portfolio === undefined ? { id: "port-for-employees" } : opts.portfolio,
      ),
    },
    supplier: {
      findFirst: vi.fn().mockResolvedValue(opts.supplier ?? null),
      create: supplierCreate,
    },
    digitalProduct: {
      findUnique: vi.fn().mockResolvedValue(opts.existingProduct ?? null),
      create: digitalProductCreate,
      update: digitalProductUpdate,
    },
  };
  return { db, digitalProductCreate, digitalProductUpdate, supplierCreate };
}

describe("createIncumbentApplication", () => {
  it("creates a new incumbent DigitalProduct with the closed enum tags", async () => {
    const { db, digitalProductCreate } = makeDb({});
    const result = await createIncumbentApplication(db as never, {
      name: "Mindbody",
      vendor: "Mindbody Inc",
      annualCostDeclared: 4800,
      seatCount: 12,
    });

    expect(result).toEqual({
      productId: "DP-incumbent-mindbody",
      matched: false,
      supplierId: "SUP-incumbent-mindbody-inc",
    });
    const data = digitalProductCreate.mock.calls[0]![0].data;
    expect(data.coverageStatus).toBe(INCUMBENT_COVERAGE_STATUS);
    expect(data.sourceKind).toBe(INCUMBENT_SOURCE_KIND);
    expect(data.portfolioId).toBe("port-for-employees");
    expect(data.productId).toBe("DP-incumbent-mindbody");
  });

  it("records declared cost as declared, never derived (spec R5)", async () => {
    const { db, digitalProductCreate } = makeDb({});
    await createIncumbentApplication(db as never, { name: "Toast", annualCostDeclared: 9000 });
    const cfg = digitalProductCreate.mock.calls[0]![0].data.observationConfig;
    expect(cfg.declaredAnnualCost).toBe(9000);
    expect(cfg.costBasis).toBe("declared");
  });

  it("never claims projectedBy (must not be clobbered by a projector re-run)", async () => {
    const { db, digitalProductCreate } = makeDb({});
    await createIncumbentApplication(db as never, { name: "QuickBooks" });
    const cfg = digitalProductCreate.mock.calls[0]![0].data.observationConfig;
    expect(cfg).not.toHaveProperty("projectedBy");
  });

  it("matches an existing incumbent by productId instead of duplicating", async () => {
    const { db, digitalProductCreate, digitalProductUpdate } = makeDb({
      existingProduct: { id: "dp-existing" },
    });
    const result = await createIncumbentApplication(db as never, { name: "Mindbody" });
    expect(result.matched).toBe(true);
    expect(digitalProductCreate).not.toHaveBeenCalled();
    expect(digitalProductUpdate).toHaveBeenCalledOnce();
  });

  it("reuses an existing supplier rather than creating a duplicate", async () => {
    const { db, supplierCreate } = makeDb({
      supplier: { id: "s1", supplierId: "SUP-existing" },
    });
    const result = await createIncumbentApplication(db as never, { name: "Xero", vendor: "Xero" });
    expect(result.supplierId).toBe("SUP-existing");
    expect(supplierCreate).not.toHaveBeenCalled();
  });

  it("derives a stable, deterministic productId", () => {
    expect(incumbentProductId("Mindbody")).toBe("DP-incumbent-mindbody");
    expect(incumbentProductId("  Square Retail  ")).toBe("DP-incumbent-square-retail");
  });

  it("rejects an empty name", async () => {
    const { db } = makeDb({});
    await expect(createIncumbentApplication(db as never, { name: "   " })).rejects.toThrow(
      /non-empty name/,
    );
  });

  it("throws when the for_employees portfolio is missing", async () => {
    const { db } = makeDb({ portfolio: null });
    await expect(createIncumbentApplication(db as never, { name: "Toast" })).rejects.toThrow(
      /for_employees/,
    );
  });
});
