import { describe, expect, it, vi } from "vitest";
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ getAvailableTools: vi.fn(), toolsToOpenAIFormat: vi.fn() }));
vi.mock("@/lib/tak/agent-grants", async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), getAgentToolGrantsAsync: async () => [],
}));
vi.mock("@/lib/inference/local-model-context-reconcile", () => ({
  resolveLocalServingPosture: async () => ({ servedContextTokens: 24576, presence: "present" }),
}));
vi.mock("@/lib/routing/local-tool-fidelity", () => ({ resolveLocalToolFidelityCeiling: async () => null }));

describe("scheduled room tool-surface narrowing (BI-D95FD249)", () => {
  it("forwards the room's grant intersection before attachment budgeting", async () => {
    const tools = await import("@/lib/mcp-tools");
    vi.mocked(tools.getAvailableTools).mockReset().mockResolvedValue([]);
    vi.mocked(tools.toolsToOpenAIFormat).mockReturnValue([]);
    const { resolveAutonomousWorkTools } = await import("./autonomous-work-run");
    await resolveAutonomousWorkTools({ userContext: { userId: "owner", platformRole: "admin", isSuperuser: true },
      agentId: "build-specialist", mode: "act", roomAuthorizedGrants: ["workroom_evidence_write"] });
    expect(tools.getAvailableTools).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ roomAuthorizedGrants: ["workroom_evidence_write"] }));
  });
});
