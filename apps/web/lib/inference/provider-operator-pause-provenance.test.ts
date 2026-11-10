import { describe, expect, it, vi } from "vitest";
import { pauseOperatorProvider, resumeOperatorProvider, RecentOperatorResumeError, type PauseDatabase, type PauseProvenance } from "./provider-operator-pause";

vi.mock("@/lib/install/instance-stance", () => ({ loadInstanceStance: vi.fn(), prismaInstanceStanceStore: (db: unknown) => db }));

type Job = { jobId: string; metadata: Record<string, unknown>; lastStatus: string; nextRunAt: Date | null; enabled: boolean };
type Audit = { userId: string; result: string; parameters: Record<string, unknown> };
function fixture() {
  let state = {
    provider: { providerId: "local", status: "active" },
    connection: { providerId: "local", connectionId: "provider-default-local", status: "active" },
    job: null as Job | null,
    audit: [] as Audit[],
  };
  const tx = {
    adminActivity: { create: vi.fn(async ({ data }: { data: Audit }) => { state.audit.push(data); return data; }) },
    $queryRaw: vi.fn(async () => []),
    modelProvider: {
      findUnique: vi.fn(async () => state.provider),
      update: vi.fn(async ({ data }: { data: { status: string } }) => Object.assign(state.provider, data)),
    },
    aiProviderConnection: {
      findUnique: vi.fn(async () => state.connection),
      update: vi.fn(async ({ data }: { data: { status: string } }) => Object.assign(state.connection, data)),
      updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
        if (state.connection.status !== where.status) return { count: 0 };
        Object.assign(state.connection, data); return { count: 1 };
      }),
    },
    scheduledJob: {
      findUnique: vi.fn(async () => state.job),
      upsert: vi.fn(async ({ create, update }: { create: Job; update: Partial<Job> }) => {
        state.job = state.job ? Object.assign(state.job, update) : create;
        return state.job;
      }),
      update: vi.fn(async ({ data }: { data: Partial<Job> }) => Object.assign(state.job!, data)),
    },
  };
  const db = { ...tx, $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => {
    const prior = structuredClone(state);
    try { return await run(tx); } catch (error) { state = prior; throw error; }
  }) };
  let generation = 0;
  const deps = (now: string) => ({ db: db as unknown as PauseDatabase, now: new Date(now), send: vi.fn(async () => undefined), probe: vi.fn(async () => true), newId: () => `pause-${++generation}` });
  return { get state() { return state; }, deps };
}
const provenance = (reason = "Freeing the GPU for a model swap"): PauseProvenance => ({
  reason, userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/142", clientIp: "172.18.0.1", sessionFingerprint: "3f2a9c01d4e5b6a7", email: "operator-account",
});

describe("operator pause provenance (BI-1C36C88A)", () => {
  it("refuses an operator pause without a reason and leaves routing unchanged", async () => {
    const f = fixture();
    await expect(pauseOperatorProvider({ providerId: "local", actorId: "operator", provenance: provenance("  ") }, f.deps("2026-11-05T00:00:00Z")))
      .rejects.toThrow("Enter a reason for pausing");
    expect(f.state.connection.status).toBe("active");
    expect(f.state.provider.status).toBe("active");
  });
  it("records the reason and the client fingerprint on the pause and the resume", async () => {
    const f = fixture();
    await pauseOperatorProvider({ providerId: "local", actorId: "operator", provenance: provenance() }, f.deps("2026-11-05T00:00:00Z"));
    expect(f.state.job?.metadata).toMatchObject({ reason: "Freeing the GPU for a model swap" });
    expect(f.state.audit[0].parameters).toMatchObject({
      action: "pause", reason: "Freeing the GPU for a model swap", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/142",
      clientIp: "172.18.0.1", sessionFingerprint: "3f2a9c01d4e5b6a7", email: "operator-account",
    });
    const { reason: _reason, ...client } = provenance();
    await resumeOperatorProvider({ providerId: "local", actorId: "operator", provenance: client }, f.deps("2026-11-05T00:05:00Z"));
    expect(f.state.audit[1].parameters).toMatchObject({ action: "resume", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/142", sessionFingerprint: "3f2a9c01d4e5b6a7" });
  });
  it("refuses a pause within 15 minutes of an operator resume, naming the resume, and audits the refusal", async () => {
    const f = fixture();
    await pauseOperatorProvider({ providerId: "local", actorId: "operator", provenance: provenance() }, f.deps("2026-11-05T00:00:00Z"));
    await resumeOperatorProvider({ providerId: "local", actorId: "resumer" }, f.deps("2026-11-05T00:39:20Z"));
    const attempt = pauseOperatorProvider({ providerId: "local", actorId: "operator", provenance: provenance() }, f.deps("2026-11-05T00:40:34Z"));
    await expect(attempt).rejects.toBeInstanceOf(RecentOperatorResumeError);
    await expect(attempt).rejects.toThrow(/resumed by resumer at 2026-11-05T00:39:20.000Z/);
    expect(f.state.connection.status).toBe("active");
    expect(f.state.audit.at(-1)).toMatchObject({ result: "refused", parameters: { action: "pause", refusal: "recent-operator-resume", reason: "Freeing the GPU for a model swap", sessionFingerprint: "3f2a9c01d4e5b6a7" } });
  });
  it("lets the operator override the recent resume explicitly", async () => {
    const f = fixture();
    await pauseOperatorProvider({ providerId: "local", actorId: "operator", provenance: provenance() }, f.deps("2026-11-05T00:00:00Z"));
    await resumeOperatorProvider({ providerId: "local", actorId: "resumer" }, f.deps("2026-11-05T00:39:20Z"));
    await pauseOperatorProvider({ providerId: "local", actorId: "operator", provenance: provenance(), overrideRecentResume: true }, f.deps("2026-11-05T00:40:34Z"));
    expect(f.state.connection.status).toBe("paused");
    expect(f.state.audit.at(-1)?.parameters).toMatchObject({ action: "pause", overrodeRecentResume: true });
  });
  it("does not hold back a pause after the window or after a timer expiry", async () => {
    const f = fixture();
    await pauseOperatorProvider({ providerId: "local", actorId: "operator", provenance: provenance() }, f.deps("2026-11-05T00:00:00Z"));
    await resumeOperatorProvider({ providerId: "local", actorId: "resumer" }, f.deps("2026-11-05T00:39:20Z"));
    await pauseOperatorProvider({ providerId: "local", actorId: "operator", provenance: provenance(), duration: { value: 1, unit: "hours" } }, f.deps("2026-11-05T00:54:21Z"));
    expect(f.state.connection.status).toBe("paused");
    const operationId = String(f.state.job?.metadata.operationId);
    await resumeOperatorProvider({ providerId: "local", operationId, automatic: true }, f.deps("2026-11-05T01:54:21Z"));
    await pauseOperatorProvider({ providerId: "local", actorId: "operator", provenance: provenance() }, f.deps("2026-11-05T01:55:00Z"));
    expect(f.state.connection.status).toBe("paused");
  });
});
