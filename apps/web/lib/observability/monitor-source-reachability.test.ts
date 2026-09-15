import { describe, expect, it, vi } from "vitest";
import {
  monitorSourceIssueKey,
  recordMonitorSourceReachability,
} from "./monitor-source-reachability";
import type { MonitorIssueDb } from "./monitor-issue-writer";

function db() {
  const upsert = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  return {
    handle: { portfolioQualityIssue: { upsert, updateMany } } as unknown as MonitorIssueDb,
    upsert,
    updateMany,
  };
}

const NOW = () => new Date("2026-09-15T21:00:00.000Z");

describe("recordMonitorSourceReachability", () => {
  it("opens a monitor_source_unreachable row when the source is dark", async () => {
    const { handle, upsert } = db();

    await recordMonitorSourceReachability(handle, {
      monitorId: "ops/log-signature-scanner",
      sourceId: "loki",
      reached: false,
      blindTo: "novel container error signatures are not being detected",
      error: new TypeError("fetch failed"),
      now: NOW,
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0];
    expect(args.where.issueKey).toBe(
      "monitor-source-unreachable:ops/log-signature-scanner:loki",
    );
    expect(args.create.issueType).toBe("monitor_source_unreachable");
    expect(args.create.status).toBe("open");
    expect(args.create.severity).toBe("warn");
    // The operator must be able to read WHAT they are blind to from the row.
    expect(args.create.summary).toContain("novel container error signatures");
    expect((args.create.details as { error?: string }).error).toContain("fetch failed");
  });

  it("resolves the row when the source answers again", async () => {
    const { handle, updateMany, upsert } = db();

    await recordMonitorSourceReachability(handle, {
      monitorId: "ops/log-signature-scanner",
      sourceId: "loki",
      reached: true,
      blindTo: "",
      now: NOW,
    });

    expect(upsert).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      issueKey: monitorSourceIssueKey("ops/log-signature-scanner", "loki"),
      status: "open",
    });
    expect(args.data.status).toBe("resolved");
  });

  it("honours an explicit severity for a security-relevant source", async () => {
    const { handle, upsert } = db();

    await recordMonitorSourceReachability(handle, {
      monitorId: "ops/patch-assessment-sweep",
      sourceId: "cisa-kev",
      reached: false,
      severity: "error",
      blindTo: "cannot tell which CVEs are actively exploited",
      now: NOW,
    });

    expect(upsert.mock.calls[0][0].create.severity).toBe("error");
  });

  it("never throws when the bookkeeping write fails — the monitor's real work must survive", async () => {
    const handle = {
      portfolioQualityIssue: {
        upsert: vi.fn().mockRejectedValue(new Error("db down")),
        updateMany: vi.fn(),
      },
    } as unknown as MonitorIssueDb;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordMonitorSourceReachability(handle, {
        monitorId: "ops/alert-delivery-bridge",
        sourceId: "loki-ruler",
        reached: false,
        blindTo: "log-rate alerts are not being evaluated",
        now: NOW,
      }),
    ).resolves.toBeUndefined();

    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
