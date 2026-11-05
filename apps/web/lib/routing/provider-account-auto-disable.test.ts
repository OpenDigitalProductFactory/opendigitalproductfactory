// An automatically switched-off provider account recovers on its own (BI-0ADD46C3).

import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: vi.fn() } }));

import { PROVIDER_RECOVERY_EVENT } from "./provider-auto-disable";
import {
  adoptStrandedProviderAccounts,
  autoDisableProviderAccount,
  providerAccountRecoveryJobId,
  runProviderAccountRecovery,
} from "./provider-account-auto-disable";

const NOW = new Date("2026-11-04T01:00:00Z");
const CONNECTION = "provider-default-anthropic-sub";
const SELECTED_AT = new Date("2026-11-03T17:35:08Z");

type Row = Record<string, unknown>;

function fakeDb(connection: Row | null, job: Row | null, stranded: Row[] = []) {
  const state = { connection: connection ? { ...connection } : null, job: job ? { ...job } : null };
  const matches = (where: Record<string, unknown>) => {
    const row = state.connection;
    if (!row) return false;
    return Object.entries(where).every(([key, value]) => {
      if (value && typeof value === "object" && "in" in (value as object)) return ((value as { in: unknown[] }).in).includes(row[key]);
      if (value instanceof Date) return row[key] instanceof Date && (row[key] as Date).getTime() === value.getTime();
      return row[key] === value;
    });
  };
  const db = {
    aiProviderConnection: {
      findUnique: vi.fn(async () => state.connection),
      findMany: vi.fn(async () => stranded),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
        if (!matches(where)) return { count: 0 };
        state.connection = { ...state.connection, ...data };
        return { count: 1 };
      }),
    },
    scheduledJob: {
      findUnique: vi.fn(async () => state.job),
      upsert: vi.fn(async ({ create, update }: { create: Row; update: Row }) => { state.job = state.job ? { ...state.job, ...update } : create; return state.job; }),
      update: vi.fn(async ({ data }: { data: Row }) => { state.job = { ...state.job, ...data }; return state.job; }),
    },
  };
  return { db: db as never, state, raw: db };
}

const account = (status: string, authMethod = "oauth") => ({
  connectionId: CONNECTION, providerId: "anthropic-sub", status, authMethod, credentialEntryId: "cred-1", updatedAt: SELECTED_AT,
});
const scheduledJob = (attempt: number) => ({
  jobId: providerAccountRecoveryJobId(CONNECTION), lastStatus: "scheduled", lastRunAt: null,
  metadata: { kind: "auto-disable", cause: "billing", source: "fallback-chain", attempt, connectionId: CONNECTION },
});

describe("autoDisableProviderAccount", () => {
  it("switches the selected account off, records why, and sends a recovery event naming the account", async () => {
    const { db, state } = fakeDb(account("active"), null);
    const send = vi.fn();
    const result = await autoDisableProviderAccount({
      providerId: "anthropic-sub", connectionId: CONNECTION, credentialEntryId: "cred-1", updatedAt: SELECTED_AT,
      cause: "billing", source: "fallback-chain", detail: "Payment required", now: NOW,
    }, { db, send });

    expect(result).toEqual({ disabled: true });
    expect(state.connection).toMatchObject({ status: "unconfigured" });
    expect(state.job).toMatchObject({
      jobId: providerAccountRecoveryJobId(CONNECTION), lastStatus: "scheduled", nextRunAt: new Date(NOW.getTime() + 15 * 60_000),
      metadata: { kind: "auto-disable", cause: "billing", source: "fallback-chain", attempt: 0, connectionId: CONNECTION },
    });
    expect(String(state.job!.lastError)).toContain("Payment required");
    expect(send).toHaveBeenCalledWith({ name: PROVIDER_RECOVERY_EVENT, data: { providerId: "anthropic-sub", connectionId: CONNECTION, attempt: 0, delayMs: 15 * 60_000 } });
  });

  it("leaves an account that changed since routing selected it, and schedules nothing", async () => {
    const { db, state } = fakeDb({ ...account("active"), updatedAt: new Date("2026-11-03T18:00:00Z") }, null);
    const send = vi.fn();
    const result = await autoDisableProviderAccount({
      providerId: "anthropic-sub", connectionId: CONNECTION, credentialEntryId: "cred-1", updatedAt: SELECTED_AT, cause: "auth", source: "fallback-chain", now: NOW,
    }, { db, send });
    expect(result).toEqual({ disabled: false });
    expect(state.connection).toMatchObject({ status: "active" });
    expect(state.job).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("runProviderAccountRecovery", () => {
  it("renews an OAuth account and switches it back on, half-open", async () => {
    const { db, state } = fakeDb(account("unconfigured"), scheduledJob(0));
    const renew = vi.fn(async () => ({ renewed: true as const }));
    const outcome = await runProviderAccountRecovery({ providerId: "anthropic-sub", connectionId: CONNECTION, attempt: 0, now: NOW }, { db, renew });
    expect(outcome).toBe("recovered");
    expect(renew).toHaveBeenCalledWith("anthropic-sub", CONNECTION);
    expect(state.connection).toMatchObject({ status: "active" });
    expect(state.job).toMatchObject({ lastStatus: "half-open", lastRunAt: NOW });
  });

  it("switches a non-OAuth account back on without a renewal", async () => {
    const { db, state } = fakeDb(account("unconfigured", "api-key"), scheduledJob(0));
    const renew = vi.fn();
    expect(await runProviderAccountRecovery({ providerId: "anthropic-sub", connectionId: CONNECTION, attempt: 0, now: NOW }, { db, renew })).toBe("recovered");
    expect(renew).not.toHaveBeenCalled();
    expect(state.connection).toMatchObject({ status: "active" });
  });

  it("keeps the account off and backs off further when renewal fails", async () => {
    const { db, state } = fakeDb(account("unconfigured"), scheduledJob(1));
    const send = vi.fn();
    const renew = vi.fn(async () => ({ renewed: false as const, reason: "invalid_grant" }));
    const outcome = await runProviderAccountRecovery({ providerId: "anthropic-sub", connectionId: CONNECTION, attempt: 1, now: NOW }, { db, send, renew });
    expect(outcome).toBe("still-failing");
    expect(state.connection).toMatchObject({ status: "unconfigured" });
    expect(state.job).toMatchObject({ lastStatus: "scheduled", nextRunAt: new Date(NOW.getTime() + 60 * 60_000), metadata: expect.objectContaining({ attempt: 2 }) });
    expect(send).toHaveBeenCalledWith({ name: PROVIDER_RECOVERY_EVENT, data: { providerId: "anthropic-sub", connectionId: CONNECTION, attempt: 2, delayMs: 60 * 60_000 } });
  });

  it("stands down when an administrator changed the account, or the attempt is stale", async () => {
    const operatorOn = fakeDb(account("active"), scheduledJob(0));
    expect(await runProviderAccountRecovery({ providerId: "anthropic-sub", connectionId: CONNECTION, attempt: 0, now: NOW }, { db: operatorOn.db, renew: vi.fn() })).toBe("not-auto-disabled");
    const operatorPaused = fakeDb(account("paused"), scheduledJob(0));
    expect(await runProviderAccountRecovery({ providerId: "anthropic-sub", connectionId: CONNECTION, attempt: 0, now: NOW }, { db: operatorPaused.db, renew: vi.fn() })).toBe("not-auto-disabled");
    expect(operatorPaused.state.connection).toMatchObject({ status: "paused" });
    const stale = fakeDb(account("unconfigured"), scheduledJob(3));
    expect(await runProviderAccountRecovery({ providerId: "anthropic-sub", connectionId: CONNECTION, attempt: 0, now: NOW }, { db: stale.db, renew: vi.fn() })).toBe("not-auto-disabled");
    expect(stale.state.connection).toMatchObject({ status: "unconfigured" });
  });
});

describe("adoptStrandedProviderAccounts", () => {
  it("schedules recovery for a stranded default account with a working credential", async () => {
    const stranded = [{ connectionId: CONNECTION, providerId: "anthropic-sub" }];
    const { db, state, raw } = fakeDb(null, null, stranded);
    const send = vi.fn();
    expect(await adoptStrandedProviderAccounts({ db, send, now: NOW })).toEqual({ adopted: [CONNECTION] });
    expect(raw.aiProviderConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      status: "unconfigured", connectionId: { startsWith: "provider-default-" },
      provider: { status: "active" }, credentialEntry: { is: { status: "ok" } },
    } }));
    expect(state.job).toMatchObject({ lastStatus: "scheduled", metadata: { cause: "unrecorded", source: "boot-adoption", attempt: 0, connectionId: CONNECTION } });
    expect(send).toHaveBeenCalledWith({ name: PROVIDER_RECOVERY_EVENT, data: { providerId: "anthropic-sub", connectionId: CONNECTION, attempt: 0, delayMs: 15 * 60_000 } });
  });

  it("does not schedule a second recovery while one is pending", async () => {
    const { db } = fakeDb(null, scheduledJob(0), [{ connectionId: CONNECTION, providerId: "anthropic-sub" }]);
    const send = vi.fn();
    expect(await adoptStrandedProviderAccounts({ db, send, now: NOW })).toEqual({ adopted: [] });
    expect(send).not.toHaveBeenCalled();
  });
});
