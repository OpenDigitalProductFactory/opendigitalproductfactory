import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agents: vi.fn(), configs: vi.fn(), snapshot: vi.fn(), project: vi.fn(),
  upsert: vi.fn(), resolve: vi.fn(), notify: vi.fn(), owner: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  agent: { findMany: mocks.agents }, agentModelConfig: { findMany: mocks.configs },
} }));
vi.mock("./route-readiness", () => ({
  loadCoworkerRoutingReadinessSnapshot: mocks.snapshot,
  projectCoworkerRouteReadiness: mocks.project,
}));
vi.mock("@/lib/observability/health-alert-issue", () => ({
  upsertHealthAlertIssue: mocks.upsert, resolveHealthAlertIssue: mocks.resolve,
  healthAlertIssueKey: (labels: { alertname: string }) => labels.alertname,
}));
vi.mock("@/lib/attention/notify-live", () => ({
  notifyAttentionLive: mocks.notify, resolveOperatorRecipient: mocks.owner,
}));
import { runRoutingReachabilityPreflight } from "./routing-reachability-preflight";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.agents.mockResolvedValue([{ agentId: "AGT-EA", displayName: "Architect", sensitivity: "internal" }]);
  mocks.configs.mockResolvedValue([]);
  mocks.snapshot.mockResolvedValue({});
  mocks.owner.mockResolvedValue("owner");
  mocks.resolve.mockResolvedValue(undefined);
});

describe("scheduled routing monitoring", () => {
  it("detects a sensitive-work dead end before the owner submits a request", async () => {
    mocks.project.mockResolvedValue({ ready: true, reason: "Ready", escalated: {
      ready: false, sensitivity: "restricted", reason: "No eligible private endpoint",
    } });
    const result = await runRoutingReachabilityPreflight();
    expect(result.blocked).toEqual([]);
    expect(result.escalationBlocked).toHaveLength(1);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      labels: expect.objectContaining({ alertname: "CoworkerSensitiveRoutingUnreachable", severity: "warning" }),
      annotations: expect.objectContaining({ description: expect.stringContaining("restricted: No eligible private endpoint") }),
    }));
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner", itemKey: "routing-preflight-sensitive", riskClass: "medium",
    }));
    expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), "CoworkerRoutingUnreachable");
  });

  it("retains the critical issue for ordinary route failures", async () => {
    mocks.project.mockResolvedValue({ ready: false, reason: "No model" });
    const result = await runRoutingReachabilityPreflight();
    expect(result.blocked).toHaveLength(1);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      labels: expect.objectContaining({ alertname: "CoworkerRoutingUnreachable", severity: "critical" }),
    }));
  });

  it("clears both issues when route readiness recovers", async () => {
    mocks.project.mockResolvedValue({ ready: true, reason: "Ready", escalated: { ready: true, sensitivity: "restricted", reason: "Ready" } });
    await runRoutingReachabilityPreflight();
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("reports failed issue resolution instead of recording false success", async () => {
    mocks.project.mockResolvedValue({ ready: true, reason: "Ready" });
    mocks.resolve.mockRejectedValue(new Error("issue storage unavailable"));
    await expect(runRoutingReachabilityPreflight()).rejects.toThrow("issue storage unavailable");
  });
});
