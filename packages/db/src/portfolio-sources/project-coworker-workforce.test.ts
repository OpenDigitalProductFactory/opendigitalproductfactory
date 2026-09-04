import { describe, expect, it, vi } from "vitest";

import {
  coworkerProductId,
  projectCoworkerWorkforce,
} from "./project-coworker-workforce";
import { PORTFOLIO_PROJECTION_KEYS, PROJECTED_BY } from "./types";

type ProductRow = {
  id: string;
  productId: string;
  portfolioId: string | null;
  observationConfig: Record<string, unknown>;
  coverageStatus?: string;
  sourceKind?: string;
};

/**
 * Stateful fake that satisfies both the projectPortfolioEntries writer and the
 * coworker back-link surface. Mirrors the real Prisma behaviour closely enough to
 * exercise create/update, portfolio linking, and service linking.
 */
function makeDb(opts: {
  agents: unknown[];
  existingProducts?: ProductRow[];
  serviceLinkCounts?: Record<string, number>; // agentId -> rows updateMany will touch
  forEmployeesId?: string | null;
}) {
  const products = new Map<string, ProductRow>();
  for (const p of opts.existingProducts ?? []) products.set(p.productId, { ...p });

  const agentUpdates: Array<{ agentId: string; data: Record<string, unknown> }> = [];
  const serviceUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> =
    [];

  return {
    _products: products,
    _agentUpdates: agentUpdates,
    _serviceUpdates: serviceUpdates,
    portfolio: {
      findUnique: vi.fn(async () =>
        opts.forEmployeesId === null ? null : { id: opts.forEmployeesId ?? "port-fe" },
      ),
    },
    taxonomyNode: { findUnique: vi.fn(async () => null) },
    digitalProduct: {
      findUnique: vi.fn(async (args: { where: { productId: string } }) => {
        const row = products.get(args.where.productId);
        return row ? { id: row.id, observationConfig: row.observationConfig } : null;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const d = args.data;
        const row: ProductRow = {
          id: `dp-${d.productId as string}`,
          productId: d.productId as string,
          portfolioId: (d.portfolioId as string) ?? null,
          observationConfig: (d.observationConfig as Record<string, unknown>) ?? {},
          coverageStatus: d.coverageStatus as string,
          sourceKind: d.sourceKind as string,
        };
        products.set(row.productId, row);
        return row;
      }),
      update: vi.fn(async (args: { where: { productId: string }; data: Record<string, unknown> }) => {
        const row = products.get(args.where.productId)!;
        Object.assign(row, args.data);
        return row;
      }),
    },
    agent: {
      findMany: vi.fn(async () => opts.agents),
      update: vi.fn(async (args: { where: { agentId: string }; data: Record<string, unknown> }) => {
        agentUpdates.push({ agentId: args.where.agentId, data: args.data });
        return {};
      }),
    },
    coworkerService: {
      updateMany: vi.fn(
        async (args: { where: { providerAgentId: string }; data: Record<string, unknown> }) => {
          serviceUpdates.push(args);
          return { count: opts.serviceLinkCounts?.[args.where.providerAgentId] ?? 0 };
        },
      ),
    },
  };
}

const COWORKER = {
  agentId: "AGT-COO",
  displayName: "Chief of Staff",
  name: "coo",
  kind: "orchestrator",
  status: "active",
  valueStream: "evaluate",
  humanSupervisorId: "HR-000",
  portfolioId: null,
};

describe("projectCoworkerWorkforce (BI-8F9EDD6C)", () => {
  it("projects an active coworker as a for_employees DigitalProduct with parity/owner markers", async () => {
    const db = makeDb({ agents: [COWORKER], serviceLinkCounts: { "AGT-COO": 2 } });

    const result = await projectCoworkerWorkforce({ db: db as never });

    expect(result.coworkers).toBe(1);
    expect(result.created).toBe(1);

    const product = db._products.get(coworkerProductId("AGT-COO"))!;
    expect(product.portfolioId).toBe("port-fe");
    expect(product.coverageStatus).toBe("used");
    expect(product.sourceKind).toBe("coworker_service");
    // Projector-owned + parity/owner facts carried in observationConfig.
    expect(product.observationConfig[PORTFOLIO_PROJECTION_KEYS.projectedBy]).toBe(PROJECTED_BY);
    expect(product.observationConfig.agentId).toBe("AGT-COO");
    expect(product.observationConfig.humanRoleParity).toBe("HR-000");
    expect(product.observationConfig.approvalInterfaceOwnerRole).toBe("HR-000");
  });

  it("anchors Agent.portfolioId to for_employees only when unset, and links its services", async () => {
    const db = makeDb({ agents: [COWORKER], serviceLinkCounts: { "AGT-COO": 3 } });

    const result = await projectCoworkerWorkforce({ db: db as never });

    expect(result.agentsPortfolioLinked).toBe(1);
    expect(db._agentUpdates).toEqual([{ agentId: "AGT-COO", data: { portfolioId: "port-fe" } }]);

    expect(result.servicesLinked).toBe(3);
    expect(db._serviceUpdates[0]).toEqual({
      where: { providerAgentId: "AGT-COO", digitalProductId: null },
      data: { digitalProductId: coworkerProductId("AGT-COO") },
    });
  });

  it("does NOT move a coworker already assigned to a portfolio", async () => {
    const assigned = { ...COWORKER, portfolioId: "some-other-portfolio" };
    const db = makeDb({ agents: [assigned] });

    const result = await projectCoworkerWorkforce({ db: db as never });

    expect(result.agentsPortfolioLinked).toBe(0);
    expect(db._agentUpdates).toEqual([]);
  });

  it("is idempotent: a re-run updates the projector-owned product, does not duplicate", async () => {
    const existing: ProductRow = {
      id: "dp-coworker-AGT-COO",
      productId: coworkerProductId("AGT-COO"),
      portfolioId: "port-fe",
      observationConfig: { [PORTFOLIO_PROJECTION_KEYS.projectedBy]: PROJECTED_BY },
    };
    const db = makeDb({ agents: [COWORKER], existingProducts: [existing] });

    const result = await projectCoworkerWorkforce({ db: db as never });

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(db._products.size).toBe(1);
  });

  it("no-ops when there are no non-archived agents", async () => {
    const db = makeDb({ agents: [] });

    const result = await projectCoworkerWorkforce({ db: db as never });

    expect(result).toEqual({
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      coworkers: 0,
      agentsPortfolioLinked: 0,
      servicesLinked: 0,
    });
    expect(db.agent.update).not.toHaveBeenCalled();
  });

  it("marks an inactive coworker product as 'available' coverage", async () => {
    const inactive = { ...COWORKER, agentId: "AGT-IDLE", status: "inactive", portfolioId: "x" };
    const db = makeDb({ agents: [inactive] });

    await projectCoworkerWorkforce({ db: db as never });

    expect(db._products.get(coworkerProductId("AGT-IDLE"))!.coverageStatus).toBe("available");
  });
});

describe("dual-seed collapse (BI-74FD6420)", () => {
  it("mints ONE product for a coworker seeded under both its slug and its canonical id", async () => {
    // productId is keyed on agentId, so projecting both twins mints two
    // DigitalProducts with the same name for one peer — duplicate ROWS, which
    // then surface anywhere active products are listed (e.g. /knowledge/new).
    const db = makeDb({
      agents: [
        { ...COWORKER, agentId: "compliance-officer", displayName: "Compliance Officer" },
        { ...COWORKER, agentId: "AGT-WS-COMPLIANCE", displayName: "Compliance Officer" },
      ],
    });

    const result = await projectCoworkerWorkforce({ db: db as never });

    expect(result.coworkers).toBe(1);
  });

  it("keeps a canonical coworker that has no slug twin", async () => {
    const db = makeDb({
      agents: [{ ...COWORKER, agentId: "AGT-WS-COMPLIANCE", displayName: "Compliance Officer" }],
    });

    const result = await projectCoworkerWorkforce({ db: db as never });

    expect(result.coworkers).toBe(1);
  });

  it("keeps a slug coworker whose canonical twin is absent", async () => {
    const db = makeDb({
      agents: [{ ...COWORKER, agentId: "compliance-officer", displayName: "Compliance Officer" }],
    });

    const result = await projectCoworkerWorkforce({ db: db as never });

    expect(result.coworkers).toBe(1);
  });
});
