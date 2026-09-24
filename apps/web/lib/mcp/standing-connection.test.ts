// BI-A835D300 — the platform acts only on a person's connection that queued
// work may still continue on, and that admits the tool it is about to call.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const prismaMock = vi.hoisted(() => ({ mcpApiToken: { findMany: vi.fn() } }));
vi.mock("@dpf/db", () => ({ prisma: prismaMock }));
const current = vi.hoisted(() => ({ authority: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/auth/oauth-tokens", () => ({ isCurrentOAuthExecutionAuthority: current.authority, OAUTH_EXECUTION_AUTHORITY_SELECT: {} }));
vi.mock("@/lib/auth/oauth-identity-binding", () => ({ resolveOAuthConsent: vi.fn() }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: current.user }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [{ name: "request_coworker", sideEffect: true }] }));
vi.mock("@/lib/tak/agent-grants", () => ({
  getToolGrantMapping: () => ({ request_coworker: ["agent_control_write"] }),
  expandGrants: (grants: string[]) => grants,
}));

import { findStandingConnection } from "./standing-connection";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "TOK-NEW", kind: "oauth_access", userId: "user-1", agentId: "AGT-EXT-CODEX", revokedAt: null,
  scope: "write", capability: "write", scopes: ["agent_control_write"], publicScopes: ["dpf.work"],
  authorityBindingId: "BIND-1", oauthClientId: "client-1", resource: "http://127.0.0.1:3000/api/mcp/v1",
  ...overrides,
});

beforeEach(() => {
  prismaMock.mcpApiToken.findMany.mockReset();
  current.authority.mockReset();
  current.user.mockReset();
  current.user.mockResolvedValue({ userId: "user-1", platformRole: "HR-000", isSuperuser: false });
});

describe("findStandingConnection", () => {
  it("uses the newest connection that is still live and admits the tool, with the route's own context", async () => {
    prismaMock.mcpApiToken.findMany.mockResolvedValue([
      row({ id: "TOK-NARROW", scopes: ["registry_read"] }),
      row({ id: "TOK-DEAD" }),
      row({ id: "TOK-LIVE" }),
    ]);
    current.authority.mockImplementation(async (token: { id: string }) => token.id === "TOK-LIVE");
    const connection = await findStandingConnection("user-1", "AGT-EXT-CODEX", "request_coworker", "platform-reviewer-dispatch");
    expect(connection?.context).toMatchObject({
      agentId: "AGT-EXT-CODEX", apiTokenId: "TOK-LIVE", authSource: "oauth", callerClient: "platform-reviewer-dispatch",
      connectionDelegation: { authorityBindingId: "BIND-1", agentId: "AGT-EXT-CODEX" },
    });
    expect(current.authority).not.toHaveBeenCalledWith(expect.objectContaining({ id: "TOK-NARROW" }));
    expect(prismaMock.mcpApiToken.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { kind: "oauth_access", userId: "user-1", agentId: "AGT-EXT-CODEX", revokedAt: null },
    }));
  });

  it("finds nothing when no connection may still act, or the person is no longer current", async () => {
    prismaMock.mcpApiToken.findMany.mockResolvedValue([row()]);
    current.authority.mockResolvedValue(false);
    await expect(findStandingConnection("user-1", "AGT-EXT-CODEX", "request_coworker", "x")).resolves.toBeNull();
    current.authority.mockResolvedValue(true);
    current.user.mockResolvedValue(null);
    await expect(findStandingConnection("user-1", "AGT-EXT-CODEX", "request_coworker", "x")).resolves.toBeNull();
  });
});
