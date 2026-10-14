import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { StringDecoder } from "node:string_decoder";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connection: vi.fn(), credential: vi.fn(), bearer: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { aiProviderConnection: { findUnique: mocks.connection } } }));
vi.mock("@/lib/inference/ai-provider-internals", () => ({ getDecryptedCredential: mocks.credential, getProviderBearerToken: mocks.bearer }));
import { discoverCodexCliModels, resolveCodexCatalogAuth } from "./codex-cli-catalog-auth";
import { CODEX_CATALOG_RUNNER } from "@/lib/routing/codex-cli-model-catalog";
import * as catalog from "@/lib/routing/codex-cli-model-catalog";

const connection = { connectionId: "account-b", providerId: "codex", status: "active", authMethod: "oauth", credentialEntryId: "credential-b", updatedAt: new Date("2026-10-01") };
const token = (auth: unknown) => `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": auth })).toString("base64url")}.signature`;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connection.mockResolvedValue(connection);
  mocks.credential.mockResolvedValue({ id: "credential-b", cachedToken: "stored", secretRef: null });
  mocks.bearer.mockResolvedValue({ token: token({ chatgpt_account_id: "upstream-b", chatgpt_plan_type: "business" }) });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("selected Codex catalog authentication", () => {
  it("uses only the selected credential and its actual upstream identity", async () => {
    expect(await resolveCodexCatalogAuth("codex", "account-b")).toEqual({ type: "chatgptAuthTokens", accessToken: token({ chatgpt_account_id: "upstream-b", chatgpt_plan_type: "business" }), chatgptAccountId: "upstream-b", chatgptPlanType: "business" });
    expect(mocks.credential).toHaveBeenCalledWith("codex", "account-b");
    expect(mocks.bearer).toHaveBeenCalledWith("codex", "account-b");
  });
  it("passes the selected account login to the isolated transport without a provider-default lookup", async () => {
    const read = vi.spyOn(catalog, "discoverCodexCliModels").mockResolvedValue([{ modelId: "selected-model", rawMetadata: {} }]);
    expect(await discoverCodexCliModels("codex", "account-b")).toEqual([{ modelId: "selected-model", rawMetadata: {} }]);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ type: "chatgptAuthTokens", chatgptAccountId: "upstream-b" }));
    expect(mocks.credential).toHaveBeenCalledWith("codex", "account-b");
  });
  it("resolves the legacy default through the same explicit boundary", async () => {
    await resolveCodexCatalogAuth("codex");
    expect(mocks.credential).toHaveBeenCalledWith("codex", "provider-default-codex");
  });
  it.each([null, { ...connection, status: "disabled" }, { ...connection, providerId: "chatgpt" }, { ...connection, credentialEntryId: null }])("refuses absent, disabled, foreign, or unowned accounts", async (selected) => {
    mocks.connection.mockResolvedValue(selected);
    await expect(resolveCodexCatalogAuth("codex", "account-b")).rejects.toThrow("unavailable");
    expect(mocks.credential).not.toHaveBeenCalled();
  });
  it("refuses an owner change before decrypting or injecting another credential", async () => {
    mocks.credential.mockResolvedValue({ id: "credential-a", cachedToken: "foreign" });
    await expect(resolveCodexCatalogAuth("codex", "account-b")).rejects.toThrow("credential changed");
    expect(mocks.bearer).not.toHaveBeenCalled();
  });
  it("refuses a concurrent account change after authentication", async () => {
    mocks.connection.mockResolvedValueOnce(connection).mockResolvedValueOnce({ ...connection, updatedAt: new Date("2026-10-02") });
    await expect(resolveCodexCatalogAuth("codex", "account-b")).rejects.toThrow("changed during authentication");
  });
  it.each(["opaque-token", token({}), "header.bnVsbA.signature"])("never fabricates an upstream identity for unsupported tokens", async (accessToken) => {
    mocks.bearer.mockResolvedValue({ token: accessToken });
    await expect(resolveCodexCatalogAuth("codex", "account-b")).rejects.toThrow(/identity|account ID/);
  });
  it("isolates API-key login without bearer or environment fallback", async () => {
    mocks.connection.mockResolvedValue({ ...connection, authMethod: "api-key" });
    mocks.credential.mockResolvedValue({ id: "credential-b", secretRef: "selected-api-key" });
    expect(await resolveCodexCatalogAuth("codex", "account-b")).toEqual({ type: "apiKey", apiKey: "selected-api-key" });
    expect(mocks.bearer).not.toHaveBeenCalled();
  });
});

describe("container-owned private catalog lifecycle", () => {
  function runner(home: string, cache?: unknown) {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), stdin: Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() }), stdout: new EventEmitter() });
    const fs = { mkdtempSync: vi.fn(() => home), chmodSync: vi.fn(), rmSync: vi.fn(),
      lstatSync: vi.fn(() => { if (cache === undefined) throw new Error("private-cache-error"); return { isFile: (): boolean => true, size: 1000 }; }),
      readFileSync: vi.fn(() => typeof cache === "string" ? cache : JSON.stringify(cache)),
    };
    const cp = { spawn: vi.fn((..._args: unknown[]) => child) };
    const process = Object.assign(new EventEmitter(), { env: { OPENAI_API_KEY: "foreign", CODEX_API_KEY: "foreign", CODEX_HOME: "/root/.codex" }, exitCode: 0, stdin: new EventEmitter(), stdout: { write: vi.fn() } });
    runInNewContext(CODEX_CATALOG_RUNNER, { require: (name: string) => name === "node:fs" ? fs : name === "node:string_decoder" ? { StringDecoder } : cp, process, setTimeout, clearTimeout, Buffer, Date });
    return { child, fs, cp, process };
  }
  it("keeps simultaneous children and cleanup scoped to distinct private homes", () => {
    vi.useFakeTimers();
    const a = runner("/tmp/dpf-codex-catalog-a"), b = runner("/tmp/dpf-codex-catalog-b");
    const options = a.cp.spawn.mock.calls[0]![2] as { env: Record<string, string>; cwd: string };
    expect(options.cwd).toBe("/tmp/dpf-codex-catalog-a");
    expect(options.env.CODEX_HOME).toBe(options.cwd);
    expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(options.env).not.toHaveProperty("CODEX_API_KEY");
    expect(a.cp.spawn.mock.calls[0]![1]).toContain('cli_auth_credentials_store="ephemeral"');
    a.child.emit("exit", 0);
    expect(a.fs.rmSync).toHaveBeenCalledWith("/tmp/dpf-codex-catalog-a", { recursive: true, force: true });
    expect(b.fs.rmSync).not.toHaveBeenCalled();
    expect(b.child.kill).not.toHaveBeenCalled();
    b.child.emit("exit", 0);
  });
  it("terminates the owned child after client loss and escalates a hung process", async () => {
    vi.useFakeTimers();
    const r = runner("/tmp/dpf-codex-catalog-a");
    await vi.advanceTimersByTimeAsync(35_000);
    expect(r.child.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(r.child.kill).toHaveBeenCalledWith("SIGKILL");
    r.child.emit("exit", null);
    expect(r.fs.rmSync).toHaveBeenCalledTimes(1);
    expect(r.process.exitCode).toBe(1);
  });

  const freshCache = () => ({ fetched_at: new Date().toISOString(), client_version: "0.157.0", identity: "private-opaque-scope", models: [{ slug: "future-model" }] });
  it.each(["EPIPE", "ERR_STREAM_DESTROYED"])("owns shutdown and cleanup after a child input %s error", async (code) => {
    vi.useFakeTimers();
    const r = runner("/tmp/dpf-codex-catalog-broken-pipe");
    expect(() => r.child.stdin.emit("error", Object.assign(new Error("selected-private-token"), { code }))).not.toThrow();
    expect(r.child.kill).toHaveBeenCalledWith("SIGTERM");
    r.process.stdin.emit("data", Buffer.from("selected-private-token"));
    r.process.stdin.emit("end");
    expect(r.child.stdin.write).not.toHaveBeenCalled();
    expect(r.child.stdin.end).not.toHaveBeenCalled();
    expect(r.process.stdout.write).not.toHaveBeenCalled();
    expect(r.fs.rmSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(r.child.kill).toHaveBeenCalledWith("SIGKILL");
    r.child.emit("exit", 0);
    expect(r.fs.rmSync).toHaveBeenCalledTimes(1);
    expect(r.fs.rmSync).toHaveBeenCalledWith("/tmp/dpf-codex-catalog-broken-pipe", { recursive: true, force: true });
    expect(r.process.exitCode).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  function catalogFrames(r: ReturnType<typeof runner>, data = [{ model: "future-model" }]) {
    r.process.stdin.emit("data", Buffer.from('{"method":"account/login/start","id":2,"params":{"accessToken":"selected-private-token"}}\n'));
    r.child.stdout.emit("data", Buffer.from(JSON.stringify({ id: 3, result: { data, nextCursor: null } }) + "\n"));
    return r.process.stdout.write.mock.calls.map(([line]) => JSON.parse(String(line)));
  }

  it("derives response-correlated remote proof from the actual private runner without exposing scope or credentials", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T04:45:00Z"));
    const r = runner("/tmp/dpf-codex-catalog-proof", freshCache());
    const frames = catalogFrames(r);
    expect(frames[0]).toEqual({ method: "dpf/catalog-provenance", params: { responseId: 3, verified: true, clientVersion: "0.157.0", fetchedAt: "2026-10-13T04:45:00.000Z" } });
    expect(frames[1]).toMatchObject({ id: 3, result: { data: [{ model: "future-model" }] } });
    expect(JSON.stringify(frames)).not.toMatch(/private-opaque-scope|selected-private-token/);
    expect(r.fs.readFileSync).toHaveBeenCalledWith("/tmp/dpf-codex-catalog-proof/models_cache.json", "utf8");
    r.child.emit("exit", 0);
  });

  it.each([
    { name: "missing cache", cache: undefined },
    { name: "malformed cache", cache: "private-token malformed JSON" },
    { name: "missing scope", cache: { identity: null } },
    { name: "missing version", cache: { client_version: null } },
    { name: "old cache", cache: { fetched_at: "2026-10-12T04:45:00Z" } },
    { name: "future cache", cache: { fetched_at: "2026-10-14T04:45:00Z" } },
    { name: "bundled-only model", cache: { models: [{ slug: "other-model" }] } },
    { name: "malformed remote entry", cache: { models: [{}] } },
  ])("does not turn $name into remote freshness", ({ name, cache }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T04:45:00Z"));
    const value = name === "missing cache" || typeof cache === "string" ? cache : { ...freshCache(), ...cache };
    const r = runner("/tmp/dpf-codex-catalog-proof", value);
    const frames = catalogFrames(r);
    expect(frames[0]).toEqual({ method: "dpf/catalog-provenance", params: { responseId: 3, verified: false } });
    expect(JSON.stringify(frames)).not.toMatch(/private-token|private-opaque-scope|selected-private-token|private-cache-error/);
    r.child.emit("exit", 0);
  });

  it("refuses oversized or non-file cache evidence without reading it", () => {
    vi.useFakeTimers();
    const r = runner("/tmp/dpf-codex-catalog-proof", freshCache());
    r.fs.lstatSync.mockReturnValue({ isFile: () => false, size: 10 });
    expect(catalogFrames(r)[0].params.verified).toBe(false);
    r.fs.lstatSync.mockReturnValue({ isFile: () => true, size: 4 * 1024 * 1024 + 1 });
    expect(catalogFrames(r)[0].params.verified).toBe(false);
    expect(r.fs.readFileSync).not.toHaveBeenCalled();
    r.child.emit("exit", 0);
  });
});
