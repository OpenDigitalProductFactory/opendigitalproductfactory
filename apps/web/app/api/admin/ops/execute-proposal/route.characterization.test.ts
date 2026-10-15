// GPP Phase 2 PR-H characterization (BI-69415B68): the superuser / ops-token
// proposal recovery route. This site stays a direct executeTool call in PR-H
// (see docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md,
// PR-H as built); these tests pin today's behaviour so the slice that routes it
// can prove non-disruption. Load-bearing facts: the handler receives the
// proposing coworker's agentId, and the shared-secret path acts as a resolved
// user with a synthetic HR-000 role rather than a real session.
import { beforeEach, describe, expect, it, vi } from "vitest";

// Approval convergence PR-C harness (BI-04E5A511): this route now runs
// through convert-and-run (lib/actions/proposal-convert-and-run.ts), which
// calls the reference monitor and claims the row with a compare-and-set. The
// harness models the monitor ALLOWING the call (it hands the handler the
// characterised { agentId, threadId }) and maps the claim's updateMany onto the
// update mock, so every assertion below is unchanged. The real monitor's four
// outcomes are covered in the *.governed.test.ts suites.

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  executeTool: vi.fn(),
  prisma: {
    agentActionProposal: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    featureBuild: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/mcp-tools", () => ({
  PLATFORM_TOOLS: [{ name: "contribute_to_hive", requiredCapability: "view_platform" }],
  executeTool: mocks.executeTool,
}));
vi.mock("@/lib/mcp-governed-execute", () => ({
  governedExecuteTool: (args: { toolName: string; rawParams: Record<string, unknown>; userId: string; context?: { agentId?: string; threadId?: string } }) =>
    mocks.executeTool(args.toolName, args.rawParams, args.userId, { agentId: args.context?.agentId, threadId: args.context?.threadId }),
}));

import { POST } from "./route";

const proposal = {
  proposalId: "AP-1",
  status: "proposed",
  actionType: "contribute_to_hive",
  parameters: { title: "Finding" },
  agentId: "AGT-COWORKER",
  threadId: "thread-9",
};

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/admin/ops/execute-proposal", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HIVE_OPS_TOKEN;
  mocks.auth.mockResolvedValue({ user: { id: "user-su", isSuperuser: true, platformRole: "HR-000" } });
  mocks.prisma.agentActionProposal.findUnique.mockResolvedValue(proposal);
  mocks.prisma.agentActionProposal.update.mockResolvedValue({});
  mocks.prisma.agentActionProposal.updateMany.mockImplementation(
    async ({ where, data }: { where: { proposalId: string }; data: unknown }) => {
      await mocks.prisma.agentActionProposal.update({ where: { proposalId: where.proposalId }, data });
      return { count: 1 };
    },
  );
  mocks.executeTool.mockResolvedValue({ success: true, entityId: "HIVE-1", message: "Contributed" });
});

describe("POST /api/admin/ops/execute-proposal — characterization", () => {
  it("superuser session: runs the proposed tool as the superuser with the proposing coworker's agent and thread", async () => {
    const res = await POST(request({ proposalId: "AP-1" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { success: true, entityId: "HIVE-1", message: "Contributed" } });
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "contribute_to_hive",
      { title: "Finding" },
      "user-su",
      { agentId: "AGT-COWORKER", threadId: "thread-9" },
    );
    expect(mocks.prisma.agentActionProposal.update.mock.calls.map(([arg]) => arg.data.status)).toEqual(["approved", "executed"]);
  });

  // Approval convergence PR-C (plan C5, waiver W3): the shared-secret path is
  // removed. This is the one named assertion delta in this suite.
  it("an X-Ops-Token request without a session gets 401", async () => {
    process.env.HIVE_OPS_TOKEN = "secret";
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.featureBuild.findFirst.mockResolvedValue({ createdById: "user-creator" });
    mocks.prisma.user.findUnique.mockResolvedValue({ isSuperuser: false });

    const res = await POST(request({ proposalId: "AP-1" }, { "x-ops-token": "secret" }));

    expect(res.status).toBe(401);
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("a tool failure is recorded on the proposal and returned as ok:false", async () => {
    mocks.executeTool.mockResolvedValue({ success: false, error: "hive_unreachable", message: "No hive" });
    const res = await POST(request({ proposalId: "AP-1" }));
    expect(await res.json()).toEqual({ ok: false, result: { success: false, error: "hive_unreachable", message: "No hive" } });
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenLastCalledWith({
      where: { proposalId: "AP-1" },
      data: { status: "failed", resultError: "hive_unreachable" },
    });
  });

  it("a non-superuser session is refused before anything runs", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-x", isSuperuser: false, platformRole: "HR-000" } });
    const res = await POST(request({ proposalId: "AP-1" }));
    expect(res.status).toBe(403);
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });
});

// Approval convergence A1 (BI-C8EC05C9): the facts PR-C keeps (spec D5, plan
// C2): this route writes no system message and no decision log of its own,
// keeps its { ok, result } shape, and refuses a decided proposal with 409.
describe("POST /api/admin/ops/execute-proposal — convergence characterisation", () => {
  it("writes only the two status updates: no system message, no decision log", async () => {
    const res = await POST(request({ proposalId: "AP-1" }));
    expect(res.status).toBe(200);
    // The mocked client has no agentMessage or authorizationDecisionLog model:
    // a write to either would have thrown and failed the request.
    expect(Object.keys(mocks.prisma).sort()).toEqual(["agentActionProposal", "featureBuild", "user"]);
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.agentActionProposal.update.mock.calls[0][0]).toEqual({
      where: { proposalId: "AP-1" },
      data: { status: "approved", decidedAt: expect.any(Date), decidedById: "user-su" },
    });
  });

  it("refuses an already-decided proposal with 409 before anything runs", async () => {
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue({ ...proposal, status: "executed" });
    const res = await POST(request({ proposalId: "AP-1" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Proposal already executed" });
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });
});
