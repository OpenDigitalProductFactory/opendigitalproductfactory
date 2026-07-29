import { describe, expect, it, vi } from "vitest";
import {
  createProductManagementChangeCollector,
  queueProductManagementPlaybookRefresh,
  type ProductManagementPlaybookRefreshDb,
} from "./product-management-playbook-refresh";
import {
  buildPlaybookPermissionDigest,
  getProductManagementPlaybook,
} from "./product-management-playbook";

const recipe = getProductManagementPlaybook("outcome-review");
const config = {
  schemaVersion: 1,
  recipeId: recipe.id,
  permissionsDigest: buildPlaybookPermissionDigest(recipe),
  minimumRefreshMinutes: 60,
};
const now = new Date("2026-07-28T12:00:00Z");

function db(
  tasks: Array<Record<string, unknown>>,
): ProductManagementPlaybookRefreshDb {
  return {
    scheduledAgentTask: {
      findMany: vi.fn().mockResolvedValue(tasks),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    scheduledJob: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe("queueProductManagementPlaybookRefresh", () => {
  it("defers refresh side effects until the enclosing transaction has committed", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const collector = createProductManagementChangeCollector(refresh);
    const change = {
      organizationId: "org-1",
      businessProductId: "product-1",
      sourceKind: "product-sold" as const,
      sourceId: "PS-ONE",
      changedAt: now,
    };

    await collector.collect(change);

    expect(refresh).not.toHaveBeenCalled();

    await collector.flush();

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(change);
  });

  it("queues relevant organization, line, and Product tasks once", async () => {
    const client = db([
      {
        taskId: "org-task",
        taskConfig: config,
        nextRunAt: new Date("2026-08-01T12:00:00Z"),
      },
      {
        taskId: "line-task",
        taskConfig: config,
        nextRunAt: new Date("2026-08-01T12:00:00Z"),
      },
    ]);
    const result = await queueProductManagementPlaybookRefresh(
      {
        organizationId: "org-1",
        productLineId: "line-1",
        businessProductId: "product-1",
        sourceKind: "product-objective-observation",
        sourceId: "observation-1",
        changedAt: now,
      },
      client,
    );

    expect(result).toEqual({
      inspected: 2,
      queued: 2,
      skipped: 0,
    });
    expect(client.scheduledAgentTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          taskKind: "product-management-playbook",
          isActive: true,
          OR: expect.arrayContaining([
            { productLineId: null, businessProductId: null },
            { productLineId: "line-1", businessProductId: null },
            { businessProductId: "product-1" },
          ]),
        }),
      }),
    );
    expect(client.scheduledAgentTask.updateMany).toHaveBeenCalledTimes(2);
    expect(client.scheduledJob.updateMany).toHaveBeenCalledTimes(2);
  });

  it("skips irrelevant, duplicate, and rate-limited changes", async () => {
    const changeKey =
      "product-objective-observation:observation-1:2026-07-28T12:00:00.000Z";
    const client = db([
      {
        taskId: "irrelevant",
        taskConfig: {
          ...config,
          recipeId: "weekly-intelligence",
          permissionsDigest: buildPlaybookPermissionDigest(
            getProductManagementPlaybook("weekly-intelligence"),
          ),
        },
        nextRunAt: null,
      },
      {
        taskId: "duplicate",
        taskConfig: {
          ...config,
          lastRefreshQueuedAt: "2026-07-28T10:00:00.000Z",
          lastRefreshChangeKey: changeKey,
        },
        nextRunAt: null,
      },
      {
        taskId: "rate-limited",
        taskConfig: {
          ...config,
          lastRefreshQueuedAt: "2026-07-28T11:30:00.000Z",
        },
        nextRunAt: null,
      },
    ]);
    const result = await queueProductManagementPlaybookRefresh(
      {
        organizationId: "org-1",
        productLineId: "line-1",
        businessProductId: "product-1",
        sourceKind: "product-objective-observation",
        sourceId: "observation-1",
        changedAt: now,
      },
      client,
    );
    expect(result).toEqual({ inspected: 3, queued: 0, skipped: 3 });
    expect(client.scheduledAgentTask.updateMany).not.toHaveBeenCalled();
  });
});
