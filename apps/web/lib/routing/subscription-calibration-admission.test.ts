import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ capture: vi.fn(), proof: vi.fn(), db: {} as any }));
vi.mock("@dpf/db", () => ({ prisma: new Proxy({}, { get: (_, key) => m.db[key] }), Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } } }));
vi.mock("./provider-capacity/execution-proof.server", () => ({ captureExecutionProofBinding: m.capture, readCurrentExecutionProof: m.proof }));
import { calibrationCorpus, calibrationCorpusHash, calibrationJobId, commissionSubscriptionCalibration, validateCalibrationCommission } from "./subscription-calibration-admission";
const proof = () => ({ version: 1, providerId: "chatgpt", connectionId: "provider-default-chatgpt", modelId: "selected", adapter: "responses",
  accountVersion: "a".repeat(64), credentialRevision: "b".repeat(64), modelRevision: "c".repeat(64), endpointRevision: "d".repeat(64), quotaRevision: "e".repeat(64),
  observedAt: Date.now(), expiresAt: Date.now() + 3600_000 });
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.resetAllMocks();
  m.db = { $queryRaw: vi.fn().mockResolvedValue([]), $transaction: (fn: any) => fn(m.db),
    user: { findUnique: vi.fn().mockResolvedValue({ isActive: true, isSuperuser: true, groups: [] }) },
    principal: { findFirst: vi.fn().mockResolvedValue({ id: "principal" }) },
    modelProfile: { findUnique: vi.fn().mockResolvedValue({ modelClass: "chat", outputModalities: ["text"] }) },
    aiProviderConnection: { findUnique: vi.fn().mockResolvedValue({ id: "account", credentialEntryId: "credential", executionChannel: "direct-api", organizationId: null,
      capacityStatus: { executionProof: proof() } }) },
    scheduledJob: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    endpointTestRun: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() } };
  m.capture.mockResolvedValue({ accountId: "account" });
  const p = proof(); m.proof.mockResolvedValue(p);
});
describe("current owned calibration commissioning", () => {
  it("captures one immutable ten-minute allowance when the clock advances between reads", async () => {
    const now = Date.now(); let elapsed = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now + elapsed++);
    const c = await commissionSubscriptionCalibration("operator", "chatgpt", "selected");
    expect(c.deadlineAt - c.admittedAt).toBe(600_000);
  });
  it.each([{ modelClass: "embedding" }, { modelClass: "image_gen" }, { modelClass: "speech" }, { modelClass: "chat", outputModalities: ["audio"] }])("refuses incompatible current model %j even when capacity evidence exists", async model => {
    m.db.modelProfile.findUnique.mockResolvedValue(model);
    await expect(commissionSubscriptionCalibration("operator", "chatgpt", "selected")).rejects.toThrow(/text|identity|incompatible/i);
    expect(m.db.endpointTestRun.create).not.toHaveBeenCalled();
  });
  it("persists the exact non-secret commission before returning its queue identity", async () => {
    const c = await commissionSubscriptionCalibration("operator", "chatgpt", "selected");
    expect(c).toMatchObject({ userId: "operator", principalId: "principal", accountId: "account", credentialId: "credential", corpusHash: calibrationCorpusHash() });
    expect(c.maxCalls).toBe(2 * calibrationCorpus().length);
    expect(c.maxOutputTokens).toBe(2 * calibrationCorpus().reduce((n,t) => n + (t.maxTokens ?? 512), 0));
    expect(c.deadlineAt - c.admittedAt).toBeLessThanOrEqual(600_000);
    expect(m.db.scheduledJob.upsert.mock.calls[0][0].create).toMatchObject({ runCursor: c.runId, metadata: { state: "queued", attempts: [], commission: c } });
    expect(m.db.endpointTestRun.create.mock.calls[0][0].data.runId).toBe(c.runId);
    expect(JSON.stringify(c)).not.toMatch(/cachedToken|refreshToken|secretRef/);
  });
  it.each(["codex", "anthropic-sub", "foreign"])("refuses unsupported transport %s without writes", async provider => {
    await expect(commissionSubscriptionCalibration("operator", provider, "selected")).rejects.toThrow("unsupported");
    expect(m.db.scheduledJob.upsert).not.toHaveBeenCalled();
  });
  it.each(["queued", "running", "unreadable"])("does not replace an unresolved %s commission", async state => {
    m.db.scheduledJob.findUnique.mockResolvedValue({ runCursor: "old", metadata: state === "unreadable" ? {} : { state, commission: { version: 1, runId: "old", deadlineAt: Date.now() }, attempts: [] } });
    await expect(commissionSubscriptionCalibration("operator", "chatgpt", "selected")).rejects.toThrow("unresolved");
    expect(m.db.scheduledJob.upsert).not.toHaveBeenCalled();
  });
  it("holds legacy work beyond the former ten-minute cutoff", async () => {
    m.db.endpointTestRun.findFirst.mockResolvedValue({ runId: "legacy", startedAt: new Date(0), status: "running" });
    await expect(commissionSubscriptionCalibration("operator", "chatgpt", "selected")).rejects.toThrow("unknown outcome");
    expect(m.db.scheduledJob.upsert).not.toHaveBeenCalled();
  });
  it.each([{ isActive: false }, { isSuperuser: false, groups: [] }, { workHandedOverAt: new Date() }, { automationExpiresAt: new Date(0) }])("refuses current operator authority loss %j", async change => {
    m.db.user.findUnique.mockResolvedValue({ isActive: true, isSuperuser: true, groups: [], ...change });
    await expect(commissionSubscriptionCalibration("operator", "chatgpt", "selected")).rejects.toThrow("Current operator");
    expect(m.db.endpointTestRun.create).not.toHaveBeenCalled();
  });
  it("does not materialize a missing human principal", async () => {
    m.db.principal.findFirst.mockResolvedValue(null);
    await expect(commissionSubscriptionCalibration("operator", "chatgpt", "selected")).rejects.toThrow("Current operator");
  });
  it.each([{ organizationId: "foreign" }, { executionChannel: "subscription-cli" }, { credentialEntryId: "rotated" }, { id: "replacement" }])("refuses changed exact ownership %j before any write", async change => {
    const c = await commissionSubscriptionCalibration("operator", "chatgpt", "selected");
    m.db.aiProviderConnection.findUnique.mockResolvedValue({ id: "account", credentialEntryId: "credential", executionChannel: "direct-api", organizationId: null, capacityStatus: { executionProof: c.proof }, ...change });
    expect(await validateCalibrationCommission(c)).toBe(false);
  });
  it("keeps identity stable across JSONB property ordering and rejects a replacement proof", async () => {
    const c = await commissionSubscriptionCalibration("operator", "chatgpt", "selected");
    m.proof.mockResolvedValue(Object.fromEntries(Object.entries(c.proof).reverse()));
    expect(await validateCalibrationCommission(c)).toBe(true);
    m.proof.mockResolvedValue({ ...c.proof, credentialRevision: "f".repeat(64) });
    expect(await validateCalibrationCommission(c)).toBe(false);
    expect(c.jobId).toBe(calibrationJobId("chatgpt", "selected"));
    expect(c.jobId).not.toBe(calibrationJobId("other", "selected"));
  });
});
