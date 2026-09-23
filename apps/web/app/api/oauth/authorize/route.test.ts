import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  auth: vi.fn(), parse: vi.fn(), eligible: vi.fn(), resolveDefault: vi.fn(),
  binding: vi.fn(), code: vi.fn(), tx: vi.fn(), log: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mock.auth }));
vi.mock("@dpf/db", () => ({ prisma: {
  organization: { findFirst: vi.fn().mockResolvedValue({ name: "Install" }) },
  $transaction: mock.tx,
} }));
vi.mock("@/lib/auth/oauth-authorize-request", () => ({
  parseAuthorizeRequest: mock.parse,
  buildCodeRedirect: (uri: string, code: string) => `${uri}?code=${code}`,
  buildErrorRedirect: (f: { redirectUri: string; error: string }) => `${f.redirectUri}?error=${f.error}`,
}));
vi.mock("@/lib/auth/oauth-metadata", () => ({
  OAUTH_AUTHORIZE_PATH: "/api/oauth/authorize",
  canonicalResourceUri: (o: string) => `${o}/api/mcp/v1`,
  resolveResourceOrigin: () => "http://127.0.0.1:3000",
}));
vi.mock("@/lib/auth/oauth-identity-binding", () => ({
  eligibleOAuthCoworkers: mock.eligible,
  resolveDefaultOAuthCoworker: mock.resolveDefault,
  createOAuthConsentBinding: mock.binding,
  OAUTH_SETUP_REQUIRED: "setup required",
}));
vi.mock("@/lib/auth/oauth-tokens", () => ({ createAuthorizationCode: mock.code }));
vi.mock("@/lib/auth/oauth-clients", () => ({ touchClient: vi.fn() }));

import { GET, POST } from "./route";

const client = { rowId: "client-row", clientId: "dpfoc_x", clientName: "Codex", selfAsserted: true,
  registrationKind: "dcr", redirectUris: ["http://127.0.0.1:1/callback"] };
const codex = { id: "row-codex", agentId: "AGT-EXT-CODEX", displayName: "Codex (external CLI)" };
const claude = { id: "row-claude", agentId: "AGT-EXT-CLAUDE", displayName: "Claude Code (external CLI)" };

function form(values: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(values)) body.set(k, v);
  return new Request("http://127.0.0.1:3000/api/oauth/authorize", { method: "POST", body,
    headers: { origin: "http://127.0.0.1:3000" } });
}
const baseForm = { client_id: "dpfoc_x", redirect_uri: "http://127.0.0.1:1/callback", decision: "approve",
  granted_scope: "dpf.read", default_coworker: "AGT-EXT-CODEX", acting_coworker: "AGT-EXT-CODEX" };

beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({ user: { id: "human", email: "h@example" } });
  mock.parse.mockResolvedValue({ valid: true, request: { client, redirectUri: "http://127.0.0.1:1/callback",
    state: null, codeChallenge: "c", resource: "http://127.0.0.1:3000/api/mcp/v1", scopes: ["dpf.read"] } });
  mock.eligible.mockResolvedValue([claude, codex]);
  mock.resolveDefault.mockResolvedValue({ kind: "resolved", reason: "alias", selected: codex, candidates: [claude, codex] });
  mock.binding.mockResolvedValue({ id: "binding-row", bindingId: "AB-OAUTH-1" });
  mock.code.mockResolvedValue("dpfoac_code");
  mock.tx.mockImplementation(async (fn: (db: unknown) => Promise<unknown>) =>
    fn({ authorizationDecisionLog: { create: mock.log } }));
});

describe("one-click consent (BI-05E0EA33)", () => {
  it("GET renders the server-resolved assistant with one Connect action", async () => {
    const res = await GET(new Request("http://127.0.0.1:3000/api/oauth/authorize?client_id=dpfoc_x&redirect_uri=x"));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("It will work as <strong>Codex (external CLI)</strong>");
    expect(html).toContain("Connect Codex</button>");
    expect(mock.resolveDefault).toHaveBeenCalledWith(expect.objectContaining({ userId: "human", resource: "http://127.0.0.1:3000/api/mcp/v1" }), expect.anything());
  });

  it("POST binds the unchanged default only after re-deriving the same answer", async () => {
    const res = await POST(form(baseForm));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("code=dpfoac_code");
    expect(mock.binding).toHaveBeenCalledWith(expect.objectContaining({ agentId: "AGT-EXT-CODEX" }), expect.anything());
  });

  it("POST re-renders instead of binding when the server's default drifted since the GET", async () => {
    mock.resolveDefault.mockResolvedValue({ kind: "choice", selected: claude,
      candidates: [{ ...claude, detail: "a" }, { ...codex, detail: "b" }] });
    const res = await POST(form(baseForm));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("changed while this page was open");
    expect(mock.binding).not.toHaveBeenCalled();
    expect(mock.code).not.toHaveBeenCalled();
  });

  it("POST honours an explicit change to another eligible assistant without re-deriving", async () => {
    const res = await POST(form({ ...baseForm, acting_coworker: "AGT-EXT-CLAUDE" }));
    expect(res.status).toBe(302);
    expect(mock.binding).toHaveBeenCalledWith(expect.objectContaining({ agentId: "AGT-EXT-CLAUDE" }), expect.anything());
  });

  it("POST refuses a tampered assistant outside the eligible set", async () => {
    const res = await POST(form({ ...baseForm, acting_coworker: "AGT-ADMIN", default_coworker: "AGT-ADMIN" }));
    expect(res.status).toBe(403);
    expect(mock.binding).not.toHaveBeenCalled();
  });
});
