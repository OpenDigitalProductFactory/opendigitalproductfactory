import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ capture: vi.fn(), auth: vi.fn(), read: vi.fn(), accounts: vi.fn(), account: vi.fn(),
  pools: vi.fn(), capacities: vi.fn(), poolWrite: vi.fn(), capacityWrite: vi.fn(), lock: vi.fn() }));
vi.mock("@dpf/db", () => {
  const tx = { aiProviderConnection: { findUnique: m.account, findMany: m.accounts }, cliPoolStatus: { findMany: m.pools, updateMany: m.poolWrite },
    providerCapacityStatus: { findMany: m.capacities, updateMany: m.capacityWrite }, $queryRaw: m.lock };
  return { prisma: { ...tx, $transaction: async (fn: (db: unknown) => unknown) => fn(tx) }, Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } } };
});
vi.mock("./codex-cli-catalog-auth", () => ({ resolveCodexCatalogAuth: m.auth }));
vi.mock("@/lib/routing/codex-cli-capacity", () => ({ readCodexCliCapacity: m.read }));
vi.mock("@/lib/routing/provider-capacity/execution-proof.server", () => ({ captureExecutionProofBinding: m.capture }));
import { reconcileSubscriptionCliQuota } from "./subscription-cli-recovery";
const binding = { providerId: "codex", connectionId: "provider-default-codex", modelId: "model", adapter: "responses",
  accountVersion: "a".repeat(64), credentialRevision: "b".repeat(64), modelRevision: "c".repeat(64), endpointRevision: "d".repeat(64), quotaRevision: "e".repeat(64) };
const stamp = new Date("2026-11-14T00:00:00Z");
const forecast = new Date(Date.now() + 7 * 86400_000);
const account = { id: "sibling", status: "active", connectionId: "provider-default-chatgpt", updatedAt: stamp,
  credentialEntryId: "credential", credentialEntry: { updatedAt: stamp } };
beforeEach(() => {
  vi.resetAllMocks();
  m.capture.mockResolvedValue({ accountId: "selected", binding });
  m.auth.mockResolvedValue({ type: "chatgptAuthTokens", chatgptAccountId: "upstream" });
  m.read.mockResolvedValue(true); m.account.mockResolvedValue(account);
  m.accounts.mockResolvedValue([{ ...account }, { ...account, id: "selected", connectionId: "provider-default-codex" }]);
  m.lock.mockResolvedValue([{ enabled: true, schedule: "once", runCursor: "run", metadata: { hourly: true } }]);
  m.pools.mockResolvedValue([{ id: "pool", providerId: "codex", adapterType: null, adapterKind: "codex", scopeKey: "cli:codex-cli:provider:codex", resetAt: forecast, updatedAt: stamp }]);
  m.capacities.mockResolvedValue([{ id: "capacity", providerId: "codex", ownedAccountId: null, scopeKey: null, source: "cli", state: "quota_resets_at", retryAt: forecast, updatedAt: stamp }]);
  m.poolWrite.mockResolvedValue({ count: 1 }); m.capacityWrite.mockResolvedValue({ count: 1 });
});
const check = () => reconcileSubscriptionCliQuota(binding.connectionId, "model", async () => {}, { jobId: "job", runCursor: "run", scheduled: false });
describe("fresh CLI quota reconciliation", () => {
  it("clears only captured generations after a matching current usage read", async () => {
    expect(await check()).toBe(true);
    expect(m.poolWrite).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "pool", updatedAt: stamp }) }));
    expect(m.capacityWrite).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "capacity", updatedAt: stamp, source: "cli" }) }));
  });
  it("keeps account-owned and foreign CLI scope restrictions", async () => {
    m.pools.mockResolvedValue([{ id: "foreign", providerId: "codex", adapterKind: "codex", adapterType: null, scopeKey: "cli:codex-cli:another-owner", updatedAt: stamp }]);
    m.capacities.mockResolvedValue([{ id: "foreign", providerId: "codex", ownedAccountId: "another-owner", state: "quota_resets_at", source: "cli", updatedAt: stamp }]);
    await check();
    expect(m.poolWrite).not.toHaveBeenCalled(); expect(m.capacityWrite).not.toHaveBeenCalled();
  });
  it("does not clear conservative shared holds with additional configured accounts", async () => {
    m.accounts.mockResolvedValue([{ ...account, connectionId: "additional-account" }]);
    expect(await check()).toBe(false); expect(m.poolWrite).not.toHaveBeenCalled(); expect(m.capacityWrite).not.toHaveBeenCalled();
  });
  it("a failed usage read leaves all existing holds intact", async () => {
    m.read.mockResolvedValue(false);
    expect(await check()).toBe(false); expect(m.poolWrite).not.toHaveBeenCalled(); expect(m.capacityWrite).not.toHaveBeenCalled();
  });
  it("does not lift a request-throttle backoff from an account allocation read", async () => {
    m.capacities.mockResolvedValue([{ id: "capacity", providerId: "codex", ownedAccountId: null, scopeKey: null,
      source: "cli", state: "rate_limited", action: "retry_with_backoff", retryAt: forecast, updatedAt: stamp }]);
    expect(await check()).toBe(false);
    expect(m.poolWrite).not.toHaveBeenCalled(); expect(m.capacityWrite).not.toHaveBeenCalled();
  });
  it("retains a pool deadline that does not match the captured subscription forecast", async () => {
    m.pools.mockResolvedValue([{ id: "pool", providerId: "codex", adapterKind: "codex", adapterType: null,
      scopeKey: "cli:codex-cli:provider:codex", resetAt: new Date(forecast.getTime() + 60_000), updatedAt: stamp }]);
    expect(await check()).toBe(false); expect(m.poolWrite).not.toHaveBeenCalled();
  });
  it("can revalidate an explicit short subscription forecast after an early reset", async () => {
    const short = new Date(Date.now() + 5 * 60_000);
    m.pools.mockResolvedValue([{ id: "pool", providerId: "codex", adapterKind: "codex", adapterType: null,
      scopeKey: "cli:codex-cli:provider:codex", resetAt: short, updatedAt: stamp }]);
    m.capacities.mockResolvedValue([{ id: "capacity", providerId: "codex", ownedAccountId: null, scopeKey: null,
      source: "cli", state: "quota_resets_at", retryAt: short, updatedAt: stamp }]);
    expect(await check()).toBe(true); expect(m.read).toHaveBeenCalledTimes(1);
  });
  it("a sibling with a different upstream identity retains the shared hold", async () => {
    m.auth.mockResolvedValueOnce({ type: "chatgptAuthTokens", chatgptAccountId: "selected" })
      .mockResolvedValueOnce({ type: "chatgptAuthTokens", chatgptAccountId: "other" });
    expect(await check()).toBe(false); expect(m.read).not.toHaveBeenCalled();
  });
  it("stopped job ownership cannot reconcile an otherwise successful read", async () => {
    m.lock.mockResolvedValue([{ enabled: false, schedule: "once", runCursor: "run" }]);
    expect(await check()).toBe(false); expect(m.poolWrite).not.toHaveBeenCalled();
  });
  it("an account pause or changed quota during the read prevents stale writes", async () => {
    m.capture.mockResolvedValueOnce({ accountId: "selected", binding }).mockResolvedValue(null);
    expect(await check()).toBe(false); expect(m.poolWrite).not.toHaveBeenCalled();
  });
  it("a newer failure wins the conditional update", async () => {
    m.poolWrite.mockResolvedValue({ count: 0 });
    await expect(check()).rejects.toThrow("CLI capacity changed");
    expect(m.capacityWrite).not.toHaveBeenCalled();
  });
});
