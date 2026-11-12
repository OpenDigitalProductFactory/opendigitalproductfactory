import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  auth: vi.fn(), parse: vi.fn(), eligible: vi.fn(), resolveDefault: vi.fn(),
  binding: vi.fn(), code: vi.fn(), tx: vi.fn(), log: vi.fn(), user: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mock.auth }));
vi.mock("@dpf/db", () => ({ prisma: {
  organization: { findFirst: vi.fn().mockResolvedValue({ name: "Install" }) },
  user: { findUnique: mock.user },
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
  granted_scope: "dpf.read", default_coworker: "AGT-EXT-CODEX", acting_coworker: "AGT-EXT-CODEX",
  confirm_account: "human" };

beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({ user: { id: "human", email: "h@example" } });
  mock.parse.mockResolvedValue({ valid: true, request: { client, redirectUri: "http://127.0.0.1:1/callback",
    state: null, codeChallenge: "c", resource: "http://127.0.0.1:3000/api/mcp/v1", scopes: ["dpf.read"] } });
  mock.eligible.mockResolvedValue([claude, codex]);
  mock.resolveDefault.mockResolvedValue({ kind: "resolved", reason: "alias", selected: codex, candidates: [claude, codex] });
  mock.binding.mockResolvedValue({ id: "binding-row", bindingId: "AB-OAUTH-1" });
  mock.code.mockResolvedValue("dpfoac_code");
  mock.user.mockResolvedValue({ workHandedOverAt: null });
  mock.tx.mockImplementation(async (fn: (db: unknown) => Promise<unknown>) =>
    fn({ authorizationDecisionLog: { create: mock.log } }));
});

describe("one-click consent (BI-05E0EA33)", () => {
  it("GET renders the server-resolved assistant with one Connect action", async () => {
    const res = await GET(new Request("http://127.0.0.1:3000/api/oauth/authorize?client_id=dpfoc_x&redirect_uri=x"));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<strong class="who default" data-agent="AGT-EXT-CODEX">Codex (external CLI)</strong>');
    expect(html).toContain("Connect Codex</button>");
    expect(mock.resolveDefault).toHaveBeenCalledWith(expect.objectContaining({ userId: "human", resource: "http://127.0.0.1:3000/api/mcp/v1" }), expect.anything());
  });

  it("POST binds the unchanged default only after re-deriving the same answer", async () => {
    const res = await POST(form(baseForm));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("code=dpfoac_code");
    expect(mock.binding).toHaveBeenCalledWith(expect.objectContaining({ agentId: "AGT-EXT-CODEX" }), expect.anything());
    // The audit row says this was one click: the server's default, unchanged.
    expect(mock.log).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      rationale: expect.objectContaining({ resolution: { kind: "resolved", reason: "alias", defaultAgentId: "AGT-EXT-CODEX", changedByHuman: false } }),
    }) }));
  });

  it("POST records a human override of the default in the audit row", async () => {
    const res = await POST(form({ ...baseForm, acting_coworker: "AGT-EXT-CLAUDE" }));
    expect(res.status).toBe(302);
    expect(mock.log).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      rationale: expect.objectContaining({ resolution: expect.objectContaining({ defaultAgentId: "AGT-EXT-CODEX", changedByHuman: true }) }),
    }) }));
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

describe("consent needs a person's explicit decision", () => {
  it("binds nothing and asks again when Connect arrives without an assistant chosen", async () => {
    mock.resolveDefault.mockResolvedValue({ kind: "choice", selected: codex, candidates: [codex, claude] });
    const { acting_coworker: _a, default_coworker: _d, ...rest } = baseForm;
    const response = await POST(form(rest));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Nothing was connected");
    expect(mock.binding).not.toHaveBeenCalled();
    expect(mock.code).not.toHaveBeenCalled();
  });

  it("treats a submission without the Connect decision as a refusal", async () => {
    const { decision: _d, ...rest } = baseForm;
    const response = await POST(form(rest));
    expect(response.headers.get("location")).toContain("error=access_denied");
    expect(mock.binding).not.toHaveBeenCalled();
  });

  it("refuses a decision that did not come from the consent page itself", async () => {
    const request = form(baseForm);
    request.headers.set("sec-fetch-site", "cross-site");
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(mock.binding).not.toHaveBeenCalled();
  });

  it("records how an approved decision arrived", async () => {
    const request = form(baseForm);
    request.headers.set("sec-fetch-site", "same-origin");
    request.headers.set("sec-fetch-user", "?1");
    await POST(request);
    expect(mock.log).toHaveBeenCalledWith({ data: expect.objectContaining({
      rationale: expect.objectContaining({ submittedFrom: { fetchSite: "same-origin", fetchUser: "?1" } }),
    }) });
  });
});

// BI-07D21B4A: the account a connection binds to is a decision the person makes
// on the page, not whatever session the browser happened to be holding.
describe("consent binds only the account the person confirmed", () => {
  it("binds nothing and asks again when Connect arrives without the account confirmed", async () => {
    const { confirm_account: _c, ...rest } = baseForm;
    const response = await POST(form(rest));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Confirm the account this connection works under");
    expect(mock.binding).not.toHaveBeenCalled();
    expect(mock.code).not.toHaveBeenCalled();
  });

  it("binds nothing when the confirmed account is not the session's account", async () => {
    // The page was confirmed for one account and the session changed underneath it.
    const response = await POST(form({ ...baseForm, confirm_account: "someone-else" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Nothing was connected");
    expect(mock.binding).not.toHaveBeenCalled();
    expect(mock.code).not.toHaveBeenCalled();
  });

  it("still lets the person cancel without confirming the account", async () => {
    const { confirm_account: _c, ...rest } = baseForm;
    const response = await POST(form({ ...rest, decision: "deny" }));
    expect(response.headers.get("location")).toContain("error=access_denied");
    expect(mock.binding).not.toHaveBeenCalled();
  });

  it("GET names the account and links to sign in as someone else, returning to this request", async () => {
    const res = await GET(new Request("http://127.0.0.1:3000/api/oauth/authorize?client_id=dpfoc_x&redirect_uri=x"));
    const html = await res.text();
    expect(html).toContain('name="confirm_account" value="human" required');
    const back = encodeURIComponent("/api/oauth/authorize?client_id=dpfoc_x&redirect_uri=x");
    expect(html).toContain(`href="/login?callbackUrl=${back.replace(/&/g, "&amp;")}"`);
  });
});

// BI-9D2199D4: a handover moves an account's work, not its access. Connecting
// an agent under that account brings new work back to it, so the person is told
// and has to say they mean it; the server refuses a Connect that did not.
describe("consent under an account whose work was handed over", () => {
  const handedOver = new Date("2026-10-01T02:00:00Z");
  beforeEach(() => mock.user.mockResolvedValue({ workHandedOverAt: handedOver }));

  it("GET says the account's work was handed over and asks for an acknowledgement", async () => {
    const res = await GET(new Request("http://127.0.0.1:3000/api/oauth/authorize?client_id=dpfoc_x&redirect_uri=x"));
    const html = await res.text();
    expect(html).toContain("work was handed over on 2026-10-01");
    expect(html).toContain('name="acknowledge_handover" value="human" required');
    expect(html).toContain("Use a different account");
  });

  it("GET asks nothing extra of an account whose work was never handed over", async () => {
    mock.user.mockResolvedValue({ workHandedOverAt: null });
    const html = await (await GET(new Request("http://127.0.0.1:3000/api/oauth/authorize?client_id=dpfoc_x&redirect_uri=x"))).text();
    expect(html).not.toContain("acknowledge_handover");
  });

  it("POST binds nothing without the acknowledgement and shows the screen again", async () => {
    const response = await POST(form(baseForm));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Nothing was connected");
    expect(mock.binding).not.toHaveBeenCalled();
    expect(mock.code).not.toHaveBeenCalled();
  });

  it("POST binds nothing when the acknowledgement names another account", async () => {
    const response = await POST(form({ ...baseForm, acknowledge_handover: "someone-else" }));
    expect(response.status).toBe(200);
    expect(mock.binding).not.toHaveBeenCalled();
  });

  it("POST binds once acknowledged and records the handover on the audit row", async () => {
    const response = await POST(form({ ...baseForm, acknowledge_handover: "human" }));
    expect(response.status).toBe(302);
    expect(mock.binding).toHaveBeenCalled();
    expect(mock.log).toHaveBeenCalledWith({ data: expect.objectContaining({
      rationale: expect.objectContaining({ accountWorkHandedOverAt: handedOver.toISOString() }),
    }) });
  });
});

// BI-F586F8A5 — a browser still holding the automation persona's session must
// not hand a person's interactive client to that account.
describe("consent under the platform automation sign-in", () => {
  const persona = { id: "automation", email: "automation@dpf.local" };
  const personaForm = { ...baseForm, confirm_account: "automation" };

  it("GET refuses to offer the automation account and sends the person to sign in as themself", async () => {
    mock.auth.mockResolvedValue({ user: persona });
    const res = await GET(new Request("http://127.0.0.1:3000/api/oauth/authorize?client_id=dpfoc_x&code_challenge=c"));
    const html = await res.text();
    expect(res.status).toBe(403);
    expect(html).toContain("automation@dpf.local");
    expect(html).toContain('href="/login?callbackUrl=%2Fapi%2Foauth%2Fauthorize%3Fclient_id%3Ddpfoc_x%26code_challenge%3Dc"');
    expect(html).not.toContain("confirm_account");
    expect(mock.eligible).not.toHaveBeenCalled();
  });

  it("POST issues no code for the automation account even when the page was confirmed", async () => {
    mock.auth.mockResolvedValue({ user: persona });
    const res = await POST(form(personaForm));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "access_denied" });
    expect(mock.binding).not.toHaveBeenCalled();
    expect(mock.code).not.toHaveBeenCalled();
  });

  it("POST refuses a governed automation session minted for a different authorization request", async () => {
    mock.auth.mockResolvedValue({ user: { ...persona, automationOAuthConsent: { clientId: "dpfoc_x", codeChallenge: "other" } } });
    expect((await POST(form(personaForm))).status).toBe(403);
    expect(mock.code).not.toHaveBeenCalled();
  });

  it("still lets the governed automation flow consent to the exact request its sign-in was minted for", async () => {
    mock.auth.mockResolvedValue({ user: { ...persona, automationOAuthConsent: { clientId: "dpfoc_x", codeChallenge: "c" } } });
    const get = await GET(new Request("http://127.0.0.1:3000/api/oauth/authorize?client_id=dpfoc_x&code_challenge=c"));
    expect(get.status).toBe(200);
    const res = await POST(form(personaForm));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("code=dpfoac_code");
  });
});
