import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ account: vi.fn(), provider: vi.fn(), capacity: vi.fn(), job: vi.fn(),
  upsert: vi.fn(), claim: vi.fn(), update: vi.fn(), lock: vi.fn(), capture: vi.fn(), probe: vi.fn(), reconcile: vi.fn(), health: vi.fn(), record: vi.fn() }));
vi.mock("@dpf/db", () => {
  const db = { aiProviderConnection: { findUnique: mocks.account }, modelProvider: { findUnique: mocks.provider },
    providerCapacityStatus: { findUnique: mocks.capacity },
    scheduledJob: { findUnique: mocks.job, upsert: mocks.upsert, updateMany: mocks.claim, update: mocks.update }, $queryRaw: mocks.lock };
  return { prisma: { ...db, $transaction: (run: (tx: typeof db) => unknown) => run(db) } };
});
vi.mock("@/lib/actions/provider-auth-test", () => ({ testProviderAuthInternal: mocks.probe }));
vi.mock("@/lib/actions/provider-quota-revalidation", () => ({ captureProviderQuotaObservation: mocks.capture }));
vi.mock("./provider-capacity/store", () => ({ reconcileProviderQuotaObservation: mocks.reconcile,
  loadProviderCapacitySnapshots: mocks.health, recordProviderCapacityStatus: mocks.record, capacityAccountIdentity: () => ({ accountId: "account-1" }) }));
import { nextSubscriptionQuotaCheck } from "./subscription-quota-policy";
import { recheckSubscriptionQuotas } from "./subscription-quota-recovery";
const now = new Date("2026-10-15T12:00:00Z");
const revision = new Date("2026-10-13T00:00:00Z");
const account = { connectionId: "provider-default-chatgpt", providerId: "chatgpt", organizationId: null,
  status: "active", authMethod: "oauth", credentialEntryId: "credential-1", updatedAt: revision,
  credentialEntry: { id: "credential-1", updatedAt: revision, cachedToken: "sealed-test-fixture", refreshToken: null } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.health.mockResolvedValue(new Map());
  mocks.account.mockImplementation(async ({ where }: { where: { connectionId: string } }) => where.connectionId === account.connectionId ? account : null);
  mocks.provider.mockResolvedValue({ status: "active" });
  mocks.capacity.mockResolvedValue({ id: "capacity-1", state: "quota_resets_at", retryAt: new Date("2026-10-20T00:00:00Z"), lastObservedAt: revision, updatedAt: revision, isHumanActionRequired: false });
  mocks.job.mockResolvedValue(null); mocks.claim.mockResolvedValue({ count: 1 });
  mocks.capture.mockResolvedValue({ id: "capacity-1", providerId: "chatgpt", state: "quota_resets_at", updatedAt: revision, ownerConnectionId: account.connectionId });
  mocks.probe.mockResolvedValue({ ok: true }); mocks.lock.mockResolvedValue([{ connectionId: account.connectionId }]);
  mocks.reconcile.mockResolvedValue("cleared");
});
describe("bounded hourly subscription quota recovery", () => {
  it("checks before a distant provider reset and clears only completed unchanged evidence", async () => {
    expect(await recheckSubscriptionQuotas(now)).toEqual([{ providerId: "chatgpt", outcome: "cleared" }]);
    expect(mocks.probe).toHaveBeenCalledExactlyOnceWith("chatgpt", false, account.connectionId, { verificationOnly: true });
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(mocks.probe.mock.invocationCallOrder[0]);
  });
  it.each(["paused", "disabled", "disconnected"])("leaves a %s account untouched", async status => {
    mocks.account.mockResolvedValue({ ...account, status });
    expect(await recheckSubscriptionQuotas(now)).toEqual([]);
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it.each(["reauth_required", "billing_action_required", "unsupported_plan"])("does not probe a hard %s hold", async state => {
    mocks.capacity.mockResolvedValue({ state });
    await recheckSubscriptionQuotas(now);
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it("does not clear on rejected or incomplete inference", async () => {
    mocks.probe.mockResolvedValue({ ok: false });
    expect(await recheckSubscriptionQuotas(now)).toEqual([{ providerId: "chatgpt", outcome: "still-limited" }]);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("records a newly proven hard failure on its account and stops subsequent automatic probes", async () => {
    const failure = { state: "reauth_required", action: "reconnect", isHumanActionRequired: true };
    mocks.probe.mockResolvedValue({ ok: false, capacityFailure: failure });
    expect(await recheckSubscriptionQuotas(now)).toEqual([{ providerId: "chatgpt", outcome: "needs-attention" }]);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ providerId: "chatgpt", classification: failure, account: { accountId: "account-1" } }));
    mocks.health.mockResolvedValue(new Map([["chatgpt:account:provider-default-chatgpt", failure]]));
    mocks.probe.mockClear();
    await recheckSubscriptionQuotas(new Date(now.getTime() + 3_600_000));
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it("retains a concurrent pause or changed credential after inference", async () => {
    mocks.probe.mockImplementation(async () => { mocks.account.mockResolvedValue({ ...account, status: "paused" }); return { ok: true }; });
    expect(await recheckSubscriptionQuotas(now)).toEqual([{ providerId: "chatgpt", outcome: "changed" }]);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("does not run twice within an hour or when another worker claimed the attempt", async () => {
    mocks.job.mockResolvedValue({ lastRunAt: new Date(now.getTime() - 1000) });
    await recheckSubscriptionQuotas(now);
    expect(mocks.probe).not.toHaveBeenCalled();
    mocks.job.mockResolvedValue(null); mocks.claim.mockResolvedValue({ count: 0 });
    await recheckSubscriptionQuotas(now);
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it("calculates from the latest observation or attempt without changing the estimate", () => {
    expect(nextSubscriptionQuotaCheck(revision, now)).toEqual(new Date(now.getTime() + 3_600_000));
    expect(nextSubscriptionQuotaCheck(null, null)).toBeNull();
  });
});
