import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    selfUpgradeRun: { findUnique: vi.fn(), update: vi.fn() },
    changeRequest: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
  Prisma: {},
}));

import { prisma } from "@dpf/db";
import {
  syncSelfUpgradeChangeRecord,
  safeSyncSelfUpgradeChangeRecord,
} from "./change-record";

type RunRow = {
  runId: string;
  status: string;
  trigger: string;
  currentSha: string | null;
  targetSha: string | null;
  deployedSha: string | null;
  reason: string | null;
  failureLog: string | null;
  completionEvidence: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  changeRequestId: string | null;
  impactSummaryId: string | null;
  impactSummary: { summary: unknown } | null;
};

function makeRun(over: Partial<RunRow>): RunRow {
  return {
    runId: "SUR-TEST0001",
    status: "queued",
    trigger: "scheduled",
    currentSha: "aaaaaaa1111",
    targetSha: "bbbbbbb2222",
    deployedSha: null,
    reason: null,
    failureLog: null,
    completionEvidence: null,
    startedAt: null,
    completedAt: null,
    changeRequestId: null,
    impactSummaryId: null,
    impactSummary: null,
    ...over,
  };
}

// A tiny in-memory RFC shared by the create/find/update mocks so advanceChange
// walks across steps exactly as it would against a real row.
let rfc: { id: string; status: string } | null = null;

function createData() {
  return (vi.mocked(prisma.changeRequest.create).mock.calls[0][0] as { data: Record<string, unknown> })
    .data;
}
function updateStatuses(): string[] {
  return vi
    .mocked(prisma.changeRequest.update)
    .mock.calls.map((c) => (c[0] as { data: { status: string } }).data.status);
}
function firstUpdateData() {
  return (vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as { data: Record<string, unknown> })
    .data;
}

beforeEach(() => {
  vi.clearAllMocks();
  rfc = null;
  vi.mocked(prisma.changeRequest.create).mockImplementation((async (args: {
    data: { status: string };
  }) => {
    rfc = { id: "cr-new", status: args.data.status };
    return { id: "cr-new", rfcId: "RFC-2026-TEST0001" };
  }) as never);
  vi.mocked(prisma.changeRequest.findUnique).mockImplementation((async () =>
    rfc ? { ...rfc } : null) as never);
  vi.mocked(prisma.changeRequest.update).mockImplementation((async (args: {
    data: { status: string };
  }) => {
    if (rfc) rfc.status = args.data.status;
    return {};
  }) as never);
  vi.mocked(prisma.selfUpgradeRun.update).mockResolvedValue({} as never);
});

function setRun(run: RunRow, existingRfc?: { id: string; status: string }) {
  if (existingRfc) rfc = existingRfc;
  vi.mocked(prisma.selfUpgradeRun.findUnique).mockResolvedValue(run as never);
}

describe("syncSelfUpgradeChangeRecord — lazy open", () => {
  it("opens NO record for a queued run (lazy)", async () => {
    setRun(makeRun({ status: "queued" }));
    await syncSelfUpgradeChangeRecord("SUR-TEST0001");
    expect(prisma.changeRequest.create).not.toHaveBeenCalled();
    expect(prisma.selfUpgradeRun.update).not.toHaveBeenCalled();
  });

  it("opens NO record for a skipped no-op tick", async () => {
    setRun(makeRun({ status: "skipped", reason: "up-to-date" }));
    await syncSelfUpgradeChangeRecord("SUR-TEST0001");
    expect(prisma.changeRequest.create).not.toHaveBeenCalled();
  });

  it("returns quietly when the run does not exist", async () => {
    vi.mocked(prisma.selfUpgradeRun.findUnique).mockResolvedValue(null as never);
    await syncSelfUpgradeChangeRecord("SUR-MISSING");
    expect(prisma.changeRequest.create).not.toHaveBeenCalled();
  });
});

describe("syncSelfUpgradeChangeRecord — running", () => {
  it("creates a standard platform change at in-progress, links it, folds in the impact summary", async () => {
    setRun(
      makeRun({
        status: "running",
        startedAt: new Date(),
        impactSummary: { summary: { counts: { breaking: 0 }, phrased: { headline: "3 fixes, 1 chore" } } },
      }),
    );

    await syncSelfUpgradeChangeRecord("SUR-TEST0001");

    expect(prisma.changeRequest.create).toHaveBeenCalledOnce();
    const data = createData();
    expect(data.type).toBe("standard");
    expect(data.scope).toBe("platform");
    expect(data.status).toBe("in-progress");
    expect(data.riskLevel).toBe("low");
    expect(String(data.title)).toContain("Platform self-upgrade");
    const impact = data.impactReport as Record<string, unknown>;
    expect(impact.source).toBe("self-upgrade");
    expect(impact.headline).toBe("3 fixes, 1 chore");
    // Bidirectional link recorded on the run.
    expect(prisma.selfUpgradeRun.update).toHaveBeenCalledWith({
      where: { runId: "SUR-TEST0001" },
      data: { changeRequestId: "cr-new" },
    });
    // No terminal advance while still running.
    expect(prisma.changeRequest.update).not.toHaveBeenCalled();
  });

  it("derives medium risk when the upgrade carries a breaking change", async () => {
    setRun(
      makeRun({
        status: "running",
        startedAt: new Date(),
        impactSummary: { summary: { counts: { breaking: 2 } } },
      }),
    );
    await syncSelfUpgradeChangeRecord("SUR-TEST0001");
    expect(createData().riskLevel).toBe("medium");
  });
});

describe("syncSelfUpgradeChangeRecord — succeeded", () => {
  it("drives completed → closed with verification evidence", async () => {
    setRun(
      makeRun({
        status: "succeeded",
        startedAt: new Date(),
        completedAt: new Date("2026-06-16T12:00:00Z"),
        deployedSha: "ccccccc3333",
        completionEvidence: { recoveryPoint: { status: "ok" } },
      }),
    );

    await syncSelfUpgradeChangeRecord("SUR-TEST0001");

    expect(prisma.changeRequest.create).toHaveBeenCalledOnce();
    expect(updateStatuses()).toEqual(["completed", "closed"]);
    const completed = firstUpdateData();
    expect(completed.outcome).toBe("succeeded");
    const verification = completed.postChangeVerification as Record<string, unknown>;
    expect(verification.deployedSha).toBe("ccccccc3333");
    expect(rfc?.status).toBe("closed");
  });

  it("does not re-create when the record already exists (linked at start)", async () => {
    setRun(
      makeRun({
        status: "succeeded",
        startedAt: new Date(),
        completedAt: new Date(),
        changeRequestId: "cr-existing",
      }),
      { id: "cr-existing", status: "in-progress" },
    );

    await syncSelfUpgradeChangeRecord("SUR-TEST0001");

    expect(prisma.changeRequest.create).not.toHaveBeenCalled();
    expect(prisma.selfUpgradeRun.update).not.toHaveBeenCalled();
    expect(rfc?.status).toBe("closed");
  });

  it("is idempotent once the record is closed", async () => {
    setRun(
      makeRun({ status: "succeeded", startedAt: new Date(), changeRequestId: "cr-x" }),
      { id: "cr-x", status: "closed" },
    );
    await syncSelfUpgradeChangeRecord("SUR-TEST0001");
    expect(prisma.changeRequest.create).not.toHaveBeenCalled();
    expect(prisma.changeRequest.update).not.toHaveBeenCalled();
  });
});

describe("syncSelfUpgradeChangeRecord — failed", () => {
  it("a swap-time failure rolls the record back with the failure note", async () => {
    setRun(
      makeRun({
        status: "failed",
        startedAt: new Date(),
        completedAt: new Date(),
        failureLog: "build-gate: typecheck error in foo.ts",
      }),
    );

    await syncSelfUpgradeChangeRecord("SUR-TEST0001");

    expect(createData().status).toBe("in-progress");
    expect(updateStatuses()).toEqual(["rolled-back", "closed"]);
    const rolledBack = firstUpdateData();
    expect(rolledBack.outcome).toBe("failed");
    expect(String(rolledBack.outcomeNotes)).toContain("typecheck error");
  });

  it("a pre-execution failure (no swap attempted) cancels the record", async () => {
    setRun(
      makeRun({
        status: "failed",
        startedAt: null, // never started executing — e.g. merge conflict at source prep
        completedAt: new Date(),
        failureLog: "merge-conflict: apps/web/foo.ts",
      }),
    );

    await syncSelfUpgradeChangeRecord("SUR-TEST0001");

    expect(createData().status).toBe("scheduled");
    expect(updateStatuses()).toEqual(["cancelled", "closed"]);
  });
});

describe("safeSyncSelfUpgradeChangeRecord — best effort", () => {
  it("never throws and logs loudly when the mirror fails", async () => {
    vi.mocked(prisma.selfUpgradeRun.findUnique).mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(safeSyncSelfUpgradeChangeRecord("SUR-TEST0001")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});
