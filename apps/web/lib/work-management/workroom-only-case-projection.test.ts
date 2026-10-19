import { describe, expect, it, vi } from "vitest";

import {
  loadWorkroomOnlyCaseDetail,
  type WorkroomOnlyPrismaClient,
  type WorkroomOnlyRecord,
} from "./workroom-only-case-projection";

const AUTH = { principalId: "PRN-OWNER", sensitivityClearance: ["internal"], isSuperuser: false };

const NOW = new Date("2026-09-07T12:00:00.000Z");

function client(room: WorkroomOnlyRecord | null): WorkroomOnlyPrismaClient {
  return {
    workroom: {
      async findFirst(args: any) {
        return room && room.capsuleId === args.where.capsuleId ? room : null;
      },
    },
  };
}

const room = (over: Partial<WorkroomOnlyRecord> = {}): WorkroomOnlyRecord => ({
  createdByPrincipal: { principalId: "PRN-OWNER" },
  capsuleId: "WC-ALPHA",
  title: "Reconcile the ledger",
  status: "working",
  objective: "Bring the September ledger into agreement with the bank feed.",
  workItemId: null,
  updatedAt: NOW,
  ...over,
});

const load = (r: WorkroomOnlyRecord | null, sourceId = "WC-ALPHA") =>
  loadWorkroomOnlyCaseDetail({ authContext: AUTH,
    prismaClient: client(r),
    sourceId,
    // The route hands the loader the encoded key; buildWorkroomView enforces it.
    caseKey: encodeURIComponent(`work-capsule:${sourceId}`),
    now: NOW,
  });

describe("loadWorkroomOnlyCaseDetail", () => {
  it.each([
    { label: "not admitted", authContext: { ...AUTH, principalId: "PRN-OTHER" } },
    { label: "insufficient clearance", authContext: { ...AUTH, sensitivityClearance: ["public"] } },
    { label: "missing caller", authContext: undefined },
  ])("does not read execution for a caller who is $label", async ({ authContext }) => {
    const findMany = vi.fn();
    const detail = await loadWorkroomOnlyCaseDetail({ authContext,
      prismaClient: { ...client(room()), workroomActivity: { findMany }, taskRun: { findMany } },
      sourceId: "WC-ALPHA", caseKey: "work-capsule%3AWC-ALPHA", now: NOW,
    });
    expect(detail).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("admits the selected active participant using canonical principal identity", async () => {
    const detail = await loadWorkroomOnlyCaseDetail({ authContext: { ...AUTH, principalId: "PRN-MEMBER" },
      prismaClient: client(room({ participants: [{ principal: { principalId: "PRN-MEMBER" } }] })),
      sourceId: "WC-ALPHA", caseKey: "work-capsule%3AWC-ALPHA", now: NOW,
    });
    expect(detail).not.toBeNull();
  });

  it("applies the declared sensitivity ceiling even to the creator", async () => {
    const findMany = vi.fn();
    const detail = await loadWorkroomOnlyCaseDetail({ authContext: AUTH,
      prismaClient: { ...client(room({ scopeClaims: [{ workroomBoundary: { sensitivityCeiling: "restricted" } }] })),
        workroomActivity: { findMany }, taskRun: { findMany } },
      sourceId: "WC-ALPHA", caseKey: "work-capsule%3AWC-ALPHA", now: NOW,
    });
    expect(detail).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("retains the standalone room's execution evidence and versioned shape", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "journal-1", workCapsuleId: "row-1", kind: "evidence-recorded",
      summary: "Provider failure recorded", recordedAt: NOW, payload: {},
    }]);
    const db = {
      ...client(room({ id: "row-1", scopeClaims: [{ workShape: "delivery-small@1.0.0" }],
        workspaceState: { workroomDrive: { action: "attention", stageKey: "implement",
          pendingAttention: { stageKey: "implement", principalRef: "role:author" } } } })),
      workroomActivity: { findMany },
      taskRun: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const detail = await loadWorkroomOnlyCaseDetail({ authContext: AUTH, prismaClient: db,
      sourceId: "WC-ALPHA", caseKey: "work-capsule%3AWC-ALPHA", now: NOW });
    expect(detail!.room!.processOverseer.shapeKey).toBe("delivery-small");
    expect(detail!.summary.attentionReason).toContain("Stage implement is waiting on role:author.");
    expect(detail!.room!.receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ rawRef: { table: "WorkroomActivity", id: "journal-1" }, status: "observed" }),
    ]));
    expect(detail!.room!.activity.some(event => event.summary === "Provider failure recorded")).toBe(true);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workCapsuleId: { in: ["row-1"] } }, take: 21,
    }));
  });

  it("reports unreadable execution as partial rather than empty success", async () => {
    const detail = await loadWorkroomOnlyCaseDetail({ authContext: AUTH,
      prismaClient: { ...client(room({ id: "row-1" })),
        workroomActivity: { findMany: async () => { throw new Error("unavailable"); } } },
      sourceId: "WC-ALPHA", caseKey: "work-capsule%3AWC-ALPHA", now: NOW,
    });
    expect(detail!.room!.projection.sourceHealth).toBe("partial");
    expect(detail!.room!.boundary.scopeIncluded).toEqual([]);
  });

  it("keeps a failed reviewer visible in both the case summary and room", async () => {
    const detail = await loadWorkroomOnlyCaseDetail({ authContext: AUTH,
      prismaClient: { ...client(room({ id: "row-1" })),
        workroomActivity: { findMany: vi.fn().mockResolvedValue([]) },
        taskRun: { findMany: vi.fn().mockResolvedValue([{
          id: "run-row", taskRunId: "TR-REVIEW", userId: null, status: "failed",
          updatedAt: NOW, lastHeartbeatAt: NOW, nodes: [],
          progressPayload: { semanticReview: { reason: "provider-unavailable" } },
        }]) } },
      sourceId: "WC-ALPHA", caseKey: "work-capsule%3AWC-ALPHA", now: NOW,
    });
    expect(detail!.summary.attentionRequired).toBe(true);
    expect(detail!.summary.attentionReason).toContain("provider-unavailable");
    expect(detail!.room!.work.attentionReason).toBe(detail!.summary.attentionReason);
    expect(detail!.room!.work.nextAction).toContain("Observed execution");
    expect(detail!.room!.receipts[0].status).toBe("observed");
  });
  it("opens a room that anchors no WorkItem instead of leaving it unreachable", async () => {
    // 290 of 464 rooms on the live install have no workItemId (BI-2C31C399);
    // every one of them served the not-found boundary from the activity tree.
    const detail = await load(room());
    expect(detail).not.toBeNull();
    expect(detail!.summary.title).toContain("Reconcile the ledger");
    expect(detail!.workItemId).toBeNull();
  });

  it("addresses the case by the same helper the tree links with", async () => {
    const detail = await load(room());
    expect(detail!.summary.href).toBe("/workspace/cases/work-capsule%3AWC-ALPHA");
  });

  it("leaves an anchored room to its WorkItem's case so one unit of work has one case", async () => {
    // Not a 404: the caller redirects an anchored room to the item's case.
    const detail = await load(room({ workItemId: "wi-1" }));
    expect(detail).toBeNull();
  });

  it("is genuinely not found when no such room exists", async () => {
    expect(await load(null)).toBeNull();
    expect(await load(room(), "WC-MISSING")).toBeNull();
  });

  it("says an objective was not recorded rather than restating the title as intent", async () => {
    const detail = await load(room({ objective: null }));
    expect(detail!.room!.purpose).toBeNull();
    expect(detail!.room!.boundary.gaps).toEqual(expect.arrayContaining(["purpose", "outcome"]));
    expect(detail!.summary.description).toBeNull();
  });

  it("treats whitespace as no objective", async () => {
    const detail = await load(room({ objective: "   " }));
    expect(detail!.room!.purpose).toBeNull();
  });

  it("carries the room's own objective as its purpose when one is recorded", async () => {
    const detail = await load(room());
    expect(detail!.room!.purpose).toContain("September ledger");
  });

  it("states the fields it does not know rather than implying a value", async () => {
    const detail = await load(room());
    expect(detail!.summary.urgencyLabel).toBe("Not recorded");
    expect(detail!.summary.effortLabel).toBe("Not recorded");
    expect(detail!.summary.assignmentLabel).toBe("Not recorded");
  });

  it("raises attention only for a blocked room, with the reason", async () => {
    const working = await load(room());
    expect(working!.summary.attentionRequired).toBe(false);
    expect(working!.summary.attentionReason).toBeNull();

    const blocked = await load(room({ status: "blocked" }));
    expect(blocked!.summary.attentionRequired).toBe(true);
    expect(blocked!.summary.attentionReason).toContain("blocked");
  });

  it("returns a serialisable detail with no undefined dueAt", async () => {
    const detail = await load(room());
    expect(detail!.summary.dueAt).toBeNull();
    expect(() => JSON.stringify(detail)).not.toThrow();
  });
});
