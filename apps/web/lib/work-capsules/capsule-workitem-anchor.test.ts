import { describe, expect, it, vi } from "vitest";

import { ensureCapsuleWorkItemAnchor, type WorkItemAnchorPorts } from "./capsule-workitem-anchor";

function ports(overrides: Partial<WorkItemAnchorPorts> = {}): WorkItemAnchorPorts {
  return {
    findWorkItemBySource: vi.fn().mockResolvedValue(null),
    resolveCanonicalQueueId: vi.fn().mockResolvedValue("queue-1"),
    createWorkItem: vi.fn().mockResolvedValue({ id: "wi-new" }),
    setCapsuleWorkItem: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("ensureCapsuleWorkItemAnchor", () => {
  it("anchors an ad-hoc capsule to its own addressable case", async () => {
    const p = ports();
    const result = await ensureCapsuleWorkItemAnchor({ ports: p, capsuleId: "WC-1", backlogItemId: null, title: "t" });
    expect(result).toEqual({ workItemId: "wi-new", created: true });
    expect(p.findWorkItemBySource).toHaveBeenCalledWith("work-capsule", "WC-1");
    expect(p.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "work-capsule",
      sourceId: "WC-1",
      title: "t",
    }));
    expect(p.setCapsuleWorkItem).toHaveBeenCalledWith("WC-1", "wi-new");
  });

  it("links to an existing WorkItem without creating a duplicate", async () => {
    const p = ports({ findWorkItemBySource: vi.fn().mockResolvedValue({ id: "wi-existing" }) });
    const result = await ensureCapsuleWorkItemAnchor({ ports: p, capsuleId: "WC-1", backlogItemId: "BI-9", title: "t" });
    expect(result).toEqual({ workItemId: "wi-existing", created: false });
    expect(p.findWorkItemBySource).toHaveBeenCalledWith("backlog-item", "BI-9");
    expect(p.createWorkItem).not.toHaveBeenCalled();
    expect(p.setCapsuleWorkItem).toHaveBeenCalledWith("WC-1", "wi-existing");
  });

  it("creates the canonical WorkItem in the resolved queue when none exists", async () => {
    const p = ports();
    const result = await ensureCapsuleWorkItemAnchor({ ports: p, capsuleId: "WC-1", backlogItemId: "BI-9", title: "Work on BI-9" });
    expect(result).toEqual({ workItemId: "wi-new", created: true });
    expect(p.resolveCanonicalQueueId).toHaveBeenCalled();
    expect(p.createWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "backlog-item",
        sourceId: "BI-9",
        title: "Work on BI-9",
        queueId: "queue-1",
        status: "queued",
      }),
    );
    expect(p.setCapsuleWorkItem).toHaveBeenCalledWith("WC-1", "wi-new");
  });
});
