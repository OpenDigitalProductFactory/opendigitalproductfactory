import { beforeEach, describe, expect, it, vi } from "vitest";

import registry from "../../../../../packages/db/data/agent_registry.json";

const mocks = vi.hoisted(() => ({
  billFindMany: vi.fn(),
  billCount: vi.fn(),
  billGroupBy: vi.fn(),
  contractFindMany: vi.fn(),
  contractCount: vi.fn(),
  writeAttempts: [] as string[],
}));

// Advise-safety: the handlers only ever get reads. Any other method on any
// model is recorded as a write attempt and throws.
vi.mock("@dpf/db", () => {
  const readOnly = (model: string, reads: Record<string, unknown>) =>
    new Proxy(reads, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        return () => {
          mocks.writeAttempts.push(`${model}.${prop}`);
          throw new Error(`write attempted: ${model}.${prop}`);
        };
      },
    });
  return {
    prisma: new Proxy(
      {},
      {
        get(_t, model: string) {
          if (model === "bill") {
            return readOnly(model, {
              findMany: (...a: unknown[]) => mocks.billFindMany(...a),
              count: (...a: unknown[]) => mocks.billCount(...a),
              groupBy: (...a: unknown[]) => mocks.billGroupBy(...a),
            });
          }
          if (model === "supplierContract") {
            return readOnly(model, {
              findMany: (...a: unknown[]) => mocks.contractFindMany(...a),
              count: (...a: unknown[]) => mocks.contractCount(...a),
            });
          }
          return readOnly(model, {});
        },
      },
    ),
  };
});

import { HARDCODED_COWORKER_GRANTS } from "@dpf/db/workforce-seed";
import { COWORKER_READ_BASELINE_GRANTS, isToolAllowedByGrants, TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import { payablesPack } from "./payables-pack";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const GRANT = "payables_read";
const money = (n: number) => ({ toString: () => n.toFixed(2) });

function bill(ref: string, dueDate: string, status = "approved", extra: Record<string, unknown> = {}) {
  return {
    billRef: ref,
    status,
    invoiceRef: null,
    issueDate: new Date("2026-09-01T00:00:00.000Z"),
    dueDate: new Date(dueDate),
    currency: "USD",
    totalAmount: money(100),
    amountDue: money(100),
    supplierContractId: null,
    supplier: { name: "Acme Hosting" },
    ...extra,
  };
}

function contract(id: string, extra: Record<string, unknown> = {}) {
  return {
    id: `row-${id}`,
    contractId: id,
    status: "active",
    contractType: "subscription",
    commitmentKind: "saas_subscription",
    billingCadence: "monthly",
    billingDayOfMonth: null,
    currency: "USD",
    monthlyCommittedAmount: null,
    budgetAmount: null,
    startDate: null,
    endDate: null,
    renewalDate: null,
    supplier: { name: "Acme Hosting", status: "active" },
    ...extra,
  };
}

const call = (tool: string, params: Record<string, unknown> = {}) => payablesPack.handlers[tool]!(params, "user_test");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAttempts.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.billGroupBy.mockResolvedValue([]);
  mocks.contractFindMany.mockResolvedValue([]);
  mocks.contractCount.mockResolvedValue(0);
});

describe("payables pack — registration and grants", () => {
  it("registers two read-only tools with handlers", () => {
    expect(payablesPack.definitions.map((d) => d.name).sort()).toEqual(["list_bills", "list_supplier_contracts"]);
    for (const def of payablesPack.definitions) {
      expect(def.sideEffect, def.name).toBe(false);
      expect(def.annotations?.readOnlyHint, def.name).toBe(true);
      expect(def.annotations?.destructiveHint, def.name).toBe(false);
      expect(def.consequence, def.name).toBeUndefined();
      expect(def.requiredCapability, def.name).toBe("view_finance");
      expect(payablesPack.handlers[def.name], def.name).toBeTypeOf("function");
      expect(def.description, def.name).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("gates both tools on payables_read and mirrors the shared grant map", () => {
    for (const name of ["list_bills", "list_supplier_contracts"]) {
      expect(payablesPack.grants[name], name).toEqual([GRANT]);
      expect(TOOL_TO_GRANTS[name], name).toEqual([GRANT]);
      expect(isToolAllowedByGrants(name, [GRANT]), name).toBe(true);
      expect(isToolAllowedByGrants(name, [...COWORKER_READ_BASELINE_GRANTS]), name).toBe(false);
      expect(isToolAllowedByGrants(name, ["banking_read", "financial_read"]), name).toBe(false);
    }
  });

  it("is held only by the finance controller, in both grant sources", () => {
    const seedHolders = Object.entries(HARDCODED_COWORKER_GRANTS)
      .filter(([, grants]) => grants.includes(GRANT))
      .map(([slug]) => slug);
    expect(seedHolders).toEqual(["finance-controller"]);
    const registryHolders = (registry as { agents: Array<{ agent_name?: string; config_profile?: { tool_grants?: string[] } }> }).agents
      .filter((a) => a.config_profile?.tool_grants?.includes(GRANT))
      .map((a) => a.agent_name);
    expect(registryHolders).toEqual(["finance-controller"]);
  });
});

describe("list_bills", () => {
  it("returns { items: [], note: 'No bills are recorded.' } when no bill exists, so a stage records inconclusive", async () => {
    mocks.billCount.mockResolvedValue(0);
    mocks.billFindMany.mockResolvedValue([]);

    const res = await call("list_bills");

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ items: [], note: "No bills are recorded." });
    expect(res.message).toContain("No bills are recorded.");
    expect(mocks.writeAttempts).toEqual([]);
  });

  it("defaults to open bills (not paid, not void), earliest due first, and marks overdue", async () => {
    mocks.billCount.mockResolvedValue(2);
    mocks.billFindMany.mockResolvedValue([bill("B-1", "2026-09-20T00:00:00.000Z"), bill("B-2", "2026-10-10T00:00:00.000Z", "awaiting_approval")]);

    const res = await call("list_bills");

    const args = mocks.billFindMany.mock.calls[0]![0] as { where: Record<string, any>; orderBy: unknown; take: number };
    expect(args.where.status).toEqual({ notIn: ["paid", "void"] });
    expect(args.orderBy).toEqual({ dueDate: "asc" });
    expect(args.take).toBe(20);
    const data = res.data as { items: Array<Record<string, unknown>> };
    expect(data.items).toEqual([
      expect.objectContaining({ billRef: "B-1", supplier: "Acme Hosting", overdue: true, amountDue: "100.00", dueDate: "2026-09-20T00:00:00.000Z" }),
      expect.objectContaining({ billRef: "B-2", overdue: false, status: "awaiting_approval" }),
    ]);
  });

  it("filters to a due horizon (overdue included) and a specific status, and caps the limit", async () => {
    mocks.billCount.mockResolvedValue(5);
    mocks.billFindMany.mockResolvedValue([]);

    await call("list_bills", { dueWithinDays: 30, status: "approved", limit: 900 });

    const args = mocks.billFindMany.mock.calls[0]![0] as { where: Record<string, any>; take: number };
    expect(args.where.status).toBe("approved");
    expect(args.where.dueDate).toEqual({ lte: new Date("2026-10-31T12:00:00.000Z") });
    expect(args.take).toBe(50);
  });

  it("names the filter when bills exist but none match, distinct from none recorded", async () => {
    mocks.billCount.mockResolvedValue(3);
    mocks.billFindMany.mockResolvedValue([]);

    const res = await call("list_bills", { dueWithinDays: 7 });

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ items: [], totalRecorded: 3 });
    expect((res.data as { note: string }).note).toMatch(/No open bills fall due within 7 day/);
  });

  it("refuses an unknown status", async () => {
    expect((await call("list_bills", { status: "settled" })).success).toBe(false);
  });

  it("lists recurring supplier commitments and names those with no committed amount as unknown", async () => {
    mocks.billCount.mockResolvedValue(0);
    mocks.billFindMany.mockResolvedValue([]);
    mocks.contractFindMany.mockResolvedValue([
      contract("C-1", { monthlyCommittedAmount: money(49), billingDayOfMonth: 3 }),
      contract("C-2"),
    ]);

    const data = (await call("list_bills")).data as { recurringCommitments: Array<Record<string, unknown>> };

    expect(data.recurringCommitments).toEqual([
      expect.objectContaining({ contractId: "C-1", supplier: "Acme Hosting", committedAmount: "49.00", billingCadence: "monthly", billingDayOfMonth: 3 }),
      expect.objectContaining({ contractId: "C-2", committedAmount: null, unknowns: ["committed amount not recorded"] }),
    ]);
  });
});

describe("list_supplier_contracts", () => {
  it("returns an explicit empty result when no supplier agreement is recorded", async () => {
    mocks.contractCount.mockResolvedValue(0);
    mocks.contractFindMany.mockResolvedValue([]);

    const res = await call("list_supplier_contracts");

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ items: [], note: "No supplier contracts are recorded." });
    expect(mocks.writeAttempts).toEqual([]);
  });

  it("returns supplier, terms, renewal, value, status and billed-to-date, naming unknowns", async () => {
    mocks.contractCount.mockResolvedValue(2);
    mocks.contractFindMany.mockResolvedValue([
      contract("C-1", {
        renewalDate: new Date("2026-11-01T00:00:00.000Z"),
        startDate: new Date("2025-11-01T00:00:00.000Z"),
        monthlyCommittedAmount: money(49),
      }),
      contract("C-2", { status: "draft" }),
    ]);
    mocks.billGroupBy.mockResolvedValue([{ supplierContractId: "row-C-1", _sum: { totalAmount: money(490) } }]);

    const data = (await call("list_supplier_contracts")).data as { items: Array<Record<string, unknown>> };

    expect(data.items[0]).toMatchObject({
      contractId: "C-1",
      supplier: "Acme Hosting",
      status: "active",
      renewalDate: "2026-11-01T00:00:00.000Z",
      startDate: "2025-11-01T00:00:00.000Z",
      endDate: null,
      committedAmount: "49.00",
      billedToDate: "490.00",
      unknowns: [],
    });
    expect(data.items[1]).toMatchObject({
      contractId: "C-2",
      billedToDate: null,
      unknowns: ["renewal date not recorded", "committed amount not recorded"],
    });
  });

  it("filters to renewals inside a horizon and a status, earliest renewal first, with a capped limit", async () => {
    mocks.contractCount.mockResolvedValue(4);
    mocks.contractFindMany.mockResolvedValue([]);

    const res = await call("list_supplier_contracts", { renewingWithinDays: 60, status: "active", limit: 500 });

    const args = mocks.contractFindMany.mock.calls[0]![0] as { where: Record<string, any>; orderBy: unknown; take: number };
    expect(args.where.status).toBe("active");
    expect(args.where.renewalDate).toEqual({ lte: new Date("2026-11-30T12:00:00.000Z") });
    expect(args.orderBy).toEqual([{ renewalDate: { sort: "asc", nulls: "last" } }, { contractId: "asc" }]);
    expect(args.take).toBe(50);
    expect((res.data as { note: string }).note).toMatch(/none match/i);
  });
});
