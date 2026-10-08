// BI-A0BFA63E: an accepted coworker handoff records its DelegationChain link id
// on the child's collaboration provenance, so the child's return can close it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockSpawn } = vi.hoisted(() => ({
  mockPrisma: {
    agent: { findFirst: vi.fn() },
    principalAlias: { findFirst: vi.fn() },
    delegationChain: { create: vi.fn() },
    taskRun: { update: vi.fn() },
  },
  mockSpawn: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/agent-event-bus", () => ({ agentEventBus: { emit: vi.fn() } }));
vi.mock("@/lib/actions/agent-coworker", () => ({ spawnWorkThread: mockSpawn }));
vi.mock("@/lib/tak/agent-resolution", () => ({
  resolveAgent: vi.fn(async () => ({ agentId: "agent-mkt", slugId: null, name: "Marketing" })),
}));
vi.mock("@/lib/coworker-lifecycle/lifecycle-gate", () => ({
  evaluateLifecycleGate: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("./convene-clearance", () => ({
  decideConveneClearance: () => ({ permitted: true }),
  clearanceForPrincipal: () => "internal",
  conveneDenialAuditReason: () => "denied",
  CONVENE_DENIED_MESSAGE: "denied",
}));

import { requestCoworker } from "./coworker-collaboration";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.agent.findFirst.mockResolvedValue({ agentId: "coo", delegatesTo: ["agent-mkt"], escalatesTo: null, sensitivity: null });
  mockPrisma.principalAlias.findFirst.mockResolvedValue(null);
  mockPrisma.delegationChain.create.mockResolvedValue({ id: "link-1" });
  mockPrisma.taskRun.update.mockResolvedValue({});
  mockSpawn.mockResolvedValue({ child: { id: "child-1" }, taskRunId: "TR-1" });
});

describe("requestCoworker delegation link", () => {
  it("stores the accepted hop's link id on the child's provenance", async () => {
    await requestCoworker(
      { parentThreadId: "parent-1", targetAgent: "agent-mkt", objective: "Draft the post", callerAgentId: "coo" },
      "user-1",
    );

    expect(mockPrisma.delegationChain.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "active", fromAgentId: "coo", toAgentId: "agent-mkt" }),
    }));
    expect(mockPrisma.taskRun.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-1" },
      data: { a2aMetadata: { collaboration: expect.objectContaining({ delegationLinkId: "link-1" }) } },
    });
  });

  it("records no link id when the hop write fails", async () => {
    mockPrisma.delegationChain.create.mockRejectedValue(new Error("db down"));
    await requestCoworker(
      { parentThreadId: "parent-1", targetAgent: "agent-mkt", objective: "Draft the post", callerAgentId: "coo" },
      "user-1",
    );
    const collaboration = mockPrisma.taskRun.update.mock.calls[0]?.[0].data.a2aMetadata.collaboration;
    expect(collaboration).not.toHaveProperty("delegationLinkId");
  });
});
