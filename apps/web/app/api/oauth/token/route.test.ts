import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  client: vi.fn(), human: vi.fn(), agent: vi.fn(), issue: vi.fn(), rotate: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: { agent: { findUnique: mock.agent },
  oAuthClient: { update: vi.fn().mockResolvedValue({}) } } }));
vi.mock("@/lib/auth/oauth-clients", () => ({ findClientByClientId: mock.client, touchClient: vi.fn() }));
vi.mock("@/lib/auth/oauth-identity-binding", () => ({ currentOAuthHuman: mock.human }));
vi.mock("@/lib/auth/oauth-tokens", () => ({ issueAccessToken: mock.issue,
  rotateOAuthRefreshToken: mock.rotate, exchangeOAuthCode: vi.fn(), secretMatches: () => true }));
import { POST } from "./route";
function request(values: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/oauth/token", { method: "POST",
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: "client",
      client_secret: "fixture", ...values }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.client.mockResolvedValue({ rowId: "client-row", clientName: "Configured service",
    registrationKind: "credentials", clientSecretHash: "hash", ownerUserId: "human",
    agentId: "database-agent-row", allowedScopes: ["dpf.read"] });
  mock.human.mockResolvedValue({ userId: "human" });
  mock.agent.mockResolvedValue({ agentId: "AGT-SERVICE", status: "active", archived: false });
  mock.issue.mockResolvedValue({ accessToken: "dpfoat_fixture", expiresIn: 300, publicScopes: ["dpf.read"] });
});
describe("configured OAuth services", () => {
  it("preserves the operator binding while passing the public identity to MCP", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mock.issue).toHaveBeenCalledWith(expect.objectContaining({ userId: "human", agentId: "AGT-SERVICE" }));
    expect(await response.json()).not.toHaveProperty("refresh_token");
  });
  it("does not issue credentials for a disabled human", async () => {
    mock.human.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(400);
    expect(mock.issue).not.toHaveBeenCalled();
  });
  it("does not issue credentials for an archived coworker", async () => {
    mock.agent.mockResolvedValue({ agentId: "AGT-SERVICE", status: "active", archived: true });
    expect((await POST(request())).status).toBe(400);
    expect(mock.issue).not.toHaveBeenCalled();
  });
  it("refuses unknown refresh scope rather than silently dropping it", async () => {
    const response = await POST(request({ grant_type: "refresh_token", refresh_token: "dpfort_fixture", scope: "dpf.read unknown" }));
    expect(await response.json()).toMatchObject({ error: "invalid_scope" });
    expect(mock.rotate).not.toHaveBeenCalled();
  });
});
