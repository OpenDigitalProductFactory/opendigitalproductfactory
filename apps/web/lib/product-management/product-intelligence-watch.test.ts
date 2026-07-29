import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_INTELLIGENCE_WATCH_TASK_KIND,
  createProductIntelligenceWatch,
  proposeProductIntelligenceWatch,
} from "./product-intelligence-watch";

describe("createProductIntelligenceWatch", () => {
  it("uses the canonical scheduler with typed scope and config", async () => {
    const schedule = vi.fn(async () => ({
      success: true as const,
      taskId: "agent-task-watch",
    }));

    await expect(
      createProductIntelligenceWatch(
        {
          ownerUserId: "user-1",
          organizationId: "org-1",
          businessProductId: "product-1",
          title: "Watch salon-service competitors",
          topic: "competitive-landscape",
          query: "Changes in local salon-service competitors",
          schedule: "0 9 * * 1",
        },
        { schedule },
      ),
    ).resolves.toEqual({ success: true, taskId: "agent-task-watch" });

    expect(schedule).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        agentId: "marketing-specialist",
        taskKind: PRODUCT_INTELLIGENCE_WATCH_TASK_KIND,
        organizationId: "org-1",
        productLineId: null,
        businessProductId: "product-1",
        taskConfig: {
          topic: "competitive-landscape",
          query: "Changes in local salon-service competitors",
        },
      }),
    );
  });
});

describe("proposeProductIntelligenceWatch", () => {
  it("creates only a pending proposal at cadence", async () => {
    const propose = vi.fn(async () => ({
      proposalId: "rp-1",
      created: true,
    }));
    const refresh = vi.fn(async () => undefined);

    await expect(
      proposeProductIntelligenceWatch(
        {
          taskKind: PRODUCT_INTELLIGENCE_WATCH_TASK_KIND,
          organizationId: "org-1",
          productLineId: "line-1",
          businessProductId: null,
          taskConfig: {
            topic: "competitive-landscape",
            query: "Changes in regional conference demand",
          },
        },
        { propose, refresh },
      ),
    ).resolves.toEqual({ proposalId: "rp-1", created: true });

    expect(propose).toHaveBeenCalledWith({
      organizationId: "org-1",
      productLineId: "line-1",
      businessProductId: null,
      topic: "competitive-landscape",
      query: "Changes in regional conference demand",
      proposedBy: "schedule",
    });
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        productLineId: "line-1",
        sourceKind: "research-proposal",
        sourceId: "rp-1",
      }),
    );
  });

  it("fails closed on missing typed config instead of parsing the prompt", async () => {
    const propose = vi.fn();
    await expect(
      proposeProductIntelligenceWatch(
        {
          taskKind: PRODUCT_INTELLIGENCE_WATCH_TASK_KIND,
          organizationId: "org-1",
          productLineId: null,
          businessProductId: "product-1",
          taskConfig: null,
        },
        { propose },
      ),
    ).rejects.toThrow(/configuration/i);
    expect(propose).not.toHaveBeenCalled();
  });
});
