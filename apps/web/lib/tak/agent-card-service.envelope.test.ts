// BI-7BCC87BB (founder decision DI-FFD78D222548, envelope-shared-buttons): the
// agent card's "latest pending" covers legacy proposals and approval requests
// (envelopes) alike, and names whichever is newest. A pending envelope is
// decided with the shared Authorize / Decline against the envelope routes; a
// legacy proposal keeps the v1 decision endpoint until PR-C converts it.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), findMany: vi.fn() },
    agentActionProposal: { findMany: vi.fn() },
    coworkerActionEnvelope: { findMany: vi.fn(), groupBy: vi.fn() },
    user: { findMany: vi.fn() },
    toolExecution: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/identity/aidoc-resolver", () => ({ resolveAIDocForAgent: vi.fn(async () => null) }));

import { prisma } from "@dpf/db";

import { listInternalAgentCards } from "./agent-card-service";

const AGENT = {
  agentId: "AGT-OPS", name: "Ops", description: null, status: "active", lifecycleStage: "production",
  sensitivity: "internal", hitlTierDefault: 2, executionConfig: null, governanceProfile: null, skills: [], toolGrants: [],
};
const PROPOSAL = {
  id: "prop-row-1", proposalId: "prop-1", threadId: "thread-1", messageId: "msg-1", agentId: "AGT-OPS",
  actionType: "run_discovery_triage", parameters: {}, proposedAt: new Date("2026-10-06T09:00:00.000Z"),
};
const ENVELOPE = {
  id: "env-1", coworkerAgentId: "AGT-OPS", delegatingUserId: "owner-1", manifestActionId: "run_discovery_triage",
  rationale: "This coworker is set to propose, not act.", createdAt: new Date("2026-10-07T09:00:00.000Z"),
  expiresAt: new Date("2099-01-01T00:00:00.000Z"), // clock-bomb-guard: allow pass-through fixture; the code under test never compares it to the clock
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.agent.findMany).mockResolvedValue([AGENT] as never);
  vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "owner-1", email: "owner@x.test" }] as never);
  vi.mocked(prisma.coworkerActionEnvelope.groupBy).mockResolvedValue([{ coworkerAgentId: "AGT-OPS", _count: { _all: 1 } }] as never);
});

describe("agent card — latest pending proposal or envelope", () => {
  it("names a newer envelope as the latest pending, with the envelope routes and its owner", async () => {
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([PROPOSAL] as never);
    vi.mocked(prisma.coworkerActionEnvelope.findMany).mockResolvedValue([ENVELOPE] as never);

    const [card] = await listInternalAgentCards();
    const state = card!.extensions.tak.authority.supervisorDecisionState;

    expect(prisma.coworkerActionEnvelope.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ coworkerAgentId: { in: ["AGT-OPS"] }, status: "proposed" }),
      orderBy: { createdAt: "desc" },
      distinct: ["coworkerAgentId"],
    }));
    expect(state.pendingProposalCount).toBe(1);
    expect(state.pendingEnvelopeCount).toBe(1);
    expect(state.latestPendingKind).toBe("envelope");
    expect(state.latestPendingEnvelope).toEqual({
      envelopeId: "env-1",
      delegatingUserId: "owner-1",
      ownerLabel: "owner@x.test",
      toolName: "run_discovery_triage",
      actionLabel: "run discovery triage",
      rationale: "This coworker is set to propose, not act.",
      proposedAt: "2026-10-07T09:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z", // clock-bomb-guard: allow pass-through fixture; the code under test never compares it to the clock
      approveHref: "/api/agent/envelope/env-1/approve",
      declineHref: "/api/agent/envelope/env-1/deny",
    });
    // The legacy proposal is still projected, with its v1 decision endpoint.
    expect(state.latestPendingProposal?.decisionEndpoint).toBe("/api/v1/governance/approvals/prop-row-1");
  });

  it("names a newer legacy proposal as the latest pending", async () => {
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([{ ...PROPOSAL, proposedAt: new Date("2026-10-08T09:00:00.000Z") }] as never);
    vi.mocked(prisma.coworkerActionEnvelope.findMany).mockResolvedValue([ENVELOPE] as never);
    const [card] = await listInternalAgentCards();
    expect(card!.extensions.tak.authority.supervisorDecisionState.latestPendingKind).toBe("proposal");
  });

  it("counts each agent's waiting requests in full: a busy agent neither caps its own count nor starves another's", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([AGENT, { ...AGENT, agentId: "AGT-QUIET", name: "Quiet" }] as never);
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.coworkerActionEnvelope.groupBy).mockResolvedValue([
      { coworkerAgentId: "AGT-OPS", _count: { _all: 120 } },
      { coworkerAgentId: "AGT-QUIET", _count: { _all: 1 } },
    ] as never);
    vi.mocked(prisma.coworkerActionEnvelope.findMany).mockResolvedValue([
      ENVELOPE,
      { ...ENVELOPE, id: "env-quiet", coworkerAgentId: "AGT-QUIET", createdAt: new Date("2026-09-01T09:00:00.000Z") },
    ] as never);

    const cards = await listInternalAgentCards();
    const stateOf = (agentId: string) => cards.find((card) => card.agentId === agentId)!.extensions.tak.authority.supervisorDecisionState;

    expect(prisma.coworkerActionEnvelope.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["coworkerAgentId"],
      where: expect.objectContaining({ coworkerAgentId: { in: ["AGT-OPS", "AGT-QUIET"] }, status: "proposed" }),
    }));
    expect(stateOf("AGT-OPS").pendingEnvelopeCount).toBe(120);
    expect(stateOf("AGT-OPS").latestPendingEnvelope?.envelopeId).toBe("env-1");
    expect(stateOf("AGT-QUIET").pendingEnvelopeCount).toBe(1);
    expect(stateOf("AGT-QUIET").latestPendingEnvelope?.envelopeId).toBe("env-quiet");
  });

  it("has nothing pending when neither exists", async () => {
    vi.mocked(prisma.agentActionProposal.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.coworkerActionEnvelope.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.coworkerActionEnvelope.findMany).mockResolvedValue([] as never);
    const [card] = await listInternalAgentCards();
    const state = card!.extensions.tak.authority.supervisorDecisionState;
    expect(state.latestPendingKind).toBeNull();
    expect(state.latestPendingEnvelope).toBeNull();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
