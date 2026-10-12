import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
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
  function runner(home: string) {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const fs = { mkdtempSync: vi.fn(() => home), chmodSync: vi.fn(), rmSync: vi.fn() };
    const cp = { spawn: vi.fn((..._args: unknown[]) => child) };
    const process = Object.assign(new EventEmitter(), { env: { OPENAI_API_KEY: "foreign", CODEX_API_KEY: "foreign", CODEX_HOME: "/root/.codex" }, exitCode: 0 });
    runInNewContext(CODEX_CATALOG_RUNNER, { require: (name: string) => name === "node:fs" ? fs : cp, process, setTimeout, clearTimeout });
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
});
