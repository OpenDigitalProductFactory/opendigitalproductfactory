// An automatic provider disable recovers on its own (BI-D28A4F55).

import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: vi.fn() } }));

import {
  PROVIDER_RECOVERY_EVENT,
  autoDisableProvider,
  nextAttempt,
  providerRecoveryJobId,
  recoveryDelayMs,
  runProviderRecovery,
} from "./provider-auto-disable";

const NOW = new Date("2026-10-01T12:00:00Z");

function fakeDb(provider: Record<string, unknown> | null, job: Record<string, unknown> | null) {
  const state = { provider: provider ? { ...provider } : null, job: job ? { ...job } : null };
  const db = {
    modelProvider: {
      findUnique: vi.fn(async () => state.provider),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.provider = { ...state.provider, ...data }; return state.provider; }),
    },
    scheduledJob: {
      findUnique: vi.fn(async () => state.job),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => { state.job = state.job ? { ...state.job, ...update } : create; return state.job; }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.job = { ...state.job, ...data }; return state.job; }),
    },
  };
  return { db: db as never, state };
}

const autoJob = (attempt: number, lastStatus = "scheduled", lastRunAt: Date | null = null) => ({
  jobId: providerRecoveryJobId("anthropic-sub"),
  lastStatus,
  lastRunAt,
  metadata: { kind: "auto-disable", cause: "auth", source: "fallback-chain", attempt },
});

describe("backoff", () => {
  it("doubles from 15 minutes and caps at 6 hours", () => {
    expect(recoveryDelayMs(0)).toBe(15 * 60_000);
    expect(recoveryDelayMs(1)).toBe(30 * 60_000);
    expect(recoveryDelayMs(10)).toBe(6 * 60 * 60_000);
  });

  it("continues only while a recovery is recent, and starts over after a day", () => {
    expect(nextAttempt(null, NOW)).toBe(0);
    expect(nextAttempt(autoJob(2, "half-open", new Date(NOW.getTime() - 60_000)), NOW)).toBe(3);
    expect(nextAttempt(autoJob(2, "half-open", new Date(NOW.getTime() - 25 * 3600_000)), NOW)).toBe(0);
    expect(nextAttempt({ lastStatus: "completed", lastRunAt: NOW, metadata: { quota: true } }, NOW)).toBe(0);
  });
});

describe("autoDisableProvider", () => {
  it("disables, records why and from where, and sends a durable recovery event", async () => {
    const { db, state } = fakeDb({ providerId: "anthropic-sub", status: "active" }, null);
    const send = vi.fn();
    const result = await autoDisableProvider({ providerId: "anthropic-sub", cause: "auth", source: "fallback-chain", detail: "401", now: NOW }, { db, send });
    expect(state.provider?.status).toBe("disabled");
    expect(state.job).toMatchObject({ lastStatus: "scheduled", metadata: { kind: "auto-disable", cause: "auth", source: "fallback-chain", attempt: 0 } });
    expect(String(state.job?.lastError)).toContain("Automatically disabled after a auth error");
    expect(send).toHaveBeenCalledWith({ name: PROVIDER_RECOVERY_EVENT, data: { providerId: "anthropic-sub", attempt: 0, delayMs: 15 * 60_000 } });
    expect(result.nextRunAt.getTime()).toBe(NOW.getTime() + 15 * 60_000);
  });
});

describe("runProviderRecovery", () => {
  it("refreshes an OAuth credential and re-enables the provider half-open", async () => {
    const { db, state } = fakeDb({ providerId: "anthropic-sub", status: "disabled", authMethod: "oauth2_authorization_code" }, autoJob(0));
    const refresh = vi.fn(async () => ({ token: "t" }));
    expect(await runProviderRecovery({ providerId: "anthropic-sub", attempt: 0, now: NOW }, { db, refresh })).toBe("recovered");
    expect(state.provider?.status).toBe("active");
    expect(state.job?.lastStatus).toBe("half-open");
  });

  it("stays disabled and reschedules with a longer wait when the refresh fails", async () => {
    const { db, state } = fakeDb({ providerId: "anthropic-sub", status: "disabled", authMethod: "oauth2_authorization_code" }, autoJob(0));
    const send = vi.fn();
    const refresh = vi.fn(async () => ({ error: "Re-authentication required" }));
    expect(await runProviderRecovery({ providerId: "anthropic-sub", attempt: 0, now: NOW }, { db, refresh, send })).toBe("still-failing");
    expect(state.provider?.status).toBe("disabled");
    expect(state.job).toMatchObject({ lastStatus: "scheduled", metadata: { attempt: 1 } });
    expect(String(state.job?.lastError)).toContain("sign in to anthropic-sub again");
    expect(send).toHaveBeenCalledWith({ name: PROVIDER_RECOVERY_EVENT, data: { providerId: "anthropic-sub", attempt: 1, delayMs: 30 * 60_000 } });
  });

  it("re-opens a non-OAuth provider half-open after the wait", async () => {
    const { db, state } = fakeDb({ providerId: "openrouter", status: "disabled", authMethod: "api_key" }, { ...autoJob(1), jobId: providerRecoveryJobId("openrouter") });
    expect(await runProviderRecovery({ providerId: "openrouter", attempt: 1, now: NOW }, { db })).toBe("recovered");
    expect(state.provider?.status).toBe("active");
  });

  it("stands down when an administrator acted, or a newer attempt superseded this one", async () => {
    const enabled = fakeDb({ providerId: "anthropic-sub", status: "active", authMethod: "oauth2_authorization_code" }, autoJob(0));
    expect(await runProviderRecovery({ providerId: "anthropic-sub", attempt: 0, now: NOW }, { db: enabled.db })).toBe("not-auto-disabled");
    const turnedOff = fakeDb({ providerId: "anthropic-sub", status: "inactive" }, autoJob(0));
    expect(await runProviderRecovery({ providerId: "anthropic-sub", attempt: 0, now: NOW }, { db: turnedOff.db })).toBe("not-auto-disabled");
    const superseded = fakeDb({ providerId: "anthropic-sub", status: "disabled" }, autoJob(2));
    expect(await runProviderRecovery({ providerId: "anthropic-sub", attempt: 0, now: NOW }, { db: superseded.db })).toBe("not-auto-disabled");
    expect(superseded.state.provider?.status).toBe("disabled");
  });
});
