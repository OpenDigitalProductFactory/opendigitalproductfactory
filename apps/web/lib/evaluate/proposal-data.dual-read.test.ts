// Approval convergence A3 (BI-C8EC05C9, spec D8): Action History lists legacy
// proposals and converted envelopes together. None is converted yet, so the
// rows and stats are exactly today's.
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});
const prisma = vi.hoisted(() => ({
  agentActionProposal: { findMany: vi.fn(), count: vi.fn() },
  coworkerActionEnvelope: { findMany: vi.fn(), count: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma }));

import { getProposalStats, getProposals } from "./proposal-data";

const proposal = {
  proposalId: "prop-1", agentId: "AGT-1", actionType: "run_discovery_triage", parameters: { trigger: "cadence" },
  status: "executed", proposedAt: new Date("2026-10-01T00:00:00Z"), decidedAt: new Date("2026-10-02T00:00:00Z"),
  decidedBy: { email: "a@example.com" }, executedAt: new Date("2026-10-02T00:00:00Z"), resultEntityId: "R-1", resultError: null,
};

describe("Action History dual read", () => {
  it("rows: with no converted envelopes, exactly the legacy rows", async () => {
    prisma.agentActionProposal.findMany.mockResolvedValue([proposal]);
    prisma.coworkerActionEnvelope.findMany.mockResolvedValue([]);
    await expect(getProposals()).resolves.toEqual([{
      proposalId: "prop-1", agentId: "AGT-1", actionType: "run_discovery_triage", parameters: { trigger: "cadence" },
      status: "executed", proposedAt: "2026-10-01T00:00:00.000Z", decidedAt: "2026-10-02T00:00:00.000Z",
      decidedByEmail: "a@example.com", executedAt: "2026-10-02T00:00:00.000Z", resultEntityId: "R-1", resultError: null,
    }]);
  });

  it("rows: a converted envelope is listed by its request id and status, newest first", async () => {
    prisma.agentActionProposal.findMany.mockResolvedValue([proposal]);
    prisma.coworkerActionEnvelope.findMany.mockResolvedValue([{
      id: "ENV-1", coworkerAgentId: "AGT-1", manifestActionId: "run_discovery_triage", status: "declined",
      createdAt: new Date("2026-10-05T00:00:00Z"), resolvedAt: new Date("2026-10-06T00:00:00Z"),
    }]);
    const rows = await getProposals();
    expect(rows.map((row) => [row.proposalId, row.status])).toEqual([["ENV-1", "declined"], ["prop-1", "executed"]]);
  });

  it("stats: converted counts add to the matching legacy counts (0 today)", async () => {
    prisma.agentActionProposal.count.mockResolvedValue(5);
    prisma.coworkerActionEnvelope.count.mockResolvedValue(0);
    await expect(getProposalStats()).resolves.toEqual({ total: 5, proposed: 5, executed: 5, rejected: 5, failed: 5 });
  });
});
