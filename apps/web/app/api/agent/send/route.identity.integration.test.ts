import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ config: vi.fn(), agent: vi.fn(), admit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "owner", platformRole: "HR-000", isSuperuser: true } }) }));
vi.mock("@/lib/agent/accept-user-message", () => ({ acceptUserMessage: async () => "original-message" }));
vi.mock("@/lib/agent/foreground-work-admission", () => ({ admitForegroundWork: f.admit }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: async () => ({}) } }));
vi.mock("@dpf/db", () => ({ prisma: {
  platformConfig: { findUnique: f.config }, agent: { findFirst: f.agent },
  agentMessage: { findUnique: async () => null },
} }));
vi.mock("@/lib/identity/principal-linking", () => ({ ensureAgentPrincipalIdentity: async () => null }));
vi.mock("@/lib/actions/agent-skills", () => ({ getSkillsForAgentLegacy: async () => [] }));
vi.mock("@/lib/tak/prompt-loader", () => ({ loadPrompt: async () => "" }));
vi.mock("@/lib/tak/coworker-job-description", () => ({ loadCoworkerJobDescription: async () => ({ content: "Fixture job" }) }));
vi.mock("@/lib/coworker-lifecycle/lifecycle-gate", () => ({ evaluateLifecycleGate: async () => ({ allowed: true }) }));

import { POST } from "./route";
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";
import { resolveAgentForRouteWithPrompts } from "@/lib/tak/agent-routing-server";

describe("real admission and execution identity composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    f.config.mockResolvedValue(null);
    f.admit.mockResolvedValue("TR-fixture");
    f.agent.mockImplementation(async ({ where }) => ({ agentId: where.agentId, name: "Fixture coworker", sensitivity: "internal" }));
  });

  it.each([
    ["/finance/expense-claims", null],
    ["/finance/expense-claims", { value: { enabled: false } }],
    ["/platform/ai/agent/AGT-900", null],
  ])("retains the actual server execution identity for %s", async (routeContext, config) => {
    f.config.mockResolvedValue(config);
    const response = await POST(new Request("http://localhost/api/agent/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: "thread", content: "Review the retained request", routeContext }),
    }) as any);
    expect(response.status).toBe(200);
    // This is the real resolver and flag used by sendMessage, including the
    // canonical selected coworker -> executable runtime alias conversion.
    const execution = await resolveAgentForRouteWithPrompts(routeContext, { platformRole: "HR-000", isSuperuser: true }, await isUnifiedCoworkerEnabled());
    expect(f.admit).toHaveBeenCalledWith(expect.objectContaining({ agentId: execution.agentId }));
    if (routeContext.endsWith("AGT-900")) expect(execution.agentId).toBe("finance-agent");
  });
});
