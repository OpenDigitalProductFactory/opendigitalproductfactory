// apps/web/lib/queue/functions/token-expiry-monitor.test.ts
// Phase 6 — Token Expiry Monitor (Inngest scheduled fn).
//
// Covers:
//   - 40 days to expiry → no new notification + any prior token-expiry
//     notification gets resolvedAt set
//   - 30 / 14 / 7 / 0 days → correct severity tier and message text
//   - Re-running on the same day at the same severity → idempotent (no
//     duplicate notification rows created)
//   - Severity escalation (existing `warning` notification, current state is
//     `critical` → old resolved + new `critical` row created)

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  credentialFindMany: vi.fn(),
  notificationFindFirst: vi.fn(),
  notificationCreate: vi.fn(),
  notificationUpdateMany: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    credentialEntry: { findMany: mocks.credentialFindMany },
    platformNotification: {
      findFirst: mocks.notificationFindFirst,
      create: mocks.notificationCreate,
      updateMany: mocks.notificationUpdateMany,
    },
  },
}));

import { runTokenExpiryScan } from "./token-expiry-monitor";

const FIXED_NOW = new Date("2026-04-24T12:00:00.000Z");

function daysFromNow(days: number): Date {
  return new Date(FIXED_NOW.getTime() + days * 86400000);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  mocks.credentialFindMany.mockResolvedValue([]);
  mocks.notificationFindFirst.mockResolvedValue(null);
  mocks.notificationCreate.mockResolvedValue({});
  mocks.notificationUpdateMany.mockResolvedValue({ count: 0 });
});

describe("runTokenExpiryScan", () => {
  it("does not write a notification when token is 40 days from expiry, and resolves any prior token-expiry notification for that subject", async () => {
    mocks.credentialFindMany.mockResolvedValue([
      {
        providerId: "github-contribution",
        tokenExpiresAt: daysFromNow(40),
        status: "active",
      },
    ]);
    // Pretend an old notification existed
    mocks.notificationUpdateMany.mockResolvedValue({ count: 1 });

    await runTokenExpiryScan();

    expect(mocks.notificationCreate).not.toHaveBeenCalled();
    expect(mocks.notificationUpdateMany).toHaveBeenCalledWith({
      where: {
        category: "token-expiry",
        subjectId: "github-contribution",
        resolvedAt: null,
      },
      data: { resolvedAt: FIXED_NOW },
    });
  });

  it("emits an info notification at exactly 30 days", async () => {
    mocks.credentialFindMany.mockResolvedValue([
      {
        providerId: "github-contribution",
        tokenExpiresAt: daysFromNow(30),
        status: "active",
      },
    ]);

    await runTokenExpiryScan();

    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1);
    const arg = mocks.notificationCreate.mock.calls[0][0];
    expect(arg.data.severity).toBe("info");
    expect(arg.data.category).toBe("token-expiry");
    expect(arg.data.subjectId).toBe("github-contribution");
    expect(arg.data.message).toBe(
      "Your GitHub token expires in 30 days. Reconnect ahead of expiry.",
    );
  });

  it("emits a warning notification at 14 days", async () => {
    mocks.credentialFindMany.mockResolvedValue([
      {
        providerId: "github-contribution",
        tokenExpiresAt: daysFromNow(14),
        status: "active",
      },
    ]);

    await runTokenExpiryScan();

    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1);
    const arg = mocks.notificationCreate.mock.calls[0][0];
    expect(arg.data.severity).toBe("warning");
    expect(arg.data.message).toBe(
      "Your GitHub token expires in 14 days. Reconnect soon.",
    );
  });

  it("emits a critical notification at 7 days", async () => {
    mocks.credentialFindMany.mockResolvedValue([
      {
        providerId: "github-contribution",
        tokenExpiresAt: daysFromNow(7),
        status: "active",
      },
    ]);

    await runTokenExpiryScan();

    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1);
    const arg = mocks.notificationCreate.mock.calls[0][0];
    expect(arg.data.severity).toBe("critical");
    expect(arg.data.message).toBe(
      "Your GitHub token expires in 7 days. Reconnect now to avoid disruption.",
    );
  });

  it("emits an expired notification when the token has already expired (0 or negative days)", async () => {
    mocks.credentialFindMany.mockResolvedValue([
      {
        providerId: "github-contribution",
        tokenExpiresAt: daysFromNow(0),
        status: "active",
      },
    ]);

    await runTokenExpiryScan();

    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1);
    const arg = mocks.notificationCreate.mock.calls[0][0];
    expect(arg.data.severity).toBe("expired");
    expect(arg.data.message).toBe(
      "Your GitHub token has expired. Reconnect to resume contributing.",
    );
  });

  it("is idempotent: re-running on the same day at the same severity does not create a second notification", async () => {
    mocks.credentialFindMany.mockResolvedValue([
      {
        providerId: "github-contribution",
        tokenExpiresAt: daysFromNow(7),
        status: "active",
      },
    ]);
    // Simulate an existing critical notification at the same severity
    mocks.notificationFindFirst.mockResolvedValue({
      id: "n-existing",
      severity: "critical",
      category: "token-expiry",
      subjectId: "github-contribution",
      message: "stale",
      resolvedAt: null,
      createdAt: FIXED_NOW,
    });

    await runTokenExpiryScan();

    expect(mocks.notificationCreate).not.toHaveBeenCalled();
    // No resolve either — same severity, no-op.
    expect(mocks.notificationUpdateMany).not.toHaveBeenCalled();
  });

  it("escalates severity: existing warning at 14 days, re-running at 7 days resolves the warning and creates a critical row", async () => {
    mocks.credentialFindMany.mockResolvedValue([
      {
        providerId: "github-contribution",
        tokenExpiresAt: daysFromNow(7),
        status: "active",
      },
    ]);
    // Simulate prior warning notification
    mocks.notificationFindFirst.mockResolvedValue({
      id: "n-warning",
      severity: "warning",
      category: "token-expiry",
      subjectId: "github-contribution",
      message: "old warning",
      resolvedAt: null,
      createdAt: new Date(FIXED_NOW.getTime() - 7 * 86400000),
    });

    await runTokenExpiryScan();

    // Old one resolved
    expect(mocks.notificationUpdateMany).toHaveBeenCalledWith({
      where: {
        category: "token-expiry",
        subjectId: "github-contribution",
        resolvedAt: null,
      },
      data: { resolvedAt: FIXED_NOW },
    });
    // New critical row created
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1);
    const arg = mocks.notificationCreate.mock.calls[0][0];
    expect(arg.data.severity).toBe("critical");
  });

  it("only queries CredentialEntry rows with non-null tokenExpiresAt and active status", async () => {
    await runTokenExpiryScan();
    expect(mocks.credentialFindMany).toHaveBeenCalledWith({
      where: {
        tokenExpiresAt: { not: null },
        status: "active",
      },
      select: {
        providerId: true,
        tokenExpiresAt: true,
        status: true,
      },
    });
  });
});
