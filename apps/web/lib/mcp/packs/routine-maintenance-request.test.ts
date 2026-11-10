import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stance: vi.fn(), request: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/install/instance-stance", () => ({
  loadInstanceStance: mocks.stance,
  prismaInstanceStanceStore: () => ({}),
}));
vi.mock("@/lib/self-upgrade/request", () => ({ requestSelfUpgrade: mocks.request }));

import { resolveCallConsequence } from "@/lib/tool-consequence";
import { resolveEscalation } from "@/lib/govern/authority/escalation-gate";
import { selfUpgradePack } from "./self-upgrade-pack";
import { demandScoringPack } from "./demand-scoring-pack";

const upgrade = selfUpgradePack.definitions.find((t) => t.name === "request_self_upgrade")!;
const budget = demandScoringPack.definitions.find((t) => t.name === "set_backlog_delivery_budget")!;
const classify = (tool: typeof upgrade, params: Record<string, unknown>) =>
  resolveCallConsequence(tool, { toolName: tool.name, params, userId: "owner" });

describe("delegated routine requests and reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stance.mockResolvedValue({ environmentClass: "development", primaryPurpose: "evolve-dpf" });
  });

  it.each([{}, { reason: "merged emergency repair" }])("classifies a governed DEV request as ordinary: %j", async (params) => {
    expect((await classify(upgrade, params)).consequence).toBeNull();
  });

  it.each([
    { environmentClass: "production", primaryPurpose: "evolve-dpf" },
    { environmentClass: "staging", primaryPurpose: "evolve-dpf" },
    { environmentClass: "development", primaryPurpose: "operate-business" },
    {},
  ])("retains the upgrade floor for an unproven development/evolve-dpf stance: %j", async (stance) => {
    mocks.stance.mockResolvedValue(stance);
    expect((await classify(upgrade, {})).consequence).toBe("irreversible");
  });

  it("fails closed when canonical stance cannot be read", async () => {
    mocks.stance.mockRejectedValue(new Error("unavailable"));
    expect((await classify(upgrade, {})).consequence).toBe("irreversible");
  });

  it.each([{ force: true }, { actorKind: "operator" }, { bypassWindow: true }, { environmentClass: "development" }, { reason: 1 }])("retains the floor for override, caller stance or malformed input: %j", async (params) => {
    expect((await classify(upgrade, params)).consequence).toBe("irreversible");
  });

  it.each(["deferred_to_window", "human_override_required", "batch_below_threshold"])("still delegates admission to the agent pipeline: %s", async (status) => {
    mocks.request.mockResolvedValue({ status, message: "existing admission result" });
    const result = await selfUpgradePack.handlers.request_self_upgrade!({ reason: "repair" }, "owner");
    expect(mocks.request).toHaveBeenCalledWith({ requestedBy: "mcp:repair", actorKind: "agent" });
    expect(result.data).toMatchObject({ status });
  });

  it("reads the budget without classifying the read as authority", async () => {
    expect((await classify(budget, {})).consequence).toBeNull();
  });

  it.each([{ dailyBudget: 5 }, { enabled: true }, { capacityDrainEnabled: true }, { wipAdmissionMode: "enforce" }, { dailyBudget: null }, { unknown: true }])("retains authority for nonempty budget input: %j", async (params) => {
    expect((await classify(budget, params)).consequence).toBe("authority");
  });

  it("requires current delegation after refinement", async () => {
    const consequence = (await classify(upgrade, {})).consequence;
    const base = { action: { sideEffect: true, executionMode: "immediate" as const, consequence }, dataPolicy: { sensitivity: "internal" as const }, operatorRequiresApproval: true };
    expect(resolveEscalation({ ...base, steering: "connection-delegation" }).verdict).toBe("automated");
    expect(resolveEscalation({ ...base, steering: "none" }).verdict).toBe("human");
    expect(resolveEscalation({ ...base, steering: "connection-delegation", proposeBoundary: true }).verdict).toBe("human");
    const repair = selfUpgradePack.definitions.find((t) => t.name === "repair_promoter_image")!;
    expect((await classify(repair, {})).consequence).toBe("irreversible");
  });
});
