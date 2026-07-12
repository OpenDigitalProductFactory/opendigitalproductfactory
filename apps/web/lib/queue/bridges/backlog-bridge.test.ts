import { describe, it, expect, vi, beforeEach } from "vitest";

const { workItem, backlogItem, workQueue, inngestSend, recordQueueTransition } = vi.hoisted(() => ({
  workItem: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  backlogItem: { findUniqueOrThrow: vi.fn() },
  workQueue: { upsert: vi.fn() },
  inngestSend: vi.fn(),
  recordQueueTransition: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: { workItem, backlogItem, workQueue } }));
vi.mock("@/lib/queue/inngest-client", () => ({ inngest: { send: inngestSend } }));
vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition }));

import { bridgeBacklogItemToWorkItem } from "./backlog-bridge";

beforeEach(() => {
  workItem.findFirst.mockReset();
  workItem.create.mockReset();
  workItem.update.mockReset();
  backlogItem.findUniqueOrThrow.mockReset();
  workQueue.upsert.mockReset();
  inngestSend.mockReset();
  recordQueueTransition.mockReset();
});

describe("bridgeBacklogItemToWorkItem", () => {
  it("creates an in-progress WorkItem and records an enqueued transition when work starts", async () => {
    backlogItem.findUniqueOrThrow.mockResolvedValue({ title: "Do the thing", body: "details", status: "in-progress" });
    workItem.findFirst.mockResolvedValue(null);
    workQueue.upsert.mockResolvedValue({ id: "wq-internal-id", queueId: "triage-default" });
    const created = { itemId: "WI-new", createdAt: new Date("2026-07-06T12:00:00Z") };
    workItem.create.mockResolvedValue(created);

    const id = await bridgeBacklogItemToWorkItem("BI-1", "priority");

    expect(id).toBe("WI-new");
    const createArg = workItem.create.mock.calls[0]![0];
    expect(createArg.data.sourceType).toBe("backlog-item");
    expect(createArg.data.sourceId).toBe("BI-1");
    // status is projected from the backlog item, not hardcoded (BI-AC815F1E)
    expect(createArg.data.status).toBe("in-progress");
    expect(createArg.data.urgency).toBe("priority");
    expect(createArg.data.queueId).toBe("wq-internal-id");

    expect(recordQueueTransition).toHaveBeenCalledOnce();
    const tel = recordQueueTransition.mock.calls[0]![0];
    expect(tel.itemId).toBe("WI-new");
    expect(tel.transition).toBe("enqueued");
    expect(tel.occurredAt).toEqual(created.createdAt);
  });

  it("does NOT create a fresh case for a not-yet-started item (no flooding of triaging items)", async () => {
    backlogItem.findUniqueOrThrow.mockResolvedValue({ title: "Untriaged", body: null, status: "triaging" });
    workItem.findFirst.mockResolvedValue(null);

    const id = await bridgeBacklogItemToWorkItem("BI-triaging");

    expect(id).toBeNull();
    expect(workItem.create).not.toHaveBeenCalled();
    expect(recordQueueTransition).not.toHaveBeenCalled();
  });

  it("syncs an existing live case's status when the backlog item advances (in-progress → done closes it)", async () => {
    backlogItem.findUniqueOrThrow.mockResolvedValue({ title: "Do the thing", body: "details", status: "done" });
    workItem.findFirst.mockResolvedValue({ itemId: "WI-existing", status: "in-progress", title: "Do the thing" });

    const id = await bridgeBacklogItemToWorkItem("BI-1");

    expect(id).toBe("WI-existing");
    expect(workItem.create).not.toHaveBeenCalled();
    expect(workItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemId: "WI-existing" },
      data: expect.objectContaining({ status: "completed" }),
    }));
  });

  it("is a no-op when the existing case already matches the backlog item's status and title", async () => {
    backlogItem.findUniqueOrThrow.mockResolvedValue({ title: "Do the thing", body: "d", status: "in-progress" });
    workItem.findFirst.mockResolvedValue({ itemId: "WI-existing", status: "in-progress", title: "Do the thing" });

    const id = await bridgeBacklogItemToWorkItem("BI-1");

    expect(id).toBe("WI-existing");
    expect(workItem.update).not.toHaveBeenCalled();
    expect(workItem.create).not.toHaveBeenCalled();
  });

  it("falls back to the title when the BacklogItem has no body", async () => {
    backlogItem.findUniqueOrThrow.mockResolvedValue({ title: "Titled only", body: null, status: "in-progress" });
    workItem.findFirst.mockResolvedValue(null);
    workQueue.upsert.mockResolvedValue({ id: "wq", queueId: "triage-default" });
    workItem.create.mockResolvedValue({ itemId: "WI-2", createdAt: new Date() });
    await bridgeBacklogItemToWorkItem("BI-2");
    expect(workItem.create.mock.calls[0]![0].data.description).toBe("Titled only");
  });
});
