import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  client: vi.fn(), human: vi.fn(), agent: vi.fn(), issue: vi.fn(), rotate: vi.fn(), exchange: vi.fn(), quiescence: vi.fn(), matches: vi.fn(), config: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: { agent: { findUnique: mock.agent },
  oAuthClient: { update: vi.fn().mockResolvedValue({}) }, platformConfig: { findUnique: mock.config } } }));
vi.mock("@/lib/auth/oauth-clients", () => ({ findClientByClientId: mock.client, touchClient: vi.fn() }));
vi.mock("@/lib/auth/oauth-identity-binding", () => ({ currentOAuthHuman: mock.human }));
vi.mock("@/lib/auth/oauth-tokens", () => ({ issueAccessToken: mock.issue,
  rotateOAuthRefreshToken: mock.rotate, exchangeOAuthCode: mock.exchange, secretMatches: mock.matches }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceConfig: mock.quiescence }));
import { POST } from "./route";
function request(values: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/oauth/token", { method: "POST",
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: "client",
      client_secret: "fixture", ...values }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.quiescence.mockResolvedValue({ level: "normal", runId: null });
  mock.matches.mockReturnValue(true);
  mock.client.mockResolvedValue({ rowId: "client-row", clientName: "Configured service",
    registrationKind: "credentials", clientSecretHash: "hash", ownerUserId: "human",
    agentId: "database-agent-row", allowedScopes: ["dpf.read"] });
  mock.human.mockResolvedValue({ userId: "human" });
  mock.agent.mockResolvedValue({ agentId: "AGT-SERVICE", status: "active", archived: false });
  mock.issue.mockResolvedValue({ accessToken: "dpfoat_fixture", expiresIn: 300, publicScopes: ["dpf.read"] });
});

describe("OAuth continuity during quiescence", () => {
  beforeEach(() => {
    mock.quiescence.mockResolvedValue({ level: "draining", runId: "QR-existing" });
    mock.rotate.mockResolvedValue({ accepted: true, issued: { accessToken: "dpfoat_fixture", expiresIn: 300, publicScopes: ["dpf.read"] }, refresh: "dpfort_rotated" });
  });

  it("refreshes through the existing authenticated rotation", async () => {
    const response = await POST(request({ grant_type: "refresh_token", refresh_token: "dpfort_existing", scope: "dpf.read" }));
    expect(response.status).toBe(200);
    expect(mock.rotate).toHaveBeenCalledWith(expect.objectContaining({ token: "dpfort_existing", clientId: "client-row", requestedScopes: ["dpf.read"] }));
    expect(await response.json()).toMatchObject({ refresh_token: "dpfort_rotated", scope: "dpf.read" });
  });

  it.each(["authorization_code", "client_credentials", "unrecognized"])("refuses new grant %s before issuing or exchanging", async grant_type => {
    const response = await POST(request({ grant_type }));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.json()).toMatchObject({ error: "temporarily_unavailable" });
    expect(mock.exchange).not.toHaveBeenCalled();
    expect(mock.issue).not.toHaveBeenCalled();
    expect(mock.rotate).not.toHaveBeenCalled();
  });

  it.each(["swapping"])("refuses refresh while %s", async level => {
    mock.quiescence.mockResolvedValue({ level });
    expect((await POST(request({ grant_type: "refresh_token", refresh_token: "dpfort_existing" }))).status).toBe(503);
    expect(mock.rotate).not.toHaveBeenCalled();
  });

  it.each([null, { value: { level: "panic" } }])("preserves the canonical reader's legacy normal default for %j", async row => {
    const actual = await vi.importActual<typeof import("@/lib/self-upgrade/quiescence")>("@/lib/self-upgrade/quiescence");
    actual.invalidateQuiescenceCache();
    mock.config.mockResolvedValue(row);
    mock.quiescence.mockImplementation(() => actual.getQuiescenceConfig());
    const response = await POST(request({ grant_type: "refresh_token", refresh_token: "dpfort_existing" }));
    expect(response.status).toBe(200);
    expect(mock.config).toHaveBeenCalledWith({ where: { key: "portal.quiescence" } });
    expect(mock.rotate).toHaveBeenCalled();
    actual.invalidateQuiescenceCache();
  });

  it("fails closed if the canonical state read fails", async () => {
    mock.quiescence.mockRejectedValue(new Error("state unavailable"));
    expect((await POST(request({ grant_type: "refresh_token", refresh_token: "dpfort_existing" }))).status).toBe(503);
    expect(mock.rotate).not.toHaveBeenCalled();
  });

  it("still refuses a revoked client", async () => {
    mock.client.mockResolvedValue(null);
    expect((await POST(request({ grant_type: "refresh_token", refresh_token: "dpfort_existing" }))).status).toBe(400);
    expect(mock.rotate).not.toHaveBeenCalled();
  });

  it("still authenticates a confidential client", async () => {
    mock.matches.mockReturnValue(false);
    expect((await POST(request({ grant_type: "refresh_token", refresh_token: "dpfort_existing" }))).status).toBe(401);
    expect(mock.rotate).not.toHaveBeenCalled();
  });

  it.each(["invalid_grant", "invalid_scope", "access_denied"])("preserves existing rotation refusal %s", async error => {
    mock.rotate.mockResolvedValue({ accepted: false, error, detail: "Existing authorization refused." });
    const response = await POST(request({ grant_type: "refresh_token", refresh_token: "dpfort_existing" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error });
    expect(mock.issue).not.toHaveBeenCalled();
  });
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
