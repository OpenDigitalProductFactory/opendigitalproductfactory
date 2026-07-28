import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  platformDevConfigUpsert: vi.fn(),
  platformDevConfigFindUnique: vi.fn(),
  featureBuildCount: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: {
      upsert: (...a: unknown[]) => db.platformDevConfigUpsert(...a),
      findUnique: (...a: unknown[]) => db.platformDevConfigFindUnique(...a),
    },
    featureBuild: {
      count: (...a: unknown[]) => db.featureBuildCount(...a),
    },
  },
}));

import { demandScoringPack } from "./demand-scoring-pack";
import { BUILD_WIP_CAP } from "@/lib/build/wip-cap";

const setBudget = demandScoringPack.handlers["set_backlog_delivery_budget"]!;

beforeEach(() => {
  vi.clearAllMocks();
  db.platformDevConfigUpsert.mockResolvedValue({});
  db.featureBuildCount.mockResolvedValue(0);
});

describe("set_backlog_delivery_budget", () => {
  it("is registered with backlog_write and a matching grant", () => {
    const def = demandScoringPack.definitions.find((d) => d.name === "set_backlog_delivery_budget");
    expect(def?.requiredCapability).toBe("manage_backlog");
    expect(demandScoringPack.grants["set_backlog_delivery_budget"]).toEqual(["backlog_write"]);
  });

  it("with no fields, reads current state without writing", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({
      backlogTeeUpDailyCap: 7,
      governedBacklogEnabled: true,
    });
    db.featureBuildCount.mockResolvedValue(1);

    const result = await setBudget({}, "user-1", undefined);

    expect(db.platformDevConfigUpsert).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      dailyBudget: 7,
      enabled: true,
      activeBuilds: 1,
      buildWipCap: BUILD_WIP_CAP,
    });
    expect(result.message).toMatch(/^Backlog delivery budget is 7\/day/);
  });

  it("sets dailyBudget, leaving enabled untouched", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({
      backlogTeeUpDailyCap: 15,
      governedBacklogEnabled: true,
    });

    const result = await setBudget({ dailyBudget: 15 }, "user-1", undefined);

    expect(db.platformDevConfigUpsert).toHaveBeenCalledWith({
      where: { id: "singleton" },
      update: { backlogTeeUpDailyCap: 15 },
      create: { id: "singleton", backlogTeeUpDailyCap: 15 },
    });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/^Backlog delivery budget set to 15\/day/);
  });

  it("sets enabled, leaving dailyBudget untouched", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({
      backlogTeeUpDailyCap: 3,
      governedBacklogEnabled: false,
    });

    await setBudget({ enabled: false }, "user-1", undefined);

    expect(db.platformDevConfigUpsert).toHaveBeenCalledWith({
      where: { id: "singleton" },
      update: { governedBacklogEnabled: false },
      create: { id: "singleton", governedBacklogEnabled: false },
    });
  });

  it("rejects a dailyBudget outside 0-50 without writing", async () => {
    const tooHigh = await setBudget({ dailyBudget: 51 }, "user-1", undefined);
    expect(tooHigh.success).toBe(false);
    expect(tooHigh.error).toBe("invalid_input");

    const negative = await setBudget({ dailyBudget: -1 }, "user-1", undefined);
    expect(negative.success).toBe(false);
    expect(negative.error).toBe("invalid_input");

    expect(db.platformDevConfigUpsert).not.toHaveBeenCalled();
  });

  it("falls back to the schema defaults when no PlatformDevConfig row exists yet", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue(null);

    const result = await setBudget({}, "user-1", undefined);

    expect(result.data).toMatchObject({ dailyBudget: 3, enabled: false });
  });

  it("warns when the shared Build Studio sandbox is already at its WIP cap", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({
      backlogTeeUpDailyCap: 20,
      governedBacklogEnabled: true,
    });
    db.featureBuildCount.mockResolvedValue(BUILD_WIP_CAP);

    const result = await setBudget({ dailyBudget: 20 }, "user-1", undefined);

    expect(result.message).toMatch(/already at its.*execution limit/);
    expect(result.message).toMatch(/external worktree builds/);
  });

  it("does not report a saturation warning with headroom under the WIP cap", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({
      backlogTeeUpDailyCap: 10,
      governedBacklogEnabled: true,
    });
    db.featureBuildCount.mockResolvedValue(BUILD_WIP_CAP - 1);

    const result = await setBudget({ dailyBudget: 10 }, "user-1", undefined);

    expect(result.message).not.toMatch(/already at its/);
    expect(result.message).toMatch(new RegExp(`${BUILD_WIP_CAP - 1}/${BUILD_WIP_CAP} of Build Studio's shared-sandbox`));
  });
});

describe("evidence-backed demand activation tools", () => {
  it("registers one governed tool per write and reserves ready for funding", () => {
    for (const name of [
      "transition_demand_item",
      "link_demand_evidence",
      "supersede_demand_evidence",
    ]) {
      expect(demandScoringPack.definitions.find((d) => d.name === name)).toMatchObject({
        requiredCapability: "manage_backlog",
        sideEffect: true,
      });
      expect(demandScoringPack.grants[name]).toEqual(["backlog_write"]);
    }
    const transition = demandScoringPack.definitions.find(
      (d) => d.name === "transition_demand_item",
    );
    expect(transition?.inputSchema.properties?.["to"]).toMatchObject({
      enum: ["raw", "screened", "shaped"],
    });
  });

  it("does not let score_demand_item override lifecycle stage", () => {
    const score = demandScoringPack.definitions.find(
      (d) => d.name === "score_demand_item",
    );
    expect(score?.inputSchema.properties).not.toHaveProperty("demandStage");
  });
});
