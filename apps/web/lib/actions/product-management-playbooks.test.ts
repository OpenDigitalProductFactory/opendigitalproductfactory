import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPlaybookPermissionDigest,
  getProductManagementPlaybook,
} from "@/lib/product-management/product-management-playbook";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  schedule: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock(
  "@/lib/product-management/current-product-operating-context.server",
  () => ({ loadCurrentProductOperatingContextByKey: mocks.load }),
);
vi.mock("@/lib/operate/scheduled-jobs/agent-task-core", () => ({
  scheduleAgentTaskFor: mocks.schedule,
}));

import { scheduleProductManagementPlaybookAction } from "./product-management-playbooks";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.load.mockResolvedValue({
    scope: { kind: "product", id: "product-1" },
    provider: { id: "org-1" },
  });
  mocks.schedule.mockResolvedValue({
    success: true,
    taskId: "agent-task-pm",
  });
});

describe("scheduleProductManagementPlaybookAction", () => {
  it("refuses scheduling until the current permission boundary is previewed", async () => {
    const result = await scheduleProductManagementPlaybookAction({
      scope: { kind: "product", id: "product-1" },
      recipeId: "roadmap-refresh",
      approvedPermissionsDigest: "old",
      schedule: "0 9 * * 4",
    });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Preview it again/i),
    });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("authorizes the exact Product scope and uses the existing scheduler", async () => {
    const recipe = getProductManagementPlaybook("roadmap-refresh");
    const result = await scheduleProductManagementPlaybookAction({
      scope: { kind: "product", id: "product-1" },
      recipeId: recipe.id,
      approvedPermissionsDigest: buildPlaybookPermissionDigest(recipe),
      schedule: recipe.recommendedSchedule.cron,
    });
    expect(result).toMatchObject({ ok: true, taskId: "agent-task-pm" });
    expect(mocks.load).toHaveBeenCalledWith("product", "product-1");
    expect(mocks.schedule).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        agentId: "portfolio-advisor",
        organizationId: "org-1",
        productLineId: null,
        businessProductId: "product-1",
        taskKind: "product-management-playbook",
        taskConfig: expect.objectContaining({
          schemaVersion: 1,
          recipeId: "roadmap-refresh",
          permissionsDigest: buildPlaybookPermissionDigest(recipe),
        }),
      }),
    );
  });
});
