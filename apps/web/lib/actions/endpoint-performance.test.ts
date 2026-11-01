import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ send: vi.fn(), provider: vi.fn(), auth: vi.fn(), guard: vi.fn(), commission: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: m.guard }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: m.send } }));
vi.mock("@dpf/db", () => ({ prisma: { modelProvider: { findUnique: m.provider } } }));
vi.mock("@/lib/routing/subscription-calibration-admission", () => ({ commissionSubscriptionCalibration: m.commission }));
import { triggerDimensionEval } from "./endpoint-performance";
beforeEach(() => {
  vi.resetAllMocks(); m.guard.mockResolvedValue({ userId: "operator" });
  m.auth.mockResolvedValue({ user: { id: "operator", isSuperuser: true } });
  m.provider.mockResolvedValue({ authMethod: "oauth2_authorization_code" });
  m.commission.mockRejectedValue(new Error("Current selected-model capacity evidence is required."));
});
it("never queues an unbound legacy evaluation for an owned subscription", async () => {
  // No current commission/proof is available in this fixture. Refuse before enqueue.
  await expect(triggerDimensionEval("chatgpt", "selected")).rejects.toThrow("capacity evidence");
  expect(m.send).not.toHaveBeenCalled();
});
it("queues only the saved commission identity after current admission", async () => {
  m.commission.mockResolvedValue({ runId: "DE-exact" });
  await expect(triggerDimensionEval("chatgpt", "selected")).resolves.toMatchObject({ queued: true });
  expect(m.commission).toHaveBeenCalledWith("operator", "chatgpt", "selected");
  expect(m.send).toHaveBeenCalledExactlyOnceWith({ name: "ai/eval.run", data: {
    endpointId: "chatgpt", modelId: "selected", userId: "operator", force: true, calibrationRunId: "DE-exact" } });
});
it("refuses bulk subscription calibration before commissioning", async () => {
  await expect(triggerDimensionEval("chatgpt")).rejects.toThrow("Select one model");
  expect(m.commission).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
});
it("preserves service-provider evaluation without a subscription commission", async () => {
  m.provider.mockResolvedValue({ authMethod: "api_key" });
  await triggerDimensionEval("service", "selected");
  expect(m.commission).not.toHaveBeenCalled();
  expect(m.send.mock.calls[0][0].data).not.toHaveProperty("calibrationRunId");
});
