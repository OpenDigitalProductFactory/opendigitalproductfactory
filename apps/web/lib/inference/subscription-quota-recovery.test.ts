import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  capture: vi.fn(), inspect: vi.fn(), persist: vi.fn(), invalidate: vi.fn(), read: vi.fn(), observe: vi.fn(), requests: vi.fn(), account: vi.fn(),
  jobs: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: { aiProviderConnection: { findUnique: mocks.account }, scheduledJob: mocks.jobs, providerCapacityStatus: { findUnique: vi.fn(async () => ({ executionProof: {} })) } } }));
vi.mock("@/lib/routing/provider-capacity/execution-proof.server", () => ({ captureExecutionProofBinding: mocks.capture, persistExecutionProof: mocks.persist,
  inspectExecutionProofBinding: mocks.inspect, invalidateExecutionProof: mocks.invalidate, readCurrentExecutionProof: mocks.read }));
vi.mock("@/lib/inference/provider-auth-verification", () => ({ testProviderAuthInternal: mocks.observe }));
vi.mock("@/lib/routing/governed-inference-deadline", () => ({ assertGovernedInferenceAuthority: async () => undefined }));
vi.mock("@/lib/routing/local-provider-capacity", () => ({ assertProviderDispatchCapacity: async () => undefined }));
import { nextQuotaRecheckAt, quotaRecoveryCommission, recheckSubscriptionQuota, runSubscriptionQuotaRecovery, stopSubscriptionQuotaRecovery } from "./subscription-quota-recovery";

const now = Date.parse("2026-10-30T02:00:00Z");
const binding = { providerId: "chatgpt", connectionId: "provider-default-chatgpt", modelId: "target", adapter: "responses",
  accountVersion: "a".repeat(64), credentialRevision: "b".repeat(64), modelRevision: "c".repeat(64), endpointRevision: "d".repeat(64), quotaRevision: "e".repeat(64) };
const captured = { accountId: "owned", binding, quotaRows: [], resetTimes: [], hasQuota: true };
let job: { jobId: string; enabled: boolean; schedule: string; updatedAt: Date; nextRunAt: Date | null; lastRunAt: Date | null; lastStatus: string | null; metadata: unknown; runCursor?: string };
beforeEach(() => {
  vi.clearAllMocks();
  job = { jobId: "subscription-quota-recovery:provider-default-chatgpt", enabled: true, schedule: "once", updatedAt: new Date(), nextRunAt: null, lastRunAt: null, lastStatus: null,
    metadata: { kind: "subscription-quota-recovery", version: 1, modelId: "target", hourly: true } };
  mocks.capture.mockResolvedValue(captured); mocks.persist.mockResolvedValue(true); mocks.read.mockResolvedValue({ ...binding });
  mocks.inspect.mockImplementation(async () => ({ captured: await mocks.capture() }));
  mocks.account.mockResolvedValue({ connectionId: binding.connectionId, providerId: binding.providerId, organizationId: null });
  mocks.jobs.upsert.mockImplementation(async () => ({ ...job }));
  mocks.jobs.findUnique.mockImplementation(async () => ({ ...job }));
  mocks.jobs.findUniqueOrThrow.mockImplementation(async () => ({ ...job }));
  mocks.jobs.findMany.mockImplementation(async () => [{ ...job }]);
  mocks.jobs.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.enabled === true && !job.enabled || where.runCursor && where.runCursor !== job.runCursor) return { count: 0 };
    Object.assign(job, data); return { count: 1 };
  });
  mocks.observe.mockImplementation(async (_provider, _catalog, _account, options) => {
    await options.observation.beforeDispatch(); mocks.requests(); await options.observation.completed(); return { ok: true, message: "completed" };
  });
});
describe("bounded subscription quota recovery", () => {
  it("respects short authoritative waits and rechecks distant forecasts hourly", () => {
    expect(nextQuotaRecheckAt(now, [new Date(now + 5 * 60_000)])).toBe(now + 5 * 60_000);
    expect(nextQuotaRecheckAt(now, [new Date(now + 7 * 86400_000)])).toBe(now + 3600_000);
    expect(nextQuotaRecheckAt(now, [new Date(now - 1), null])).toBe(now + 3600_000);
    expect(nextQuotaRecheckAt(now, [])).toBe(now + 3600_000);
  });
  it("only an explicit persisted hourly commission can authorize a sweep", () => {
    expect(quotaRecoveryCommission({ kind: "subscription-quota-recovery", version: 1, modelId: "gpt-6.1-sol", hourly: true })).toEqual({ modelId: "gpt-6.1-sol", hourly: true });
    for (const metadata of [null, {}, { hourly: true }, { kind: "subscription-quota-recovery", version: 1, modelId: "", hourly: true },
      { kind: "subscription-quota-recovery", version: 2, modelId: "other", hourly: true }]) expect(quotaRecoveryCommission(metadata)).toBeNull();
    expect(quotaRecoveryCommission({ kind: "subscription-quota-recovery", version: 1, modelId: "tested", hourly: false })).toEqual({ modelId: "tested", hourly: false });
  });
  it("records one exact observation and never executes original work", async () => {
    expect(await recheckSubscriptionQuota(binding.connectionId, "target")).toMatchObject({ ok: true, modelId: "target" });
    expect(mocks.requests).toHaveBeenCalledTimes(1);
    expect(mocks.observe).toHaveBeenCalledWith("chatgpt", false, binding.connectionId, expect.objectContaining({ verificationOnly: true, observation: expect.objectContaining({ modelId: "target" }) }));
    expect(mocks.persist).toHaveBeenCalledWith(captured, expect.any(Number), expect.objectContaining({ jobId: job.jobId, runCursor: job.runCursor }));
    expect(job.lastStatus).toBe("recovered");
  });
  it("does not send a request after account/credential/quota ownership changes", async () => {
    mocks.capture.mockResolvedValueOnce(captured).mockResolvedValue(null);
    expect(await recheckSubscriptionQuota(binding.connectionId, "target")).toMatchObject({ ok: false });
    expect(mocks.requests).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("requires reconciliation for an unsupported account quota before any request or job write", async () => {
    mocks.inspect.mockResolvedValue({ captured: null, blockedReason: "owned-account-quota" });
    expect(await recheckSubscriptionQuota(binding.connectionId, "target", true)).toMatchObject({ ok: false, observationCompleted: false,
      message: expect.stringContaining("Reconciliation is required") });
    expect(mocks.observe).not.toHaveBeenCalled(); expect(mocks.jobs.upsert).not.toHaveBeenCalled();
    expect(mocks.jobs.updateMany).not.toHaveBeenCalled(); expect(mocks.invalidate).not.toHaveBeenCalled();
  });
  it("respects a short window without an inference request", async () => {
    mocks.capture.mockResolvedValue({ ...captured, resetTimes: [new Date(Date.now() + 5 * 60_000)] });
    expect(await recheckSubscriptionQuota(binding.connectionId, "target")).toMatchObject({ ok: false, message: expect.stringContaining("short wait") });
    expect(mocks.observe).not.toHaveBeenCalled(); expect(job.lastStatus).toBe("waiting");
  });
  it.each(["paused", "already-running"])("does not dispatch a %s recovery job", async state => {
    if (state === "paused") job.enabled = false;
    else { job.lastStatus = "running"; job.nextRunAt = new Date(Date.now() + 3600_000); }
    expect(await recheckSubscriptionQuota(binding.connectionId, "target")).toMatchObject({ ok: false });
    expect(mocks.observe).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("refuses recovery when the conditional write or fresh readback loses its proof", async () => {
    mocks.persist.mockResolvedValue(false);
    expect(await recheckSubscriptionQuota(binding.connectionId, "target")).toMatchObject({ ok: false });
    expect(job.lastStatus).toBe("unconfirmed");
    expect(mocks.invalidate).toHaveBeenLastCalledWith(binding.connectionId, binding.credentialRevision);
  });
  it("does not opt a viewed or one-off account into hourly inference", async () => {
    job.metadata = { kind: "subscription-quota-recovery", version: 1, modelId: "target", hourly: false };
    expect(await runSubscriptionQuotaRecovery()).toEqual({ checked: 0, outcomes: [] });
    expect(mocks.observe).not.toHaveBeenCalled();
  });
  it("an hourly sweep skips an account whose quota is no longer restricted", async () => {
    mocks.capture.mockResolvedValue({ ...captured, hasQuota: false });
    expect(await runSubscriptionQuotaRecovery()).toEqual({ checked: 0, outcomes: [] });
    expect(mocks.observe).not.toHaveBeenCalled();
  });
  it("an explicit Check now can confirm an early provider reset before the next hourly sweep", async () => {
    job.lastStatus = "unconfirmed"; job.lastRunAt = new Date(Date.now() - 5 * 60_000); job.nextRunAt = new Date(Date.now() + 55 * 60_000);
    expect(await recheckSubscriptionQuota(binding.connectionId, "target")).toMatchObject({ ok: true, observationCompleted: true });
    expect(mocks.requests).toHaveBeenCalledTimes(1);
  });
  it("a repeated click cannot send a second immediate request", async () => {
    expect(await recheckSubscriptionQuota(binding.connectionId, "target")).toMatchObject({ ok: true });
    expect(await recheckSubscriptionQuota(binding.connectionId, "target")).toMatchObject({ ok: false });
    expect(mocks.requests).toHaveBeenCalledTimes(1);
  });
  it.each(["active-stale", "paused", "disconnected"])("stopping an existing %s commission never checks capacity", async status => {
    mocks.account.mockResolvedValue({ connectionId: binding.connectionId, providerId: binding.providerId, organizationId: null, status });
    job.lastRunAt = new Date(Date.now() - 86400_000);
    expect(await stopSubscriptionQuotaRecovery(binding.connectionId)).toMatchObject({ ok: true, observationCompleted: false });
    expect(quotaRecoveryCommission(job.metadata)?.hourly).toBe(false);
    expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.requests).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled(); expect(mocks.invalidate).not.toHaveBeenCalled();
  });
  it("stopping does not create a commission or change a different owner's account", async () => {
    mocks.account.mockResolvedValue({ connectionId: binding.connectionId, providerId: binding.providerId, organizationId: "other-owner" });
    expect(await stopSubscriptionQuotaRecovery(binding.connectionId)).toMatchObject({ ok: false });
    expect(mocks.jobs.updateMany).not.toHaveBeenCalled(); expect(mocks.jobs.upsert).not.toHaveBeenCalled();
    expect(mocks.observe).not.toHaveBeenCalled();
  });
  it("a sweep cannot dispatch after its hourly commission is stopped", async () => {
    mocks.observe.mockImplementation(async (_provider, _catalog, _account, options) => {
      await stopSubscriptionQuotaRecovery(binding.connectionId);
      await options.observation.beforeDispatch(); mocks.requests(); return { ok: true };
    });
    expect(await recheckSubscriptionQuota(binding.connectionId, "target", undefined, { scheduled: true })).toMatchObject({ ok: false });
    expect(mocks.requests).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
    expect(quotaRecoveryCommission(job.metadata)?.hourly).toBe(false);
  });
});
