import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  platformDevConfigUpsert: vi.fn(),
  platformDevConfigFindUnique: vi.fn(),
  featureBuildCount: vi.fn(),
  backlogItemFindUnique: vi.fn(),
  backlogItemUpdate: vi.fn(),
  activityCreate: vi.fn(),
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
    backlogItem: {
      findUnique: (...a: unknown[]) => db.backlogItemFindUnique(...a),
      update: (...a: unknown[]) => db.backlogItemUpdate(...a),
    },
    backlogItemActivity: {
      create: (...a: unknown[]) => db.activityCreate(...a),
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  },
}));
vi.mock("@/lib/product-management/product-management-playbook-refresh", () => ({
  queueProductManagementPlaybookRefreshForBacklogItem: async () => undefined,
}));

import { demandScoringPack, stampValueInputSource } from "./demand-scoring-pack";
import { sandboxPoolSize } from "@/lib/build/wip-cap";

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
      sandboxPoolSize: sandboxPoolSize(),
      wipAdmissionMode: "shadow",
      capacityDrainEnabled: false,
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

  it("switches points-in-flight admission to enforce, and refuses an unknown mode", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({ backlogTeeUpDailyCap: 3, governedBacklogEnabled: true, wipAdmissionMode: "enforce" });
    const result = await setBudget({ wipAdmissionMode: "enforce" }, "user-1", undefined);
    expect(db.platformDevConfigUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { wipAdmissionMode: "enforce" } }));
    expect(result.data).toMatchObject({ wipAdmissionMode: "enforce" });
    const bad = await setBudget({ wipAdmissionMode: "off" }, "user-1", undefined);
    expect(bad.success).toBe(false);
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

  // BI-9AC1F99B: capacity drain (DI-5FED0D945EBB, opt-in) had no writer, so the
  // operator could only turn it on by editing the database.
  it("turns capacity drain on, leaving the other fields untouched, and echoes it", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({
      backlogTeeUpDailyCap: 3,
      governedBacklogEnabled: true,
      capacityDrainEnabled: true,
    });

    const result = await setBudget({ capacityDrainEnabled: true }, "user-1", undefined);

    expect(db.platformDevConfigUpsert).toHaveBeenCalledWith({
      where: { id: "singleton" },
      update: { capacityDrainEnabled: true },
      create: { id: "singleton", capacityDrainEnabled: true },
    });
    expect(result.data).toMatchObject({ capacityDrainEnabled: true });
    expect(result.message).toMatch(/capacity drain on/);
  });

  it("turns capacity drain off, and ignores a non-boolean value", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({ backlogTeeUpDailyCap: 3, governedBacklogEnabled: true, capacityDrainEnabled: false });
    await setBudget({ capacityDrainEnabled: false }, "user-1", undefined);
    expect(db.platformDevConfigUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { capacityDrainEnabled: false } }));

    db.platformDevConfigUpsert.mockClear();
    const ignored = await setBudget({ capacityDrainEnabled: "yes" }, "user-1", undefined);
    expect(db.platformDevConfigUpsert).not.toHaveBeenCalled();
    expect(ignored.data).toMatchObject({ capacityDrainEnabled: false });
  });

  it("declares capacityDrainEnabled in its schema and stays an authority-consequence tool", () => {
    const def = demandScoringPack.definitions.find((d) => d.name === "set_backlog_delivery_budget");
    const props = (def?.inputSchema as { properties: Record<string, { type: string }> }).properties;
    expect(props.capacityDrainEnabled?.type).toBe("boolean");
    expect((def as { consequence?: string }).consequence).toBe("authority");
    expect(def?.sideEffect).toBe(true);
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

  it("separates intake, admission and execution in its parallelism note (BI-3430B3A4)", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({
      backlogTeeUpDailyCap: 20,
      governedBacklogEnabled: true,
    });
    db.featureBuildCount.mockResolvedValue(5);

    const result = await setBudget({ dailyBudget: 20 }, "user-1", undefined);

    expect(result.message).toMatch(/5 Build Studio build\(s\) are active/);
    expect(result.message).toMatch(new RegExp(`sandbox pool executes ${sandboxPoolSize()} at a time`));
    expect(result.message).toMatch(/admitted by its portfolio's points in flight/);
    expect(result.message).not.toMatch(/WIP cap|BUILD_WIP_CAP/);
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
    const transitionProperties = transition?.inputSchema.properties as
      | Record<string, unknown>
      | undefined;
    expect(transitionProperties?.["to"]).toMatchObject({
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

describe("score_demand_item value-input provenance (BI-00C68162)", () => {
  const score = demandScoringPack.handlers["score_demand_item"]!;
  const item = {
    id: "row-1",
    itemId: "BI-1",
    demandStage: null,
    investmentBucket: null,
    workType: "feature",
    reach: null,
    impact: 1,
    confidence: 0.5,
    businessValue: null,
    timeCriticality: null,
    riskOpportunity: null,
    jobSize: null,
    occurrenceCount: 1,
    effortSize: "medium",
    estimateAiJobSize: 3,
    estimateHumanJobSize: null,
    estimateAgreed: null,
    demandInputSource: "ai",
  };

  beforeEach(() => {
    db.platformDevConfigFindUnique.mockResolvedValue(null);
    db.backlogItemFindUnique.mockResolvedValue(item);
    db.backlogItemUpdate.mockImplementation(async (a: unknown) => a);
    db.activityCreate.mockImplementation(async (a: unknown) => a);
  });

  it("a person overriding an agent-proposed score marks the inputs human (the steward then never re-proposes)", async () => {
    const result = await score({ itemId: "BI-1", impact: 3, confidence: 1 }, "user-owner", undefined);
    expect(result.success).toBe(true);
    const data = (db.backlogItemUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ impact: 3, confidence: 1, demandInputSource: "human", demandInputActorRef: "user-owner" });
    const payload = (db.activityCreate.mock.calls[0]![0] as { data: { payload: Record<string, unknown> } }).data.payload;
    expect(payload.inputSource).toBe("human");
  });

  it("an agent supplying inputs stays attributed to the agent", async () => {
    await score({ itemId: "BI-1", impact: 2 }, "user-1", { agentId: "AGT-WS-PORTFOLIO" });
    const data = (db.backlogItemUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ demandInputSource: "ai", demandInputActorRef: "AGT-WS-PORTFOLIO" });
  });

  it("a write with no value inputs leaves provenance alone", async () => {
    await score({ itemId: "BI-1", jobSize: 5 }, "user-owner", undefined);
    const data = (db.backlogItemUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("demandInputSource");
  });

  it("stampValueInputSource returns null when no value input is supplied", () => {
    expect(stampValueInputSource({ jobSize: 3 }, { userId: "u" })).toBeNull();
    expect(stampValueInputSource({ reach: 3 }, { userId: "u" })?.demandInputSource).toBe("human");
  });
});
