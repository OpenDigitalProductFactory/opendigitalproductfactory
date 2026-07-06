import { describe, it, expect, vi, beforeEach } from "vitest";

const { workItem, backlogItem, workQueue, inngestSend, recordQueueTransition } = vi.hoisted(() => ({
  workItem: { findFirst: vi.fn(), create: vi.fn() },
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
  backlogItem.findUniqueOrThrow.mockReset();
  workQueue.upsert.mockReset();
  inngestSend.mockReset();
  recordQueueTransition.mockReset();
});

describe("bridgeBacklogItemToWorkItem", () => {
  it("is idempotent — returns the existing live WorkItem without creating a new one", async () => {
    workItem.findFirst.mockResolvedValue({ itemId: "WI-existing" });
    const id = await bridgeBacklogItemToWorkItem("BI-1");
    expect(id).toBe("WI-existing");
    expect(workItem.create).not.toHaveBeenCalled();
    expect(recordQueueTransition).not.toHaveBeenCalled();
  });

  it("creates a queued WorkItem and records an enqueued transition on first claim", async () => {
    workItem.findFirst.mockResolvedValue(null);
    backlogItem.findUniqueOrThrow.mockResolvedValue({ title: "Do the thing", body: "details" });
    workQueue.upsert.mockResolvedValue({ id: "wq-internal-id", queueId: "triage-default" });
    const created = { itemId: "WI-new", createdAt: new Date("2026-07-06T12:00:00Z") };
    workItem.create.mockResolvedValue(created);

    const id = await bridgeBacklogItemToWorkItem("BI-1", "priority");

    expect(id).toBe("WI-new");
    const createArg = workItem.create.mock.calls[0]![0];
    expect(createArg.data.sourceType).toBe("backlog-item");
    expect(createArg.data.sourceId).toBe("BI-1");
    expect(createArg.data.status).toBe("queued");
    expect(createArg.data.urgency).toBe("priority");
    expect(createArg.data.queueId).toBe("wq-internal-id");

    expect(recordQueueTransition).toHaveBeenCalledOnce();
    const tel = recordQueueTransition.mock.calls[0]![0];
    expect(tel.queueKey).toBe("cwq:wq-internal-id");
    expect(tel.itemKind).toBe("work-item");
    expect(tel.itemId).toBe("WI-new");
    expect(tel.transition).toBe("enqueued");
    expect(tel.occurredAt).toEqual(created.createdAt);
  });

  it("falls back to the title when the BacklogItem has no body", async () => {
    workItem.findFirst.mockResolvedValue(null);
    backlogItem.findUniqueOrThrow.mockResolvedValue({ title: "Titled only", body: null });
    workQueue.upsert.mockResolvedValue({ id: "wq", queueId: "triage-default" });
    workItem.create.mockResolvedValue({ itemId: "WI-2", createdAt: new Date() });
    await bridgeBacklogItemToWorkItem("BI-2");
    expect(workItem.create.mock.calls[0]![0].data.description).toBe("Titled only");
  });
});
