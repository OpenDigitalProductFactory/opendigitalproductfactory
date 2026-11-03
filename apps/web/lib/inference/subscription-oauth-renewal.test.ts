// BI-A53C594E: background renewal of subscription OAuth sign-ins.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RENEWAL_LEAD_MS,
  SIGN_IN_REQUIRED_STATUS,
  renewalRetryDelayMs,
  runSubscriptionOAuthRenewal,
  subscriptionRenewalJobId,
  type RenewalAttempt,
} from "./subscription-oauth-renewal";

const NOW = new Date("2026-10-28T06:00:00Z");
const minutes = (n: number) => n * 60_000;

type Credential = { status: string; tokenExpiresAt: Date | null; updatedAt: Date; refreshToken: string | null };
type Connection = { connectionId: string; providerId: string; status: string; authMethod: string; credentialEntry: Credential | null };
type JobRow = { jobId: string; lastStatus: string | null; lastRunAt: Date | null; nextRunAt: Date | null; lastError: string | null; lastRunSummary?: string | null; metadata: unknown };

let connections: Connection[];
let jobs: Map<string, JobRow>;

function connection(overrides: Partial<Connection> & { expiresInMs?: number; credentialStatus?: string } = {}): Connection {
  const { expiresInMs = minutes(30), credentialStatus = "ok", ...rest } = overrides;
  return {
    connectionId: "provider-default-anthropic-sub",
    providerId: "anthropic-sub",
    status: "active",
    authMethod: "oauth",
    credentialEntry: { status: credentialStatus, tokenExpiresAt: new Date(NOW.getTime() + expiresInMs), updatedAt: new Date("2026-10-27T22:00:00Z"), refreshToken: "enc:present" },
    ...rest,
  };
}

const db = {
  aiProviderConnection: {
    findMany: vi.fn(async () => connections.map(({ connectionId, providerId }) => ({ connectionId, providerId }))),
    findUnique: vi.fn(async ({ where }: { where: { connectionId: string } }) => connections.find((row) => row.connectionId === where.connectionId) ?? null),
  },
  scheduledJob: {
    findUnique: vi.fn(async ({ where }: { where: { jobId: string } }) => jobs.get(where.jobId) ?? null),
    upsert: vi.fn(async ({ where, create, update }: { where: { jobId: string }; create: JobRow; update: Partial<JobRow> }) => {
      const prior = jobs.get(where.jobId);
      const row = prior ? { ...prior, ...update } : { ...create };
      jobs.set(where.jobId, row as JobRow);
      return row;
    }),
  },
};

function run(renew: (providerId: string, connectionId: string) => Promise<RenewalAttempt>, now = NOW) {
  return runSubscriptionOAuthRenewal({ db: db as never, renew: vi.fn(renew), now });
}

describe("runSubscriptionOAuthRenewal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connections = [connection()];
    jobs = new Map();
  });

  it("only considers active authorization-code sign-ins that hold a refresh token", async () => {
    await run(async () => ({ kind: "renewed" }));
    expect(db.aiProviderConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        authMethod: { in: ["oauth", "oauth2_authorization_code"] },
        status: { in: ["active", "degraded"] },
        credentialEntry: { is: { refreshToken: { not: null } } },
      }),
    }));
  });

  it("renews a sign-in ahead of its expiry with no page view", async () => {
    const renew = vi.fn(async () => ({ kind: "renewed" }) as RenewalAttempt);
    const result = await runSubscriptionOAuthRenewal({ db: db as never, renew, now: NOW });
    expect(renew).toHaveBeenCalledWith("anthropic-sub", "provider-default-anthropic-sub");
    expect(result.outcomes).toEqual([{ connectionId: "provider-default-anthropic-sub", providerId: "anthropic-sub", outcome: "renewed" }]);
    expect(jobs.get(subscriptionRenewalJobId("provider-default-anthropic-sub"))).toMatchObject({ lastStatus: "ok", nextRunAt: null });
  });

  it("leaves a sign-in alone while it is outside the renewal window", async () => {
    connections = [connection({ expiresInMs: RENEWAL_LEAD_MS + minutes(5) })];
    const renew = vi.fn(async () => ({ kind: "renewed" }) as RenewalAttempt);
    const result = await runSubscriptionOAuthRenewal({ db: db as never, renew, now: NOW });
    expect(renew).not.toHaveBeenCalled();
    expect(result.outcomes[0]!.outcome).toBe("not-due");
    expect(db.scheduledJob.upsert).not.toHaveBeenCalled();
  });

  it("retries a transient refusal with backoff and records why, then renews", async () => {
    const id = subscriptionRenewalJobId("provider-default-anthropic-sub");
    await run(async () => ({ kind: "failed", reason: "OAuth token renewal failed (HTTP 403)" }));
    expect(jobs.get(id)).toMatchObject({
      lastStatus: "retrying",
      lastError: expect.stringContaining("HTTP 403"),
      nextRunAt: new Date(NOW.getTime() + renewalRetryDelayMs(0)),
      metadata: expect.objectContaining({ failures: 1 }),
    });

    // Inside the backoff window nothing is attempted.
    const early = vi.fn(async () => ({ kind: "renewed" }) as RenewalAttempt);
    const waiting = await runSubscriptionOAuthRenewal({ db: db as never, renew: early, now: new Date(NOW.getTime() + minutes(1)) });
    expect(early).not.toHaveBeenCalled();
    expect(waiting.outcomes[0]!.outcome).toBe("backing-off");

    // A second failure doubles the wait.
    const second = new Date(NOW.getTime() + renewalRetryDelayMs(0));
    await run(async () => ({ kind: "failed", reason: "Token refresh network error" }), second);
    expect(jobs.get(id)).toMatchObject({ lastStatus: "retrying", nextRunAt: new Date(second.getTime() + renewalRetryDelayMs(1)), metadata: expect.objectContaining({ failures: 2 }) });

    const third = new Date(second.getTime() + renewalRetryDelayMs(1));
    const recovered = await run(async () => ({ kind: "renewed" }), third);
    expect(recovered.outcomes[0]!.outcome).toBe("renewed");
    expect(jobs.get(id)).toMatchObject({ lastStatus: "ok", lastError: null, metadata: expect.objectContaining({ failures: 0 }) });
  });

  it("caps the backoff so an expiring sign-in is retried within hours, not days", () => {
    expect(renewalRetryDelayMs(0)).toBe(minutes(10));
    expect(renewalRetryDelayMs(1)).toBe(minutes(20));
    expect(renewalRetryDelayMs(20)).toBe(minutes(120));
  });

  it("stops retrying on a confirmed refusal and records it once for the operator", async () => {
    const id = subscriptionRenewalJobId("provider-default-anthropic-sub");
    const first = await run(async () => ({ kind: "refused", reason: "Selected account re-authentication required" }));
    expect(first.outcomes[0]!.outcome).toBe("sign-in-required");
    expect(jobs.get(id)).toMatchObject({ lastStatus: SIGN_IN_REQUIRED_STATUS, nextRunAt: null, lastError: expect.stringContaining("re-authentication required") });
    const writes = db.scheduledJob.upsert.mock.calls.length;

    connections = [connection({ credentialStatus: "expired", expiresInMs: -minutes(5) })];
    const renew = vi.fn(async () => ({ kind: "renewed" }) as RenewalAttempt);
    const later = await runSubscriptionOAuthRenewal({ db: db as never, renew, now: new Date(NOW.getTime() + minutes(30)) });
    expect(renew).not.toHaveBeenCalled();
    expect(later.outcomes[0]!.outcome).toBe("awaiting-sign-in");
    expect(db.scheduledJob.upsert.mock.calls.length).toBe(writes);
  });

  it("resumes renewal once the operator signs in again", async () => {
    const id = subscriptionRenewalJobId("provider-default-anthropic-sub");
    jobs.set(id, { jobId: id, lastStatus: SIGN_IN_REQUIRED_STATUS, lastRunAt: new Date("2026-10-27T20:00:00Z"), nextRunAt: null, lastError: "refused", metadata: { kind: "subscription-oauth-renewal", failures: 0 } });
    connections = [connection({ expiresInMs: minutes(400) })];
    connections[0]!.credentialEntry!.updatedAt = new Date("2026-10-27T21:00:00Z");
    const result = await run(async () => ({ kind: "renewed" }));
    expect(result.outcomes[0]!.outcome).toBe("not-due");
    expect(jobs.get(id)).toMatchObject({ lastStatus: "ok", lastError: null });
  });

  it("keeps renewing other accounts when one renewal throws", async () => {
    connections = [connection(), connection({ connectionId: "provider-default-codex", providerId: "codex" })];
    const result = await run(async (providerId) => {
      if (providerId === "anthropic-sub") throw new Error("boom");
      return { kind: "renewed" };
    });
    expect(result.outcomes.map((row) => row.outcome)).toEqual(["retry-scheduled", "renewed"]);
  });
});
