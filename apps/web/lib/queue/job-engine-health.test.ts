import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertMock = vi.fn();
const findUniqueMock = vi.fn();
const executeScheduledInngestRetentionSweepMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: {
      upsert: (...a: unknown[]) => upsertMock(...a),
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
    },
  },
}));

vi.mock("@/lib/operate/inngest-retention/run", () => ({
  executeScheduledInngestRetentionSweep: (...a: unknown[]) =>
    executeScheduledInngestRetentionSweepMock(...a),
}));

import {
  INNGEST_REGISTRATION_CONFIG_KEY,
  INNGEST_WATCHDOG_CONFIG_KEY,
  classifyInngestWatchdogHealth,
  classifyJobEngineHealth,
  getJobEngineHealth,
  recordInngestGatewayHit,
  recordInngestRegistration,
  runInngestExecutorWatchdog,
} from "./job-engine-health";

beforeEach(() => {
  upsertMock.mockReset().mockResolvedValue({});
  findUniqueMock.mockReset();
  executeScheduledInngestRetentionSweepMock.mockReset().mockResolvedValue({
    skipped: false,
    orphansReaped: 2,
    historyTrimmed: 3,
    errorCount: 0,
  });
});

describe("classifyJobEngineHealth", () => {
  it("is unknown when there is no record yet (don't alarm a fresh install)", () => {
    expect(classifyJobEngineHealth(null)).toMatchObject({ status: "unknown" });
  });
  it("is healthy when the last registration succeeded", () => {
    expect(
      classifyJobEngineHealth(
        { ok: true, at: "2026-06-15T00:00:00.000Z", error: null },
        null,
        new Date("2026-06-15T00:01:00.000Z"),
      ),
    ).toMatchObject({ status: "healthy", checkedAt: "2026-06-15T00:00:00.000Z" });
  });
  it("is degraded with the error when the last registration failed", () => {
    expect(
      classifyJobEngineHealth({ ok: false, at: "2026-06-15T00:00:00.000Z", error: "HTTP 500" }),
    ).toMatchObject({ status: "degraded", detail: "HTTP 500" });
  });
  it("is degraded when registration is healthy but executor POSTs are stale", () => {
    expect(
      classifyJobEngineHealth(
        { ok: true, at: "2026-06-15T00:00:00.000Z", error: null },
        {
          lastGatewayHitAt: "2026-06-15T00:20:00.000Z",
          lastInvocationAt: "2026-06-15T00:00:00.000Z",
          lastRegistrationRefreshAt: "2026-06-15T00:20:00.000Z",
          lastProbeAt: null,
          lastRecoveryAttemptAt: null,
          lastRecoverySummary: null,
          lastRecoveryError: null,
        },
        new Date("2026-06-15T00:20:00.000Z"),
      ),
    ).toMatchObject({
      status: "degraded",
      watchdog: { status: "degraded" },
    });
  });
});

describe("classifyInngestWatchdogHealth", () => {
  it("does not alarm before a healthy registration baseline exists", () => {
    expect(
      classifyInngestWatchdogHealth({
        registration: null,
        watchdog: null,
        now: new Date("2026-06-15T00:20:00.000Z"),
      }),
    ).toMatchObject({ status: "unknown" });
  });
});

describe("recordInngestRegistration", () => {
  it("persists ok=true with no error on success", async () => {
    await recordInngestRegistration(true, null, new Date("2026-06-15T00:00:00.000Z"));
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: INNGEST_REGISTRATION_CONFIG_KEY },
        update: expect.objectContaining({
          value: { ok: true, at: "2026-06-15T00:00:00.000Z", error: null },
        }),
      }),
    );
  });
  it("persists ok=false with the error on failure", async () => {
    await recordInngestRegistration(false, "HTTP 500", new Date("2026-06-15T00:00:00.000Z"));
    expect(upsertMock.mock.calls[0][0].update.value).toEqual({
      ok: false,
      at: "2026-06-15T00:00:00.000Z",
      error: "HTTP 500",
    });
  });
  it("never throws when the DB write fails (boot-path safety)", async () => {
    upsertMock.mockRejectedValueOnce(new Error("db down"));
    await expect(recordInngestRegistration(true)).resolves.toBeUndefined();
  });
});

describe("recordInngestGatewayHit", () => {
  it("records POST as the last executor invocation", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    await recordInngestGatewayHit("POST", new Date("2026-06-15T00:01:00.000Z"));
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: INNGEST_WATCHDOG_CONFIG_KEY },
        update: expect.objectContaining({
          value: expect.objectContaining({
            lastGatewayHitAt: "2026-06-15T00:01:00.000Z",
            lastInvocationAt: "2026-06-15T00:01:00.000Z",
          }),
        }),
      }),
    );
  });
});

describe("getJobEngineHealth", () => {
  it("reads and classifies the persisted state", async () => {
    findUniqueMock.mockResolvedValueOnce({
      value: { ok: false, at: "2026-06-15T00:00:00.000Z", error: "HTTP 500" },
    });
    expect(await getJobEngineHealth()).toMatchObject({
      status: "degraded",
      detail: "HTTP 500",
    });
  });
  it("returns unknown when absent or on read error", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    expect(await getJobEngineHealth()).toMatchObject({ status: "unknown" });
    findUniqueMock.mockRejectedValueOnce(new Error("db down"));
    expect(await getJobEngineHealth()).toMatchObject({ status: "unknown" });
  });
});

describe("runInngestExecutorWatchdog", () => {
  it("runs the non-destructive retention sweep when executor traffic is stale", async () => {
    findUniqueMock
      .mockResolvedValueOnce({
        value: { ok: true, at: "2026-06-15T00:00:00.000Z", error: null },
      })
      .mockResolvedValueOnce({
        value: {
          lastGatewayHitAt: "2026-06-15T00:00:00.000Z",
          lastInvocationAt: "2026-06-15T00:00:00.000Z",
          lastRegistrationRefreshAt: "2026-06-15T00:00:00.000Z",
          lastProbeAt: null,
          lastRecoveryAttemptAt: null,
          lastRecoverySummary: null,
          lastRecoveryError: null,
        },
      });

    const result = await runInngestExecutorWatchdog({
      now: new Date("2026-06-15T00:20:00.000Z"),
      starvationThresholdMs: 15 * 60 * 1000,
    });

    expect(result.status).toBe("degraded");
    expect(executeScheduledInngestRetentionSweepMock).toHaveBeenCalledWith({
      dryRun: false,
      now: new Date("2026-06-15T00:20:00.000Z"),
    });
    expect(upsertMock.mock.calls.at(-1)?.[0].update.value).toMatchObject({
      lastRecoveryAttemptAt: "2026-06-15T00:20:00.000Z",
      lastRecoverySummary: "retention sweep ran, orphansReaped=2, historyTrimmed=3, errors=0",
    });
  });

  it("honors the recovery cooldown", async () => {
    findUniqueMock
      .mockResolvedValueOnce({
        value: { ok: true, at: "2026-06-15T00:00:00.000Z", error: null },
      })
      .mockResolvedValueOnce({
        value: {
          lastGatewayHitAt: "2026-06-15T00:00:00.000Z",
          lastInvocationAt: "2026-06-15T00:00:00.000Z",
          lastRegistrationRefreshAt: "2026-06-15T00:00:00.000Z",
          lastProbeAt: null,
          lastRecoveryAttemptAt: "2026-06-15T00:10:00.000Z",
          lastRecoverySummary: "recent",
          lastRecoveryError: null,
        },
      });

    const result = await runInngestExecutorWatchdog({
      now: new Date("2026-06-15T00:20:00.000Z"),
      starvationThresholdMs: 15 * 60 * 1000,
      recoveryCooldownMs: 30 * 60 * 1000,
    });

    expect(result.status).toBe("degraded");
    expect(executeScheduledInngestRetentionSweepMock).not.toHaveBeenCalled();
    expect(upsertMock.mock.calls.at(-1)?.[0].update.value).toMatchObject({
      lastProbeAt: "2026-06-15T00:20:00.000Z",
      lastRecoveryAttemptAt: "2026-06-15T00:10:00.000Z",
    });
  });
});
