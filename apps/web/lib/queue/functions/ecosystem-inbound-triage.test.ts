import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(), gate: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(),
}));
vi.mock("@/lib/jobs", () => ({ jobs: { createFunction: (_config: unknown, handler: unknown) => handler } }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: mocks.gate }));
vi.mock("@/lib/ecosystem/inbound-triage-runner", () => ({ runEcosystemInboundTriage: mocks.run }));
vi.mock("@dpf/db", () => ({ prisma: { scheduledJob: { findUnique: mocks.findUnique, upsert: mocks.upsert } } }));

import { ecosystemInboundTriage } from "./ecosystem-inbound-triage";
import { deriveHealth } from "@/lib/operate/scheduled-jobs/work-model";

const invoke = () => (ecosystemInboundTriage as unknown as (context: unknown) => Promise<unknown>)({
  step: { run: (_name: string, fn: () => Promise<unknown>) => fn() },
});

describe("ecosystem intake job reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.gate.mockResolvedValue({ proceed: true });
    mocks.findUnique.mockResolvedValue({ schedule: "17 6 * * 1" });
    mocks.upsert.mockResolvedValue({});
  });

  it("persists incomplete coverage for the existing schedule view without replaying ingestion", async () => {
    const result = { ran: true, complete: false, ingested: 1, deduped: 0, failed: 0,
      itemIds: ["BI-PEER"], sourceErrors: [{ source: "upstream-issue", error: "GitHub unavailable" }] };
    mocks.run.mockResolvedValue(result);
    await expect(invoke()).resolves.toEqual(result);
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { jobId: "ecosystem-inbound-issue-triage" },
      update: expect.objectContaining({ lastStatus: "failed", lastError: expect.stringContaining("GitHub unavailable"),
        lastRunSummary: expect.stringContaining("1 new"), nextRunAt: expect.any(Date) }),
    }));
    const heartbeat = mocks.upsert.mock.calls[0][0].update;
    expect(deriveHealth({ kind: "recurring", enabled: true, schedule: "17 6 * * 1",
      reportsRunData: true, ...heartbeat }, new Date()).health).toBe("error");
  });

  it("clears an old error after a complete scan", async () => {
    mocks.run.mockResolvedValue({ ran: true, complete: true, ingested: 0, deduped: 3, failed: 0, itemIds: [], sourceErrors: [] });
    await invoke();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ lastStatus: "completed", lastError: null }),
    }));
  });

  it("retries heartbeat persistence using the durable scan result", async () => {
    mocks.run.mockResolvedValue({ ran: true, complete: true, ingested: 1, deduped: 0, failed: 0, itemIds: ["BI-NEW"], sourceErrors: [] });
    mocks.upsert.mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue({});
    const completed = new Map<string, unknown>();
    const context = { step: { run: async (name: string, fn: () => Promise<unknown>) => {
      if (completed.has(name)) return completed.get(name);
      const value = await fn();
      completed.set(name, value);
      return value;
    } } };
    const handler = ecosystemInboundTriage as unknown as (context: unknown) => Promise<unknown>;
    await expect(handler(context)).rejects.toThrow("database unavailable");
    await expect(handler(context)).resolves.toMatchObject({ ingested: 1 });
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
  });

  it("does not report a skipped installation as a successful scan", async () => {
    mocks.run.mockResolvedValue({ ran: false, reason: "installation purpose is undeclared" });
    await invoke();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ lastStatus: "not-configured", lastRunSummary: "installation purpose is undeclared" }),
    }));
    const heartbeat = mocks.upsert.mock.calls[0][0].update;
    expect(deriveHealth({ kind: "recurring", enabled: true, schedule: "17 6 * * 1",
      reportsRunData: true, ...heartbeat }, new Date()).health).toBe("untracked");
  });

  it("honors the entry gate without ingestion or heartbeat writes", async () => {
    mocks.gate.mockResolvedValue({ proceed: false, reason: "disabled" });
    await expect(invoke()).resolves.toEqual({ skipped: true, reason: "disabled" });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
