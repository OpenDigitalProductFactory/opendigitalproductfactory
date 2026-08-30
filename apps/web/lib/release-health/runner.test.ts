import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  platformConfig: { findUnique: vi.fn(), upsert: vi.fn() },
  platformNotification: { create: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("@dpf/db", () => ({ prisma: db }));

const reader = vi.hoisted(() => ({
  readLatestReleaseStamp: vi.fn(),
}));

vi.mock("./release-runs-reader", () => reader);

import { runReleaseHealthCheck } from "./runner";
import type { ReleaseStampSnapshot } from "./release-runs-reader";

const NOW = new Date("2026-06-10T03:00:00Z");

function snapshot(over: Partial<ReleaseStampSnapshot> = {}): ReleaseStampSnapshot {
  return {
    tag: "v6.1.0",
    headSha: null,
    runId: 100,
    runUrl: "https://github.com/o/r/actions/runs/100",
    status: "verified",
    runConclusion: "success",
    runUpdatedAt: "2026-06-10T02:00:00Z",
    ...over,
  };
}

function priorState(over: Record<string, unknown> = {}) {
  return {
    value: {
      snapshot: snapshot(),
      checkedAt: "2026-06-10T02:45:00Z",
      notifiedRunId: null,
      ...over,
    },
  };
}

describe("runReleaseHealthCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.platformConfig.findUnique.mockResolvedValue(null);
    db.platformConfig.upsert.mockResolvedValue({});
    db.platformNotification.create.mockResolvedValue({});
    db.platformNotification.updateMany.mockResolvedValue({ count: 0 });
  });

  it("notifies critical on a verify-failed stamp and records the run id", async () => {
    reader.readLatestReleaseStamp.mockResolvedValue({
      ok: true,
      latest: snapshot({ status: "verify-failed" }),
    });

    const result = await runReleaseHealthCheck({ now: NOW });

    expect(result.ok && result.notificationCreated).toBe(true);
    expect(db.platformNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        severity: "critical",
        category: "release-verification",
        subjectId: "v6.1.0",
        message: expect.stringContaining("published but its install verification FAILED"),
      }),
    });
    expect(db.platformConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          value: expect.objectContaining({ notifiedRunId: 100 }),
        },
      }),
    );
  });

  it("notifies warning on a publish-failed stamp", async () => {
    reader.readLatestReleaseStamp.mockResolvedValue({
      ok: true,
      latest: snapshot({ status: "publish-failed" }),
    });

    await runReleaseHealthCheck({ now: NOW });

    expect(db.platformNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ severity: "warning" }),
    });
  });

  it("does not re-notify the same red run on subsequent polls", async () => {
    reader.readLatestReleaseStamp.mockResolvedValue({
      ok: true,
      latest: snapshot({ status: "verify-failed" }),
    });
    db.platformConfig.findUnique.mockResolvedValue(
      priorState({
        snapshot: snapshot({ status: "verify-failed" }),
        notifiedRunId: 100,
      }),
    );

    const result = await runReleaseHealthCheck({ now: NOW });

    expect(result.ok && result.notificationCreated).toBe(false);
    expect(db.platformNotification.create).not.toHaveBeenCalled();
  });

  it("notifies again when a NEW red run appears after an already-notified one", async () => {
    reader.readLatestReleaseStamp.mockResolvedValue({
      ok: true,
      latest: snapshot({ status: "verify-failed", runId: 200, tag: "v6.2.0" }),
    });
    db.platformConfig.findUnique.mockResolvedValue(
      priorState({ notifiedRunId: 100 }),
    );

    const result = await runReleaseHealthCheck({ now: NOW });

    expect(result.ok && result.notificationCreated).toBe(true);
    expect(db.platformNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ subjectId: "v6.2.0" }),
    });
  });

  it("resolves open notifications when the latest stamp is verified", async () => {
    reader.readLatestReleaseStamp.mockResolvedValue({
      ok: true,
      latest: snapshot({ status: "verified", runId: 300 }),
    });
    db.platformNotification.updateMany.mockResolvedValue({ count: 2 });

    const result = await runReleaseHealthCheck({ now: NOW });

    expect(result.ok && result.notificationsResolved).toBe(2);
    expect(db.platformNotification.updateMany).toHaveBeenCalledWith({
      where: { category: "release-verification", resolvedAt: null },
      data: { resolvedAt: NOW },
    });
  });

  it("preserves exact-bound verified registry evidence across the next matching health poll", async () => {
    const verifiedTarget = {
      schemaVersion: 1,
      publisherRunId: 300,
      verifiedAt: "2026-06-10T02:50:00Z",
      ghcrOwner: "opendigitalproductfactory",
      channelTag: "latest",
      installMode: "consumer",
      installedImageTag: "v6.0.0",
      currentConfigDigest: `sha256:${"d".repeat(64)}`,
      candidate: {
        tag: "v6.1.0",
        sourceSha: "a".repeat(40),
        channelDigest: `sha256:${"a".repeat(64)}`,
        platformManifestDigest: `sha256:${"b".repeat(64)}`,
        configDigest: `sha256:${"c".repeat(64)}`,
        platformOs: "linux",
        platformArchitecture: "amd64",
      },
    };
    const current = snapshot({ status: "verified", runId: 300, headSha: "a".repeat(40) });
    reader.readLatestReleaseStamp.mockResolvedValue({ ok: true, latest: current });
    db.platformConfig.findUnique.mockResolvedValue(
      priorState({ snapshot: current, verifiedTarget }),
    );

    await runReleaseHealthCheck({ now: NOW });

    expect(db.platformConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: expect.objectContaining({ verifiedTarget }) },
      }),
    );
  });

  it("drops registry evidence when the publisher identity changes", async () => {
    const previous = snapshot({ status: "verified", runId: 299, tag: "v6.0.0", headSha: "9".repeat(40) });
    const current = snapshot({ status: "verified", runId: 300, headSha: "a".repeat(40) });
    reader.readLatestReleaseStamp.mockResolvedValue({ ok: true, latest: current });
    db.platformConfig.findUnique.mockResolvedValue(
      priorState({
        snapshot: previous,
        verifiedTarget: { schemaVersion: 1, publisherRunId: 299 },
      }),
    );

    await runReleaseHealthCheck({ now: NOW });

    expect(db.platformConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: expect.objectContaining({ verifiedTarget: null }) },
      }),
    );
  });

  it("does NOT resolve open notifications while a re-stamp is merely in progress", async () => {
    reader.readLatestReleaseStamp.mockResolvedValue({
      ok: true,
      latest: snapshot({ status: "in-progress", runId: 300 }),
    });
    db.platformConfig.findUnique.mockResolvedValue(
      priorState({ notifiedRunId: 100 }),
    );

    await runReleaseHealthCheck({ now: NOW });

    expect(db.platformNotification.updateMany).not.toHaveBeenCalled();
    // The dedupe marker survives so the old failure can't re-alert either.
    expect(db.platformConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: expect.objectContaining({ notifiedRunId: 100 }) },
      }),
    );
  });

  it("keeps prior state untouched on a read error", async () => {
    reader.readLatestReleaseStamp.mockResolvedValue({
      ok: false,
      error: "HTTP 403 rate limited",
    });

    const result = await runReleaseHealthCheck({ now: NOW });

    expect(result.ok).toBe(false);
    expect(db.platformConfig.upsert).not.toHaveBeenCalled();
    expect(db.platformNotification.create).not.toHaveBeenCalled();
  });

  it("persists a null snapshot for never-stamped installs without alerting", async () => {
    reader.readLatestReleaseStamp.mockResolvedValue({ ok: true, latest: null });

    const result = await runReleaseHealthCheck({ now: NOW });

    expect(result.ok && result.snapshot).toBeNull();
    expect(db.platformNotification.create).not.toHaveBeenCalled();
    expect(db.platformConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          value: expect.objectContaining({ snapshot: null, notifiedRunId: null }),
        },
      }),
    );
  });
});
