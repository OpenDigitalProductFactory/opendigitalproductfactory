import { describe, expect, it, vi } from "vitest";

import {
  CONTINUITY_HEARTBEAT_KEY,
  DOWNTIME_GAP_MS,
  DOWNTIME_RECORD_HOLD_MS,
  PLATFORM_DOWNTIME_ISSUE_TYPE,
  classifyDowntime,
  describeDowntimeWindow,
  planContinuityCycle,
  runPlatformContinuityWatch,
  type ContinuityDb,
  type DowntimeEvidence,
} from "./platform-continuity-watch";
import type { HostPostureView } from "@/lib/install/host-posture";

const at = (iso: string) => new Date(iso);

// The first window of the 2026-11-08..10 outage (BI-3E2F87FA).
const WINDOW = { startedAt: at("2026-11-08T14:48:00.000Z"), endedAt: at("2026-11-09T02:02:00.000Z") };

const NO_EVIDENCE: DowntimeEvidence = {
  postgresStartedAt: at("2026-11-01T00:00:00.000Z"),
  runtimeBootedAt: at("2026-11-01T00:00:00.000Z"),
  upgradeWindows: [],
  workDuringGap: 0,
  hostPosture: null,
};

const BATTERY_POSTURE: HostPostureView = {
  observedAt: "2026-11-09T01:46:30.000Z",
  platform: "macos",
  attentionCount: 1,
  checks: [
    { id: "ac-power", label: "Plugged in to power", state: "attention", detail: "On battery.", fix: "Keep this Mac plugged in to its power adapter." },
  ],
};

describe("planContinuityCycle", () => {
  it("finds no gap on the first beat or when the last beat is recent", () => {
    expect(planContinuityCycle({ previous: null, now: WINDOW.endedAt }).window).toBeNull();
    const recent = new Date(WINDOW.endedAt.getTime() - DOWNTIME_GAP_MS + 1);
    expect(planContinuityCycle({ previous: { schemaVersion: 1, beatAt: recent.toISOString() }, now: WINDOW.endedAt }).window).toBeNull();
  });

  it("names the window from the last beat to this one when the gap is long", () => {
    const plan = planContinuityCycle({ previous: { schemaVersion: 1, beatAt: WINDOW.startedAt.toISOString() }, now: WINDOW.endedAt });
    expect(plan.window).toEqual(WINDOW);
  });

  it("ignores a heartbeat it cannot read", () => {
    expect(planContinuityCycle({ previous: { schemaVersion: 1, beatAt: "garbage" }, now: WINDOW.endedAt }).window).toBeNull();
  });
});

describe("classifyDowntime", () => {
  it("calls a window covered by a self-upgrade a planned upgrade", () => {
    const result = classifyDowntime(
      { startedAt: at("2026-11-13T16:05:00.000Z"), endedAt: at("2026-11-13T16:40:00.000Z") },
      { ...NO_EVIDENCE, upgradeWindows: [{ startedAt: at("2026-11-13T16:12:51.000Z"), completedAt: at("2026-11-13T16:22:31.000Z") }] },
    );
    expect(result.cause).toBe("planned-upgrade");
  });

  it("does not excuse a long outage because an upgrade happened inside it", () => {
    const result = classifyDowntime(WINDOW, {
      ...NO_EVIDENCE,
      upgradeWindows: [{ startedAt: at("2026-11-08T20:00:00.000Z"), completedAt: at("2026-11-08T20:15:00.000Z") }],
    });
    expect(result.cause).not.toBe("planned-upgrade");
  });

  it("reads a Docker VM that booted inside the window as a restart of Docker or the computer", () => {
    const result = classifyDowntime(WINDOW, { ...NO_EVIDENCE, runtimeBootedAt: at("2026-11-09T01:58:00.000Z"), postgresStartedAt: at("2026-11-09T01:59:00.000Z") });
    expect(result.cause).toBe("docker-or-host-restart");
    expect(result.explanation).toMatch(/restarted/);
    expect(result.explanation).toMatch(/signs in/);
  });

  it("reads containers that restarted while Docker kept running as a container restart", () => {
    const result = classifyDowntime(WINDOW, { ...NO_EVIDENCE, postgresStartedAt: at("2026-11-09T01:59:00.000Z") });
    expect(result.cause).toBe("containers-restarted");
  });

  it("reads work recorded inside the window as stalled scheduled checks, not an outage of everything", () => {
    const result = classifyDowntime(WINDOW, { ...NO_EVIDENCE, workDuringGap: 12 });
    expect(result.cause).toBe("scheduler-stalled");
  });

  it("reads a window where nothing restarted as the computer most likely asleep, with the posture advice", () => {
    const result = classifyDowntime(WINDOW, { ...NO_EVIDENCE, hostPosture: BATTERY_POSTURE });
    expect(result.cause).toBe("host-asleep");
    expect(result.explanation).toMatch(/asleep/);
    expect(result.advice).toEqual(["Keep this Mac plugged in to its power adapter."]);
  });
});

describe("describeDowntimeWindow", () => {
  it("states the length and the window in UTC, through the shared formatters", () => {
    const text = describeDowntimeWindow(WINDOW);
    expect(text).toMatch(/^The platform was down for 11h 14m \(/);
    expect(text).toMatch(/2:48/);
    expect(text).toMatch(/2:02/);
    expect(text).toMatch(/UTC/);
  });
});

function fakeDb(heartbeat: unknown) {
  const upserts: Array<Record<string, unknown>> = [];
  const config = new Map<string, unknown>(heartbeat === undefined ? [] : [[CONTINUITY_HEARTBEAT_KEY, heartbeat]]);
  const db: ContinuityDb = {
    platformConfig: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (config.has(where.key) ? { value: config.get(where.key) } : null)),
      upsert: vi.fn(async (args: { where: { key: string }; create: { value: unknown } }) => {
        config.set(args.where.key, args.create.value);
        return {};
      }),
    },
    portfolioQualityIssue: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        upserts.push(args);
        return {};
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return { db, upserts, config };
}

describe("runPlatformContinuityWatch", () => {
  it("records the gap as one Needs-you row, tells the operator, and beats", async () => {
    const { db, upserts, config } = fakeDb({ schemaVersion: 1, beatAt: WINDOW.startedAt.toISOString() });
    const notify = vi.fn(async () => {});
    const result = await runPlatformContinuityWatch(db, {
      now: () => WINDOW.endedAt,
      readEvidence: async () => ({ ...NO_EVIDENCE, runtimeBootedAt: at("2026-11-09T01:58:00.000Z") }),
      notify,
    });
    expect(result.recorded).toBe("platform-downtime:2026-11-08T14:48:00.000Z");
    expect(upserts).toHaveLength(1);
    const create = (upserts[0] as { create: Record<string, unknown> }).create;
    expect(create.issueType).toBe(PLATFORM_DOWNTIME_ISSUE_TYPE);
    expect(create.summary).toBe(describeDowntimeWindow(WINDOW));
    expect(create.details).toMatchObject({
      startedAt: WINDOW.startedAt.toISOString(),
      endedAt: WINDOW.endedAt.toISOString(),
      cause: "docker-or-host-restart",
      href: "/ops/installation#host-posture",
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(config.get(CONTINUITY_HEARTBEAT_KEY)).toEqual({ schemaVersion: 1, beatAt: WINDOW.endedAt.toISOString() });
  });

  it("records nothing for a planned upgrade, but still beats", async () => {
    const { db, upserts, config } = fakeDb({ schemaVersion: 1, beatAt: "2026-11-13T16:05:00.000Z" });
    const result = await runPlatformContinuityWatch(db, {
      now: () => at("2026-11-13T16:40:00.000Z"),
      readEvidence: async () => ({ ...NO_EVIDENCE, upgradeWindows: [{ startedAt: at("2026-11-13T16:12:51.000Z"), completedAt: at("2026-11-13T16:22:31.000Z") }] }),
    });
    expect(result.recorded).toBeNull();
    expect(result.cause).toBe("planned-upgrade");
    expect(upserts).toHaveLength(0);
    expect(config.get(CONTINUITY_HEARTBEAT_KEY)).toEqual({ schemaVersion: 1, beatAt: "2026-11-13T16:40:00.000Z" });
  });

  it("only beats on a normal cycle, and closes downtime records older than the hold", async () => {
    const now = at("2026-11-13T17:00:00.000Z");
    const { db, upserts } = fakeDb({ schemaVersion: 1, beatAt: "2026-11-13T16:55:00.000Z" });
    const readEvidence = vi.fn();
    const result = await runPlatformContinuityWatch(db, { now: () => now, readEvidence });
    expect(result.recorded).toBeNull();
    expect(readEvidence).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
    expect(db.portfolioQualityIssue.updateMany).toHaveBeenCalledWith({
      where: { issueType: PLATFORM_DOWNTIME_ISSUE_TYPE, status: "open", firstDetectedAt: { lt: new Date(now.getTime() - DOWNTIME_RECORD_HOLD_MS) } },
      data: { status: "resolved", resolvedAt: now, lastDetectedAt: now },
    });
  });
});
