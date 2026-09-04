import { describe, expect, it, vi } from "vitest";

import {
  deliveryNotificationId,
  notifyDeliveryTransition,
  projectDeliveryNotificationCandidate,
  reconcileDeliveryTaskNotifications,
} from "./delivery-task-notifications";

describe("delivery task notifications", () => {
  it.each([
    ["complete", "completed"],
    ["blocked", "failed"],
    ["ready-for-review", "review-required"],
  ] as const)("projects %s as a semantic %s transition", (status, kind) => {
    expect(projectDeliveryNotificationCandidate({
      capsuleId: "WC-1",
      title: "Deliver outcome",
      status,
      updatedAt: new Date("2026-09-04T12:00:00.000Z"),
      leaseExpiresAt: null,
      taskRun: null,
    }, new Date("2026-09-04T12:01:00.000Z"))).toMatchObject({
      kind,
      deepLink: expect.stringMatching(/^\/build\/work\/WC-1/),
    });
  });

  it("does not notify for progress-only or old transitions", () => {
    const old = new Date("2026-09-04T09:00:00.000Z");
    const now = new Date("2026-09-04T12:00:00.000Z");
    expect(projectDeliveryNotificationCandidate({ capsuleId: "WC-1", title: "Work", status: "working", updatedAt: now, leaseExpiresAt: null, taskRun: null }, now)).toBeNull();
    expect(projectDeliveryNotificationCandidate({ capsuleId: "WC-1", title: "Work", status: "complete", updatedAt: old, leaseExpiresAt: null, taskRun: null }, now)).toBeNull();
  });

  it.each([
    [{ status: "working", leaseExpiresAt: new Date("2026-09-04T11:59:00.000Z"), taskRun: null }, "takeover-ready"],
    [{ status: "working", leaseExpiresAt: null, taskRun: { taskRunId: "TR-1", status: "input-required", updatedAt: new Date("2026-09-04T12:00:00.000Z"), actionEnvelopes: [{ id: "CAE-1", status: "proposed", expiresAt: new Date("2026-09-04T12:10:00.000Z") }] } }, "approval-required"],
    [{ status: "working", leaseExpiresAt: null, taskRun: { taskRunId: "TR-1", status: "input-required", updatedAt: new Date("2026-09-04T12:00:00.000Z"), actionEnvelopes: [{ id: "CAE-APPROVED", status: "approved", expiresAt: new Date("2026-09-04T12:10:00.000Z") }] } }, "input-required"],
    [{ status: "working", leaseExpiresAt: null, taskRun: { taskRunId: "TR-1", status: "input-required", updatedAt: new Date("2026-09-04T12:00:00.000Z"), actionEnvelopes: [{ id: "CAE-OLD", status: "proposed", expiresAt: new Date("2026-09-04T11:59:00.000Z") }] } }, "approval-expired"],
    [{ status: "working", leaseExpiresAt: null, taskRun: { taskRunId: "TR-1", status: "input-required", updatedAt: new Date("2026-09-04T12:00:00.000Z"), actionEnvelopes: [] } }, "input-required"],
  ] as const)("projects operator attention as %s", (overrides, kind) => {
    expect(projectDeliveryNotificationCandidate({
      capsuleId: "WC-1",
      title: "Deliver outcome",
      updatedAt: new Date("2026-09-04T12:00:00.000Z"),
      ...overrides,
    }, new Date("2026-09-04T12:01:00.000Z"))).toMatchObject({ kind });
  });

  it.each([
    [{
      updatedAt: new Date("2026-09-04T09:00:00.000Z"),
      leaseExpiresAt: new Date("2026-09-04T11:59:00.000Z"),
      taskRun: null,
    }, "takeover-ready"],
    [{
      updatedAt: new Date("2026-09-04T09:00:00.000Z"),
      leaseExpiresAt: null,
      taskRun: {
        taskRunId: "TR-OLD",
        status: "input-required",
        updatedAt: new Date("2026-09-04T09:00:00.000Z"),
        actionEnvelopes: [{
          id: "CAE-RECENTLY-EXPIRED",
          status: "proposed",
          expiresAt: new Date("2026-09-04T11:59:00.000Z"),
        }],
      },
    }, "approval-expired"],
  ] as const)("uses the semantic transition time for old rows that just became %s", (overrides, kind) => {
    expect(projectDeliveryNotificationCandidate({
      capsuleId: "WC-1",
      title: "Deliver outcome",
      status: "working",
      ...overrides,
    }, new Date("2026-09-04T12:01:00.000Z"))).toMatchObject({ kind });
  });

  it("deduplicates against any prior notification, including a read one", async () => {
    const create = vi.fn();
    const emit = vi.fn();
    const input = {
      userId: "user-1",
      capsuleId: "WC-1",
      title: "Deliver outcome",
      kind: "completed" as const,
      sourceKey: "2026-09-04T12:00:00.000Z",
      body: "Delivery completed.",
      deepLink: "/build/work/WC-1#result",
    };
    const result = await notifyDeliveryTransition({ hasAny: vi.fn().mockResolvedValue(true), create, emit }, input);

    expect(result).toEqual({ created: false });
    expect(create).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("uses a stable row id and does not emit when a concurrent insert already won", async () => {
    const emit = vi.fn();
    const create = vi.fn().mockResolvedValue(false);
    const input = {
      userId: "user-1",
      capsuleId: "WC-1",
      title: "Deliver outcome",
      kind: "completed" as const,
      sourceKey: "transition-1",
      body: "Delivery completed.",
      deepLink: "/build/work/WC-1#result",
    };

    await expect(notifyDeliveryTransition({ hasAny: vi.fn().mockResolvedValue(false), create, emit }, input))
      .resolves.toEqual({ created: false });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      id: deliveryNotificationId("user-1", "attention:delivery-task:WC-1:completed:transition-1"),
    }));
    expect(emit).not.toHaveBeenCalled();
  });

  it("reconciles only a fixed recent window and contains notification failures", async () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const notify = vi.fn().mockRejectedValue(new Error("notification store unavailable"));
    const listRecent = vi.fn().mockResolvedValue([{
      capsuleId: "WC-1",
      title: "Done",
      status: "complete",
      updatedAt: new Date("2026-09-04T11:59:00.000Z"),
      leaseExpiresAt: null,
      taskRun: { taskRunId: "TR-1", userId: "user-1", status: "completed", updatedAt: new Date("2026-09-04T11:59:00.000Z") },
    }]);

    await expect(reconcileDeliveryTaskNotifications({
      listRecent,
      resolveOperatorUserId: vi.fn(),
      notify,
    }, now)).resolves.toEqual({ scanned: 1, created: 0, failed: 1 });
    expect(listRecent).toHaveBeenCalledWith({ since: new Date("2026-09-04T11:30:00.000Z"), take: 100 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", kind: "completed" }));
  });
});
