import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mdmStewardTask: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    mdmMatchConfig: { findUnique: vi.fn() },
    customerAccount: { findMany: vi.fn(), update: vi.fn() },
    customerContact: { findMany: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("./batch-scan", () => ({
  scanCustomerAccountDuplicates: vi.fn(),
  scanCustomerContactDuplicates: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { scanCustomerAccountDuplicates, scanCustomerContactDuplicates } from "./batch-scan";
import { listOpenStewardTasks, resolveStewardTask, runStewardSweep } from "./steward";

const PAIR = {
  a: { id: "a1", label: "Emma 3D", detail: "prospect" },
  b: { id: "a2", label: "Emma3D", detail: "active" },
  score: 0.75,
  reasons: [{ attribute: "name" as const, kind: "strong" as const, detail: "~0.9" }],
  recommendation: "likely-duplicate" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mdmMatchConfig.findUnique).mockResolvedValue(null as never);
  vi.mocked(scanCustomerAccountDuplicates).mockResolvedValue([]);
  vi.mocked(scanCustomerContactDuplicates).mockResolvedValue([]);
  vi.mocked(prisma.customerAccount.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.customerContact.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.mdmStewardTask.create).mockResolvedValue({} as never);
});

describe("runStewardSweep", () => {
  it("files duplicate pairs as steward tasks", async () => {
    vi.mocked(scanCustomerAccountDuplicates).mockResolvedValue([PAIR]);
    const summary = await runStewardSweep();
    expect(summary.duplicatesFound).toBe(1);
    expect(summary.duplicateTasksOpened).toBe(1);
    expect(prisma.mdmStewardTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          domain: "customer-account",
          kind: "duplicate",
          subjectId: "a1",
          candidateId: "a2",
        }),
      }),
    );
  });

  it("is idempotent: an existing open task is refreshed, not re-filed", async () => {
    vi.mocked(scanCustomerAccountDuplicates).mockResolvedValue([PAIR]);
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue({
      id: "row1",
      status: "open",
      score: 0.6,
    } as never);
    const summary = await runStewardSweep();
    expect(summary.duplicateTasksOpened).toBe(0);
    expect(prisma.mdmStewardTask.create).not.toHaveBeenCalled();
    expect(prisma.mdmStewardTask.update).toHaveBeenCalled();
  });

  it("never re-files a resolved pair (marked-distinct stays resolved)", async () => {
    vi.mocked(scanCustomerAccountDuplicates).mockResolvedValue([PAIR]);
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue({
      id: "row1",
      status: "resolved_distinct",
    } as never);
    const summary = await runStewardSweep();
    expect(summary.duplicateTasksOpened).toBe(0);
    expect(prisma.mdmStewardTask.create).not.toHaveBeenCalled();
    expect(prisma.mdmStewardTask.update).not.toHaveBeenCalled();
  });

  it("files stale active accounts with an empty candidateId", async () => {
    vi.mocked(prisma.customerAccount.findMany).mockResolvedValue([
      { id: "a9", name: "Old Co", updatedAt: new Date("2025-01-01") },
    ] as never);
    const summary = await runStewardSweep();
    expect(summary.staleTasksOpened).toBe(1);
    expect(prisma.mdmStewardTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "stale", subjectId: "a9", candidateId: "" }),
      }),
    );
  });
});

describe("resolveStewardTask", () => {
  it("rejects an unknown task", async () => {
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue(null as never);
    const result = await resolveStewardTask("STEW-NOPE", "dismissed", "u1");
    expect(result.ok).toBe(false);
  });

  it("marks resolved and touches the record for refreshed stale tasks", async () => {
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue({
      id: "row1",
      taskId: "STEW-1",
      status: "open",
      kind: "stale",
      domain: "customer-account",
      subjectId: "a9",
    } as never);
    const result = await resolveStewardTask("STEW-1", "resolved_refreshed", "u1");
    expect(result.ok).toBe(true);
    expect(prisma.mdmStewardTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "resolved_refreshed", resolvedBy: "u1" }),
      }),
    );
    expect(prisma.customerAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a9" } }),
    );
  });

  it("refuses to double-resolve", async () => {
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue({
      id: "row1",
      taskId: "STEW-1",
      status: "dismissed",
    } as never);
    const result = await resolveStewardTask("STEW-1", "dismissed", "u1");
    expect(result.ok).toBe(false);
  });
});

describe("listOpenStewardTasks", () => {
  it("labels subjects and candidates from their domain tables", async () => {
    vi.mocked(prisma.mdmStewardTask.findMany).mockResolvedValue([
      {
        taskId: "STEW-1",
        domain: "customer-account",
        kind: "duplicate",
        subjectId: "a1",
        candidateId: "a2",
        score: 0.7,
        note: null,
        createdAt: new Date(),
      },
    ] as never);
    vi.mocked(prisma.customerAccount.findMany).mockResolvedValue([
      { id: "a1", name: "Emma 3D", status: "prospect" },
      { id: "a2", name: "Emma3D", status: "active" },
    ] as never);
    const tasks = await listOpenStewardTasks();
    expect(tasks[0]!.subjectLabel).toBe("Emma 3D (prospect)");
    expect(tasks[0]!.candidateLabel).toBe("Emma3D (active)");
  });
});
