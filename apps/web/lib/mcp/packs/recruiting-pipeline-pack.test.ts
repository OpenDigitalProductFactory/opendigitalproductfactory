import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRecruitingPipeline } = vi.hoisted(() => ({ getRecruitingPipeline: vi.fn() }));

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/recruiting/pipeline-read-model", () => ({ getRecruitingPipeline }));

import { recruitingPipelinePack } from "./recruiting-pipeline-pack";

describe("recruitingPipelinePack", () => {
  beforeEach(() => getRecruitingPipeline.mockReset());

  it("declares one read-only get_recruiting_pipeline tool with the mirrored grant", () => {
    expect(recruitingPipelinePack.packId).toBe("recruiting-pipeline");
    expect(recruitingPipelinePack.definitions).toHaveLength(1);
    const def = recruitingPipelinePack.definitions[0];
    expect(def.name).toBe("get_recruiting_pipeline");
    expect(def.sideEffect).toBe(false);
    expect(def.annotations?.readOnlyHint).toBe(true);
    expect(def.requiredCapability).toBe("view_employee");
    expect(recruitingPipelinePack.grants?.get_recruiting_pipeline).toEqual([
      "consumer_read",
      "registry_read",
    ]);
  });

  it("summarizes the funnel counts and returns the pipeline data", async () => {
    getRecruitingPipeline.mockResolvedValue({
      items: [
        { id: "a1", source: "native", displayName: "N", status: "active", stage: null, externalId: null },
        { id: "greenhouse:g1", source: "greenhouse", displayName: "G", status: null, stage: null, externalId: "g1" },
      ],
      counts: { native: 1, greenhouse: 1, total: 2 },
    });

    const handler = recruitingPipelinePack.handlers.get_recruiting_pipeline;
    const result = await handler({ requisitionId: "req-1" }, "u1", {} as never);

    expect(getRecruitingPipeline).toHaveBeenCalledWith({}, { requisitionId: "req-1" });
    expect(result.success).toBe(true);
    expect(result.message).toContain("2 in the funnel");
    expect(result.message).toContain("1 native");
    expect((result.data as { counts: { total: number } }).counts.total).toBe(2);
  });

  it("passes undefined requisitionId when the arg is absent", async () => {
    getRecruitingPipeline.mockResolvedValue({ items: [], counts: { native: 0, greenhouse: 0, total: 0 } });
    const handler = recruitingPipelinePack.handlers.get_recruiting_pipeline;
    await handler({}, "u1", {} as never);
    expect(getRecruitingPipeline).toHaveBeenCalledWith({}, { requisitionId: undefined });
  });
});
