import { beforeEach, describe, expect, it, vi } from "vitest";
const { load, user } = vi.hoisted(() => ({ load: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/agent-toolchain/connected-clients", async (original) => ({
  ...await original<typeof import("@/lib/agent-toolchain/connected-clients")>(),
  loadConnectedAgentClients: load,
}));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: user }));
import { authorizedSurfaceRuntime } from "../authorized-surface-registry";
import { groundPromptWithAuthorizedSurface } from "../authorized-surface-prompt-grounding";

const context = { delegatingUserId: "operator", actingAgentId: "coworker", mode: "browser" as const,
  locale: "en-US", timezone: "UTC", route: "/ops/self-upgrade" };
beforeEach(() => {
  vi.clearAllMocks();
  user.mockResolvedValue({ userId: "operator", isSuperuser: true, platformRole: "HR-000" });
  load.mockResolvedValue({ release: { packVersion: "0.2.19", fingerprint: "released1234" }, clients: [], truncated: false });
});
describe("Self-upgrade client health trusted surface", () => {
  it("grounds the exact route in the shared read model without write actions", async () => {
    const result = await groundPromptWithAuthorizedSurface({ systemPrompt: "Help", context, authorizedToolNames: new Set() });
    expect(result.grounded).toBe(true);
    expect(result.systemPrompt).toContain("released1234");
    expect(result.systemPrompt).toContain("Connected agent clients");
    expect(result.systemPrompt).not.toContain("Action ");
    expect(load).toHaveBeenCalled();
    if (result.sessionId) await authorizedSurfaceRuntime.close(result.sessionId, context);
  });
  it("does not read client health for a user without current operations authority", async () => {
    user.mockResolvedValue(null);
    const result = await groundPromptWithAuthorizedSurface({ systemPrompt: "Help", context, authorizedToolNames: new Set() });
    expect(result.grounded).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });
  it("revokes an open session before its next snapshot", async () => {
    const opened = await authorizedSurfaceRuntime.open({ context, selector: { route: context.route } });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    user.mockResolvedValue(null);
    const snapshot = await authorizedSurfaceRuntime.snapshot({ sessionId: opened.session.sessionId, caller: context });
    expect(snapshot.ok).toBe(false);
  });
  it("grounds read failure as explicitly unavailable without inventing client state", async () => {
    load.mockRejectedValue(new Error("secret internal error"));
    const result = await groundPromptWithAuthorizedSurface({ systemPrompt: "Help", context, authorizedToolNames: new Set() });
    expect(result.grounded).toBe(true);
    expect(result.systemPrompt).toContain("unavailable");
    expect(result.systemPrompt).not.toContain("secret internal error");
    if (result.sessionId) await authorizedSurfaceRuntime.close(result.sessionId, context);
  });
  it("does not claim adjacent routes", async () => {
    const result = await groundPromptWithAuthorizedSurface({ systemPrompt: "Help", context: { ...context, route: "/ops/self-upgrade/other" }, authorizedToolNames: new Set() });
    expect(result.grounded).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });
});
