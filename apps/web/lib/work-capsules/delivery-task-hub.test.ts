import { describe, expect, it } from "vitest";

import {
  projectDeliveryTaskHubRow,
  sanitizeDeliveryProgress,
  type DeliveryTaskHubSource,
} from "./delivery-task-hub";

const now = new Date("2026-09-04T12:00:00.000Z");

function source(overrides: Partial<DeliveryTaskHubSource> = {}): DeliveryTaskHubSource {
  return {
    id: "row-1",
    capsuleId: "WC-123",
    title: "Ship the task hub",
    objective: "Operators can leave long-running work and return to its result.",
    status: "ready",
    source: "backlog",
    executorKind: "codex-desktop",
    executorRef: "thread-1",
    backlogItemId: "BI-123",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    headBranch: "feat/task-hub",
    pullRequestUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5000",
    leaseExpiresAt: null,
    updatedAt: new Date("2026-09-04T11:55:00.000Z"),
    lastSyncedAt: new Date("2026-09-04T11:55:00.000Z"),
    taskRun: null,
    activities: [],
    runtimeVerifications: [],
    ...overrides,
  };
}

describe("delivery task hub projection", () => {
  it.each([
    ["ready", null, "ready"],
    ["working", "working", "working"],
    ["ready-for-review", "input-required", "waiting"],
    ["blocked", "working", "needs-attention"],
    ["complete", "completed", "complete"],
  ] as const)("groups Workroom=%s TaskRun=%s as %s", (workroomStatus, taskStatus, group) => {
    const row = projectDeliveryTaskHubRow(
      source({
        status: workroomStatus,
        taskRun: taskStatus
          ? {
              taskRunId: "TR-1",
              title: "Long review",
              status: taskStatus,
              routeContext: "/build",
              progressPayload: null,
              startedAt: new Date("2026-09-04T11:45:00.000Z"),
              completedAt: taskStatus === "completed" ? new Date("2026-09-04T11:58:00.000Z") : null,
              updatedAt: new Date("2026-09-04T11:58:00.000Z"),
              actionEnvelopes: [],
            }
          : null,
      }),
      now,
    );

    expect(row.group).toBe(group);
    expect(row.capsuleId).toBe("WC-123");
  });

  it("lets approval, failure, expiry, and source conflicts outrank optimistic state", () => {
    const approval = projectDeliveryTaskHubRow(
      source({
        status: "working",
        taskRun: {
          taskRunId: "TR-APPROVAL",
          title: "Review",
          status: "input-required",
          routeContext: "/build",
          progressPayload: { waitReason: "approval-required" },
          startedAt: new Date("2026-09-04T11:00:00.000Z"),
          completedAt: null,
          updatedAt: new Date("2026-09-04T11:59:00.000Z"),
          actionEnvelopes: [{
            id: "env-1",
            status: "proposed",
            createdAt: new Date("2026-09-04T11:59:00.000Z"),
            expiresAt: new Date("2026-09-04T12:10:00.000Z"),
          }],
        },
      }),
      now,
    );
    const conflict = projectDeliveryTaskHubRow(
      source({
        status: "working",
        taskRun: {
          taskRunId: "TR-DONE",
          title: "Done",
          status: "completed",
          routeContext: null,
          progressPayload: { percent: 100 },
          startedAt: new Date("2026-09-04T11:00:00.000Z"),
          completedAt: new Date("2026-09-04T11:58:00.000Z"),
          updatedAt: new Date("2026-09-04T11:58:00.000Z"),
          actionEnvelopes: [],
        },
      }),
      now,
    );
    const expiredLease = projectDeliveryTaskHubRow(
      source({ status: "working", leaseExpiresAt: new Date("2026-09-04T11:30:00.000Z") }),
      now,
    );

    expect(approval).toMatchObject({ group: "needs-attention", primaryAction: { label: "Review request" } });
    expect(conflict).toMatchObject({
      group: "needs-attention",
      freshness: "partial",
      verifiedResult: null,
    });
    expect(expiredLease).toMatchObject({ group: "needs-attention", primaryAction: { label: "Take over" } });
  });

  it("routes an approved envelope back to actionable input instead of asking for approval again", () => {
    const approved = projectDeliveryTaskHubRow(
      source({
        status: "working",
        taskRun: {
          taskRunId: "TR-APPROVED",
          title: "Resume approved work",
          status: "input-required",
          routeContext: "/build?taskRunId=TR-APPROVED",
          progressPayload: { waitReason: "input-required" },
          startedAt: new Date("2026-09-04T11:00:00.000Z"),
          completedAt: null,
          updatedAt: new Date("2026-09-04T11:59:00.000Z"),
          actionEnvelopes: [{
            id: "env-approved",
            status: "approved",
            createdAt: new Date("2026-09-04T11:58:00.000Z"),
            expiresAt: new Date("2026-09-04T12:10:00.000Z"),
          }],
        },
      }),
      now,
    );

    expect(approved).toMatchObject({
      group: "waiting",
      primaryAction: { label: "Resume", href: "/build?taskRunId=TR-APPROVED" },
    });
  });

  it("selects meaningful activity, safe links, owner, and an absent async-core seam", () => {
    const row = projectDeliveryTaskHubRow(
      source({
        activities: [
          { id: "a2", kind: "heartbeat", summary: "Still alive", recordedAt: new Date("2026-09-04T11:59:00.000Z") },
          { id: "a1", kind: "status-changed", summary: "Protected checks started", recordedAt: new Date("2026-09-04T11:58:00.000Z") },
        ],
      }),
      now,
    );
    const unsafe = projectDeliveryTaskHubRow(
      source({ pullRequestUrl: "http://attacker.invalid/OpenDigitalProductFactory/opendigitalproductfactory/pull/1" }),
      now,
    );

    expect(row).toMatchObject({
      ownerLabel: "thread-1",
      latestTransition: { id: "a1", summary: "Protected checks started" },
      inspectHref: "/build/work/WC-123",
      pullRequestHref: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5000",
      asyncOperation: { coreHandleAvailable: false },
    });
    expect(unsafe.pullRequestHref).toBeNull();
  });

  it("sanitizes progress without exposing arbitrary payload data", () => {
    expect(sanitizeDeliveryProgress({
      summary: "  Building images  ",
      completed: 3,
      total: 5,
      percent: 140,
      secretPrompt: "do not expose me",
      nextAction: "Approve the exact envelope",
    })).toEqual({
      summary: "Building images",
      completed: 3,
      total: 5,
      percent: 100,
      nextAction: "Approve the exact envelope",
    });
    expect(sanitizeDeliveryProgress({ completed: 8, total: 2, message: "x".repeat(600) })).toEqual({
      message: `${"x".repeat(237)}…`,
    });

    const partial = projectDeliveryTaskHubRow(source({
      taskRun: {
        taskRunId: "TR-PARTIAL",
        title: "Unsafe payload",
        status: "working",
        routeContext: null,
        progressPayload: { completed: 8, total: 2, secretPrompt: "never expose" },
        startedAt: new Date("2026-09-04T11:00:00.000Z"),
        completedAt: null,
        updatedAt: new Date("2026-09-04T11:59:00.000Z"),
        actionEnvelopes: [],
      },
    }), now);
    expect(partial).toMatchObject({ freshness: "partial", progress: null });
  });

  it("does not treat an unknown status containing success as affirmative verification", () => {
    const projected = projectDeliveryTaskHubRow(source({
      runtimeVerifications: [{
        verificationId: "RV-1",
        kind: "final-acceptance",
        status: "unsuccessful",
        result: null,
        completedAt: now,
        updatedAt: now,
      }],
    }), now);

    expect(projected.verifiedResult).toBeNull();
  });
});
