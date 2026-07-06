import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mdmStewardTask: { findMany: vi.fn(), update: vi.fn() },
    customerAccount: { findUnique: vi.fn() },
    activity: { create: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("./steward", () => ({ runStewardSweep: vi.fn() }));
vi.mock("./merge", () => ({
  mergeRecords: vi.fn(),
  MergeValidationFailure: class extends Error {
    constructor(public reason: string) {
      super(reason);
    }
  },
}));

import { prisma } from "@dpf/db";
import { runStewardSweep } from "./steward";
import { mergeRecords } from "./merge";
import {
  chooseSurvivor,
  runAutonomousStewardship,
  MAX_AUTO_MERGES_PER_RUN,
} from "./autonomous-steward";

const SWEEP = { duplicatesFound: 0, duplicateTasksOpened: 0, staleFound: 0, staleTasksOpened: 0 };

function acct(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "a",
    name: "Acme",
    status: "prospect",
    domainNormalized: "",
    createdAt: new Date("2026-01-01"),
    _count: { contacts: 0, opportunities: 0, invoices: 0 },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runStewardSweep).mockResolvedValue(SWEEP);
  vi.mocked(prisma.mdmStewardTask.findMany).mockResolvedValue([] as never);
  vi.mocked(mergeRecords).mockResolvedValue({
    repointed: {}, repointedIds: {}, repointedIdsTruncated: [], nestedSiteMerges: [],
    loserSnapshot: {}, survivorship: {}, domain: "customer-account", loserId: "l", survivorId: "s",
  } as never);
});

describe("chooseSurvivor", () => {
  it("keeps the higher-status record (customer beats prospect)", () => {
    const r = chooseSurvivor(acct({ id: "a", status: "prospect" }), acct({ id: "b", status: "active" }));
    expect(r.survivor.id).toBe("b");
    expect(r.reason).toMatch(/active over prospect/);
  });
  it("breaks status ties by relationship count", () => {
    const r = chooseSurvivor(
      acct({ id: "a", status: "active", _count: { contacts: 1, opportunities: 0, invoices: 0 } }),
      acct({ id: "b", status: "active", _count: { contacts: 5, opportunities: 2, invoices: 1 } }),
    );
    expect(r.survivor.id).toBe("b");
    expect(r.reason).toMatch(/more-connected/);
  });
  it("breaks full ties by age (older survives)", () => {
    const r = chooseSurvivor(
      acct({ id: "a", createdAt: new Date("2026-01-01") }),
      acct({ id: "b", createdAt: new Date("2026-06-01") }),
    );
    expect(r.survivor.id).toBe("a");
    expect(r.reason).toMatch(/older/);
  });
});

describe("runAutonomousStewardship", () => {
  function queueDuplicate(over: Partial<Record<string, unknown>> = {}) {
    vi.mocked(prisma.mdmStewardTask.findMany).mockResolvedValue([
      { id: "row1", taskId: "STEW-1", domain: "customer-account", kind: "duplicate", subjectId: "a", candidateId: "b", ...over },
    ] as never);
  }

  it("auto-merges a clean account duplicate and resolves the task", async () => {
    queueDuplicate();
    vi.mocked(prisma.customerAccount.findUnique).mockImplementation(
      ((args: any) => Promise.resolve(acct({ id: args.where.id, status: args.where.id === "b" ? "active" : "prospect" }))) as never,
    );
    const s = await runAutonomousStewardship();
    expect(s.autoMerged).toHaveLength(1);
    // survivor is the active account "b"; loser "a" merged into it
    expect(mergeRecords).toHaveBeenCalledWith("customer-account", "a", "b");
    expect(prisma.mdmStewardTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "resolved_merged" }) }),
    );
    expect(prisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "account_auto_merged" }) }),
    );
  });

  it("ESCALATES a fuzzy match with different domains (distinct companies)", async () => {
    queueDuplicate();
    vi.mocked(prisma.customerAccount.findUnique).mockImplementation(
      ((args: any) => Promise.resolve(acct({ id: args.where.id, domainNormalized: args.where.id === "a" ? "acme.com" : "acme.io" }))) as never,
    );
    const s = await runAutonomousStewardship();
    expect(s.autoMerged).toHaveLength(0);
    expect(s.escalated[0]?.reason).toMatch(/different domains/);
    expect(mergeRecords).not.toHaveBeenCalled();
  });

  it("ESCALATES contact duplicates (identity carve-out)", async () => {
    queueDuplicate({ domain: "customer-contact" });
    const s = await runAutonomousStewardship();
    expect(s.autoMerged).toHaveLength(0);
    expect(s.escalated[0]?.reason).toMatch(/identity/);
    expect(mergeRecords).not.toHaveBeenCalled();
  });

  it("caps auto-merges per run and escalates the overflow", async () => {
    const many = Array.from({ length: MAX_AUTO_MERGES_PER_RUN + 3 }, (_, i) => ({
      id: `row${i}`, taskId: `STEW-${i}`, domain: "customer-account", kind: "duplicate",
      subjectId: `a${i}`, candidateId: `b${i}`,
    }));
    vi.mocked(prisma.mdmStewardTask.findMany).mockResolvedValue(many as never);
    vi.mocked(prisma.customerAccount.findUnique).mockImplementation(
      ((args: any) => Promise.resolve(acct({ id: args.where.id }))) as never,
    );
    const s = await runAutonomousStewardship();
    expect(s.autoMerged).toHaveLength(MAX_AUTO_MERGES_PER_RUN);
    expect(s.capped).toBe(true);
    expect(s.escalated.some((e) => /cap/.test(e.reason))).toBe(true);
  });

  it("dry-run reports would-merge without calling mergeRecords", async () => {
    queueDuplicate();
    vi.mocked(prisma.customerAccount.findUnique).mockImplementation(
      ((args: any) => Promise.resolve(acct({ id: args.where.id }))) as never,
    );
    const s = await runAutonomousStewardship({ dryRun: true });
    expect(s.autoMerged).toHaveLength(1);
    expect(s.dryRun).toBe(true);
    expect(mergeRecords).not.toHaveBeenCalled();
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });
});
