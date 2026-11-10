import { beforeEach, describe, expect, it, vi } from "vitest";
import { runGovernanceTriagePanel } from "./triage-panel-binding";
import { planTriageStaffing } from "./triage-staffing";

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(), start: vi.fn(), outcome: vi.fn(), endRun: vi.fn(), endTask: vi.fn(), orchestrate: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  Prisma: { DbNull: "db-null" },
  prisma: {
    decisionInteraction: { updateMany: mocks.reserve },
    deliberationOutcome: { findUnique: mocks.outcome },
    deliberationRun: { update: mocks.endRun },
    taskRun: { update: mocks.endTask },
  },
}));
vi.mock("@/lib/deliberation/orchestrator", () => ({ orchestrateDeliberation: mocks.orchestrate }));
vi.mock("@/lib/deliberation/start-run", () => ({ startDeliberationRun: mocks.start }));

const subject = {
  interactionRowId: "row", interactionId: "DI-1", profileId: "p",
  question: "Should we adopt this option?", domainClass: null, gateKey: null,
  riskTier: "medium", outcomeType: "escalate", resolved: false, updatedAt: new Date("2026-10-11"),
};
const input = {
  subject, plan: planTriageStaffing(subject), staffedAgentIds: [], userId: "u", optionIds: ["proceed"],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.orchestrate.mockResolvedValue({ deliberationRunId: "run", taskRunId: "task", consensusDecision: null });
  mocks.reserve.mockResolvedValue({ count: 1 });
  mocks.outcome.mockResolvedValue({ consensusState: "consensus", mergedRecommendation: '{"recommendedAction":"no_change"}' });
});

describe("panel reservation", () => {
  it("attaches the current case before any inference is dispatched", async () => {
    mocks.start.mockImplementation(async () => {
      expect(mocks.reserve).toHaveBeenCalledTimes(1);
      expect(mocks.outcome).not.toHaveBeenCalled();
    });
    expect(await runGovernanceTriagePanel(input)).toMatchObject({ deliberationRunId: "run" });
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deliberationRunId: null, updatedAt: subject.updatedAt, humanOutcome: { equals: "db-null" } }),
      data: { deliberationRunId: "run" },
    }));
  });

  it("does not dispatch a losing concurrent or stale case and closes its unused graph", async () => {
    mocks.reserve.mockResolvedValue({ count: 0 });
    expect(await runGovernanceTriagePanel(input)).toBeNull();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.endRun).toHaveBeenCalled();
    expect(mocks.endTask).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "canceled" }) }));
  });

  it("keeps the reservation visible if event dispatch fails, preventing a blind retry", async () => {
    mocks.start.mockRejectedValue(new Error("queue unavailable"));
    expect(await runGovernanceTriagePanel(input)).toBeNull();
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.endRun).not.toHaveBeenCalled();
  });

  it("can replace the previous completed panel when a changed case was admitted", async () => {
    await runGovernanceTriagePanel({ ...input, subject: { ...subject, previousPanel: { id: "old", completedAt: new Date(), brief: "old case" } } });
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deliberationRunId: "old" }) }));
  });
});
