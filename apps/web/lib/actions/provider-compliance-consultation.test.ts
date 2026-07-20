import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProviderReviewPacket } from "@/lib/routing/provider-suitability/provider-review-packet";

const {
  requireUserMock,
  resolveAgentForRouteWithPromptsMock,
  requestCoworkerMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  resolveAgentForRouteWithPromptsMock: vi.fn(),
  requestCoworkerMock: vi.fn(),
  prismaMock: {
    agentThread: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    aiProviderConnection: { findMany: vi.fn() },
    agentMessage: { create: vi.fn() },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: prismaMock }));
vi.mock("./shared/guards", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/feature-flags", () => ({ isUnifiedCoworkerEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/tak/agent-routing-server", () => ({
  resolveAgentForRouteWithPrompts: resolveAgentForRouteWithPromptsMock,
}));
vi.mock("@/lib/tak/coworker-collaboration", () => ({ requestCoworker: requestCoworkerMock }));

import { startProviderComplianceConsultation } from "./provider-compliance-consultation";

const packet = buildProviderReviewPacket({
  businessProfile: {
    organizationId: "org-1",
    archetypeId: null,
    archetypeCategory: "software",
    operatesIn: ["eu"],
    sellsTo: ["eu"],
    employsIn: [],
    dataResidency: ["eu"],
    riskPosture: "conservative",
  },
  recommendation: {
    status: "review-needed",
    workloadClasses: ["customer-records"],
    items: [{
      providerConnectionId: "conn-1",
      providerId: "openai",
      scope: "public-only",
    }],
  },
});

describe("startProviderComplianceConsultation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ id: "user-1", platformRole: "OPS-100", isSuperuser: false });
    prismaMock.agentThread.findFirst.mockResolvedValue({ id: "thread-1" });
    prismaMock.organization.findFirst.mockResolvedValue({ id: "org-1" });
    prismaMock.aiProviderConnection.findMany.mockResolvedValue([
      { connectionId: "conn-1", providerId: "openai" },
    ]);
    prismaMock.agentMessage.create.mockResolvedValue({ id: "message-1" });
    resolveAgentForRouteWithPromptsMock.mockResolvedValue({ agentId: "coo", agentName: "COO" });
    requestCoworkerMock.mockResolvedValue({
      childThreadId: "child-1",
      taskRunId: "task-1",
      targetAgentId: "AGT-902",
      targetLabel: "Data Governance Agent",
    });
  });

  it("derives the route COO and dispatches the validated packet only to AGT-902", async () => {
    const result = await startProviderComplianceConsultation({
      parentThreadId: "thread-1",
      routeContext: "/workspace",
      packet,
    });

    expect(resolveAgentForRouteWithPromptsMock).toHaveBeenCalledWith(
      "/workspace",
      { platformRole: "OPS-100", isSuperuser: false },
      true,
    );
    expect(requestCoworkerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parentThreadId: "thread-1",
        targetAgent: "AGT-902",
        callerAgentId: "coo",
        routeContext: "/workspace",
        questionPacketSummary: "Reviewing provider compliance and sovereignty",
        objective: expect.stringContaining("provider-compliance-review.v1"),
      }),
      "user-1",
    );
    expect(prismaMock.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: "thread-1",
        role: "user",
        agentId: "coo",
        routeContext: "/workspace",
      }),
    });
    expect(result).toEqual({
      success: true,
      childThreadId: "child-1",
      taskRunId: "task-1",
    });
  });

  it("rejects unknown packet fields before writing or dispatching", async () => {
    const result = await startProviderComplianceConsultation({
      parentThreadId: "thread-1",
      routeContext: "/workspace",
      packet: { ...packet, credentials: { apiKey: "secret" } } as never,
    });

    expect(result).toEqual({ success: false, error: "packet_unknown_field:credentials" });
    expect(prismaMock.agentMessage.create).not.toHaveBeenCalled();
    expect(requestCoworkerMock).not.toHaveBeenCalled();
  });

  it("rejects connection references outside the current organization", async () => {
    prismaMock.aiProviderConnection.findMany.mockResolvedValue([]);

    const result = await startProviderComplianceConsultation({
      parentThreadId: "thread-1",
      routeContext: "/workspace",
      packet,
    });

    expect(result).toEqual({ success: false, error: "provider_connection_reference_mismatch" });
    expect(requestCoworkerMock).not.toHaveBeenCalled();
  });

  it("delivers cited deterministic guidance when governed A2A cannot start", async () => {
    requestCoworkerMock.mockRejectedValue(new Error("specialist unavailable"));

    const result = await startProviderComplianceConsultation({
      parentThreadId: "thread-1",
      routeContext: "/workspace",
      packet,
    });

    expect(result).toEqual({
      success: false,
      error: "provider_consultation_fallback_delivered",
    });
    expect(prismaMock.agentMessage.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        threadId: "thread-1",
        role: "assistant",
        agentId: "coo",
        routeContext: "/workspace",
        providerId: "deterministic-corpus",
        modelId: "professions/legal-compliance/ai-provider-account-and-sovereignty-review@v1",
        taskType: "provider-compliance-local-only.v1",
        content: expect.stringMatching(/My recommendation: insufficient-evidence[\s\S]*References[\s\S]*ai-provider-account-and-sovereignty-review/),
      }),
    });
    expect(prismaMock.agentMessage.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: expect.stringContaining("could not start the compliance consultation"),
      }),
    });
  });
});
