// GPP Phase 2 PR-H characterization (BI-69415B68): the superuser / ops-token
// proposal recovery route. This site stays a direct executeTool call in PR-H
// (see docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md,
// PR-H as built); these tests pin today's behaviour so the slice that routes it
// can prove non-disruption. Load-bearing facts: the handler receives the
// proposing coworker's agentId, and the shared-secret path acts as a resolved
// user with a synthetic HR-000 role rather than a real session.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  executeTool: vi.fn(),
  prisma: {
    agentActionProposal: { findUnique: vi.fn(), update: vi.fn() },
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

  it("ops-token path: acts as the build creator with a synthetic HR-000 role and no session", async () => {
    process.env.HIVE_OPS_TOKEN = "secret";
    mocks.prisma.featureBuild.findFirst.mockResolvedValue({ createdById: "user-creator" });
    mocks.prisma.user.findUnique.mockResolvedValue({ isSuperuser: false });

    const res = await POST(request({ proposalId: "AP-1" }, { "x-ops-token": "secret" }));

    expect(res.status).toBe(200);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "contribute_to_hive",
      { title: "Finding" },
      "user-creator",
      { agentId: "AGT-COWORKER", threadId: "thread-9" },
    );
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
