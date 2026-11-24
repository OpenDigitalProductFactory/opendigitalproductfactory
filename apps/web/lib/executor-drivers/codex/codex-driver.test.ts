// The Codex driver (BI-A01B06F6, S3 PR 2): one auth resolver, one `codex exec`
// command line and one app-server session, called by the Workroom runtime,
// Build Studio dispatch, Ideate and inference routing.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetProviderBearerToken = vi.fn();
const mockGetDecryptedCredential = vi.fn();
vi.mock("@/lib/inference/ai-provider-internals", () => ({
  getProviderBearerToken: (...args: unknown[]) => mockGetProviderBearerToken(...args),
  getDecryptedCredential: (...args: unknown[]) => mockGetDecryptedCredential(...args),
}));
vi.mock("@/lib/ai-provider-routes", () => ({ providerSetupLocation: (id: string) => `Settings > ${id}` }));

import { codexAuthJson, resolveCodexAuth } from "./auth";
import { CODEX_INFERENCE_ONLY_ARGS, codexExecArgs } from "./exec";
import { createCodexDriver } from "./index";
import type { RuntimeEvent } from "../types";
import type { RuntimeLaunch, RuntimeProcess } from "@/lib/workroom-runtime/sandbox-launcher";

const jwt = (claims: Record<string, unknown>) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
const ACCOUNT_TOKEN = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } });

beforeEach(() => {
  mockGetProviderBearerToken.mockReset();
  mockGetDecryptedCredential.mockReset();
});

describe("resolveCodexAuth: the one Codex credential resolver", () => {
  it("uses the refreshing bearer token and the account it names", async () => {
    mockGetDecryptedCredential.mockResolvedValue({ cachedToken: "stale", refreshToken: "r-1" });
    mockGetProviderBearerToken.mockResolvedValue({ token: ACCOUNT_TOKEN });
    await expect(resolveCodexAuth("chatgpt")).resolves.toEqual({
      mode: "oauth", accessToken: ACCOUNT_TOKEN, refreshToken: "r-1", accountId: "acct-1",
    });
    expect(mockGetProviderBearerToken).toHaveBeenCalledWith("chatgpt");
  });

  it("passes the account connection and its version through when routing names one", async () => {
    mockGetDecryptedCredential.mockResolvedValue({ cachedToken: "x" });
    mockGetProviderBearerToken.mockResolvedValue({ token: ACCOUNT_TOKEN });
    await resolveCodexAuth("chatgpt", { connectionId: "conn-1", expectedExecutionVersion: "v2" });
    expect(mockGetDecryptedCredential).toHaveBeenCalledWith("chatgpt", "conn-1", "v2");
    expect(mockGetProviderBearerToken).toHaveBeenCalledWith("chatgpt", "conn-1", "v2");
  });

  it("uses a stored API key when the account has no OAuth token", async () => {
    mockGetDecryptedCredential.mockResolvedValue({ secretRef: "sk-proj-x" });
    await expect(resolveCodexAuth("codex")).resolves.toEqual({ mode: "apikey", apiKey: "sk-proj-x" });
    expect(mockGetProviderBearerToken).not.toHaveBeenCalled();
  });

  it("refuses a named non-default account whose token names no ChatGPT account", async () => {
    mockGetDecryptedCredential.mockResolvedValue({ cachedToken: "x" });
    mockGetProviderBearerToken.mockResolvedValue({ token: "opaque" });
    await expect(resolveCodexAuth("chatgpt", { connectionId: "conn-2" }))
      .rejects.toThrow("Selected account has no supported ChatGPT identity; reconnect this account");
    await expect(resolveCodexAuth("chatgpt")).resolves.toMatchObject({ mode: "oauth", accountId: null });
  });

  it("names the provider and where to fix it when there is no credential or no token", async () => {
    mockGetDecryptedCredential.mockResolvedValue(null);
    await expect(resolveCodexAuth("chatgpt")).rejects.toThrow('No credential for "chatgpt". Configure via Settings > chatgpt.');
    mockGetDecryptedCredential.mockResolvedValue({ cachedToken: "x" });
    mockGetProviderBearerToken.mockResolvedValue({ error: "refresh failed" });
    await expect(resolveCodexAuth("chatgpt")).rejects.toThrow(
      'OAuth token error for "chatgpt": refresh failed. Re-authenticate via Settings > chatgpt.',
    );
  });

  it("renders the auth.json the Codex CLI reads, for each mode", () => {
    expect(JSON.parse(codexAuthJson({ mode: "apikey", apiKey: "k" }))).toEqual({ OPENAI_API_KEY: "k" });
    const oauth = JSON.parse(codexAuthJson({ mode: "oauth", accessToken: ACCOUNT_TOKEN, refreshToken: "r", accountId: "acct-1" }, new Date("2026-11-19T00:00:00Z")));
    expect(oauth).toEqual({
      auth_mode: "chatgptAuthTokens",
      tokens: { access_token: ACCOUNT_TOKEN, refresh_token: "r", id_token: ACCOUNT_TOKEN, account_id: "acct-1" },
      last_refresh: "2026-11-19T00:00:00.000Z",
    });
    // A token that is not a JWT gets a placeholder id_token: Codex parses that field as a JWT.
    const opaque = JSON.parse(codexAuthJson({ mode: "oauth", accessToken: "opaque", refreshToken: "", accountId: null }));
    expect(opaque.tokens.id_token.split(".")).toHaveLength(3);
  });
});

describe("codexExecArgs: one command line for every `codex exec` caller", () => {
  it("builds Build Studio's and Ideate's command exactly as before", () => {
    expect(codexExecArgs({ sandbox: "bypass", model: "gpt-5.5" }).join(" "))
      .toBe("exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -m gpt-5.5");
    expect(codexExecArgs({ sandbox: "bypass", model: "" }).join(" "))
      .toBe("exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check");
  });

  it("builds inference routing's commands exactly as before", () => {
    expect(codexExecArgs({ sandbox: "read-only", fileCredentialStore: true, inferenceOnly: true, imageArgs: ["-i", "/a.png"], model: "gpt-5.5" }))
      .toEqual(["exec", "-c", 'cli_auth_credentials_store="file"', "--sandbox", "read-only", "--ephemeral",
        ...CODEX_INFERENCE_ONLY_ARGS, "--skip-git-repo-check", "-i", "/a.png", "-m", "gpt-5.5"]);
    expect(codexExecArgs({ sandbox: "bypass", fileCredentialStore: true }))
      .toEqual(["exec", "-c", 'cli_auth_credentials_store="file"', "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check"]);
  });
});

describe("the Codex driver session", () => {
  function fakeLauncher() {
    let onData: (chunk: string) => void = () => {};
    const written: Array<Record<string, unknown>> = [];
    const proc: RuntimeProcess = {
      write: (line) => {
        const message = JSON.parse(line) as Record<string, unknown>;
        written.push(message);
        // Answer every request the way app-server does.
        if (message["id"] !== undefined && message["method"]) {
          const result = message["method"] === "thread/start" ? { thread: { id: "th-1" } }
            : message["method"] === "turn/start" ? { turn: { id: `t-${written.filter((m) => m["method"] === "turn/start").length}` } }
            : {};
          queueMicrotask(() => onData(`${JSON.stringify({ id: message["id"], result })}\n`));
        }
      },
      onData: (listener) => { onData = listener as (chunk: string) => void; },
      onStderr: () => {},
      onClose: () => {},
      end: () => {},
      kill: () => {},
    };
    return {
      launch: (_launch: RuntimeLaunch) => proc,
      notify: (method: string, params: Record<string, unknown>) => onData(`${JSON.stringify({ method, params })}\n`),
    };
  }
  const breakdown = (input: number, cached: number, output: number) =>
    ({ totalTokens: input + output, inputTokens: input, cachedInputTokens: cached, outputTokens: output, reasoningOutputTokens: 0 });

  it("states its capabilities, including usage", () => {
    const driver = createCodexDriver({ launch: fakeLauncher().launch, login: async () => ({ type: "apiKey", apiKey: "k" }) });
    expect(driver.provider).toBe("codex");
    expect(driver.capabilities).toEqual({
      steer: true, interrupt: true, runtimeRequests: "session", resumeThread: true, usage: true, oneShot: true,
    });
  });

  it("reports each turn's own usage from the thread totals, and a turn with none as unknown", async () => {
    const fake = fakeLauncher();
    const driver = createCodexDriver({ launch: fake.launch, login: async () => ({ type: "apiKey", apiKey: "k" }) });
    const events: RuntimeEvent[] = [];
    const session = await driver.openSession({ capsuleId: "WC-1", mcp: { url: "u", bearerToken: "b" }, cwd: "/w" }, (e) => events.push(e));
    await session.ensureThread();

    // A total reported before the turn starts is the baseline, not this turn's cost.
    fake.notify("thread/tokenUsage/updated", { threadId: "th-1", turnId: "t-0", tokenUsage: { total: breakdown(1000, 0, 100), last: breakdown(1000, 0, 100) } });
    await session.startTurn("first");
    fake.notify("turn/started", { threadId: "th-1", turn: { id: "t-1" } });
    fake.notify("thread/tokenUsage/updated", { threadId: "th-1", turnId: "t-1", tokenUsage: { total: breakdown(3000, 800, 150), last: breakdown(2000, 800, 50) } });
    fake.notify("thread/tokenUsage/updated", { threadId: "th-1", turnId: "t-1", tokenUsage: { total: breakdown(4500, 1800, 190), last: breakdown(1500, 1000, 40) } });
    fake.notify("turn/completed", { threadId: "th-1", turn: { id: "t-1", status: "completed" } });

    await session.startTurn("second");
    fake.notify("turn/started", { threadId: "th-1", turn: { id: "t-2" } });
    fake.notify("turn/completed", { threadId: "th-1", turn: { id: "t-2", status: "completed" } });

    expect(events.filter((e) => e.type === "usage")).toEqual([
      // Codex counts cached input inside input; DPF reports it apart, as Claude does.
      { type: "usage", turnId: "t-1", usage: { reported: "native", inputTokens: 1700, cacheReadInputTokens: 1800, outputTokens: 90 } },
      { type: "usage", turnId: "t-2", usage: { reported: "unknown" } },
    ]);
    expect(events.map((e) => e.type)).toEqual(["turn-started", "usage", "turn-completed", "turn-started", "usage", "turn-completed"]);
  });

  it("ignores usage for another thread", async () => {
    const fake = fakeLauncher();
    const driver = createCodexDriver({ launch: fake.launch, login: async () => ({ type: "apiKey", apiKey: "k" }) });
    const events: RuntimeEvent[] = [];
    const session = await driver.openSession({ capsuleId: "WC-1", mcp: { url: "u", bearerToken: "b" }, cwd: "/w" }, (e) => events.push(e));
    await session.ensureThread();
    await session.startTurn("go");
    fake.notify("turn/started", { threadId: "th-1", turn: { id: "t-1" } });
    fake.notify("thread/tokenUsage/updated", { threadId: "child", turnId: "t-1", tokenUsage: { total: breakdown(9, 0, 9), last: breakdown(9, 0, 9) } });
    fake.notify("turn/completed", { threadId: "th-1", turn: { id: "t-1", status: "completed" } });
    expect(events.find((e) => e.type === "usage")).toEqual({ type: "usage", turnId: "t-1", usage: { reported: "unknown" } });
  });
});
