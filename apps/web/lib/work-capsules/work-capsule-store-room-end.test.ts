import { beforeEach, describe, expect, it, vi } from "vitest";

const { closeStageTelemetryForEndedRoom } = vi.hoisted(() => ({ closeStageTelemetryForEndedRoom: vi.fn() }));

vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("./publication-refusal", () => ({ assertWorkroomPublishable: vi.fn() }));
vi.mock("@/lib/work-management/workroom-stage-telemetry", () => ({ closeStageTelemetryForEndedRoom }));

import { updateWorkCapsuleStatus, type CapsuleDb } from "./work-capsule-store";

// BI-C9F1DE01: a room that ends is no longer driven, so nothing else closes
// its open steps. The status write closes them once its own commit is done.
function db(status: string, withTransaction = true) {
  const client = {
    workroom: {
      findUnique: vi.fn().mockResolvedValue({ id: "row-1", capsuleId: "WC-1", status, workspaceState: {}, backlogItemId: null, featureBuildId: null, taskRunId: null }),
      update: vi.fn().mockResolvedValue({ capsuleId: "WC-1" }),
    },
    workroomActivity: { create: vi.fn() },
    backlogItem: { findFirst: vi.fn() },
  } as Record<string, unknown>;
  if (withTransaction) client.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client));
  return client as unknown as CapsuleDb;
}
const actor = { userId: "u", agentId: null, principalId: "p" };
const NOW = new Date("2026-10-27T12:00:00Z");

describe("updateWorkCapsuleStatus closes an ended room's steps", () => {
  beforeEach(() => closeStageTelemetryForEndedRoom.mockReset());

  it.each(["archived", "abandoned", "complete"])("closes them when a live room becomes %s", async (status) => {
    await updateWorkCapsuleStatus({ db: db("working"), capsuleId: "WC-1", status: status as never, reason: "done", actor, now: NOW });
    expect(closeStageTelemetryForEndedRoom).toHaveBeenCalledWith("WC-1", NOW);
  });

  it("does nothing for a live status, or a room that had already ended", async () => {
    await updateWorkCapsuleStatus({ db: db("working"), capsuleId: "WC-1", status: "blocked", reason: "wait", actor, now: NOW });
    await updateWorkCapsuleStatus({ db: db("archived"), capsuleId: "WC-1", status: "abandoned", reason: "x", actor, now: NOW });
    expect(closeStageTelemetryForEndedRoom).not.toHaveBeenCalled();
  });

  it("leaves the close to the hourly reconciliation when it runs inside a caller's transaction", async () => {
    await updateWorkCapsuleStatus({ db: db("working", false), capsuleId: "WC-1", status: "complete", reason: "child done", actor, now: NOW });
    expect(closeStageTelemetryForEndedRoom).not.toHaveBeenCalled();
  });
});
