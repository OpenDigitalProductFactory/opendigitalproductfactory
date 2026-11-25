import { describe, expect, it, vi } from "vitest";
import { capabilityBackupReceipt, runCapabilityOwnedBackupSteps, runPairedUploadsBackupStep, runScheduledCoreAndCapabilityBackups, selectCapabilityBackupServices, selectScheduledPairedTrial } from "./postgres-daily-backup";

describe("capability-owned backup selection", () => {
  it("keeps postgres scheduled and selects enabled targets from the projection", () => {
    expect(selectCapabilityBackupServices({ backupServices: ["browser-use", "postgres"] })).toEqual(["postgres", "browser-use"]);
  });

  it("returns optional_inactive for a disabled target", () => {
    expect(capabilityBackupReceipt("browser-use", { backupServices: ["postgres"] })).toEqual({
      target: "browser-use",
      status: "optional_inactive",
      selection: "not_selected",
    });
  });

  it("dispatches enabled capability targets and receipts disabled targets in the production planner", async () => {
    const run = vi.fn(async (_name: string, operation: () => unknown) => operation());
    const browserRunner = vi.fn(async () => ({ ok: true }));
    const receipts = await runCapabilityOwnedBackupSteps({ run }, {
      backupServices: ["postgres", "browser-use"],
      capabilityBackupCandidates: ["browser-use", "dpf-tts"], capabilityBackupPolicies: { "browser-use": "separate-required", "dpf-tts": "separate-required" },
    } as never, { "browser-use": browserRunner });
    expect(browserRunner).toHaveBeenCalledOnce();
    expect(receipts).toEqual([
      { target: "browser-use", status: "selected", selection: "selected", coverage: "dedicated-runner", result: { ok: true } },
      { target: "dpf-tts", status: "optional_inactive", selection: "not_selected" },
    ]);
  });

  it("receipts every enabled production target as selected when no concrete runner exists", async () => {
    const receipts = await runCapabilityOwnedBackupSteps({ run: vi.fn() }, {
      backupServices: ["postgres", "adp", "browser-use"], capabilityBackupCandidates: ["adp", "browser-use"], capabilityBackupPolicies: { adp: "included", "browser-use": "separate-required" },
    } as never);
    expect(receipts).toEqual([
      { target: "adp", status: "selected", selection: "selected", coverage: "core-included" },
      { target: "browser-use", status: "optional_degraded", selection: "selected" },
    ]);
  });

  it("retains successful core backup when operational planning rejects", async () => {
    const core = vi.fn(async () => ({ ok: true }));
    const result = await runScheduledCoreAndCapabilityBackups({ step: { run: async (_name, operation) => operation() }, runPostgres: core, loadOperationalState: async () => { throw new Error("state unavailable"); } });
    expect(core).toHaveBeenCalledOnce();
    expect(result.pgResult).toEqual({ ok: true });
    expect(result.capabilityReceipts[0]).toMatchObject({ status: "optional_degraded", result: { error: "state unavailable" } });
  });
});

describe("paired upload-store backup (BI-1C6BF6B6)", () => {
  const step = { run: async (_name: string, operation: () => unknown) => operation() };

  it("runs the uploads backup paired with a successful Postgres run", async () => {
    const uploads = vi.fn(async (paired: string) => ({ status: "ok", paired }));
    const result = await runScheduledCoreAndCapabilityBackups({
      step,
      runPostgres: async () => ({ runId: "pg-run-1", status: "ok" }),
      runUploads: uploads,
      loadOperationalState: async () => { throw new Error("state unavailable"); },
    });
    expect(uploads).toHaveBeenCalledWith("pg-run-1");
    expect(result.uploadsResult).toEqual({ status: "ok", paired: "pg-run-1" });
  });

  it("skips the uploads backup when the Postgres run failed", async () => {
    const uploads = vi.fn();
    const result = await runPairedUploadsBackupStep(step, "s", { runId: "pg-run-2", status: "failed" }, uploads);
    expect(uploads).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "skipped", reason: "the paired Postgres backup did not finish ok" });
  });

  it("passes only the current scheduled results to the paired trial", () => {
    const pg = { status: "ok", runId: "pg-current" };
    expect(selectScheduledPairedTrial(pg, { status: "ok", runId: "uploads-current" })).toEqual({
      sourceBackupRunId: "pg-current", uploadsBackupRunId: "uploads-current",
    });
    expect(selectScheduledPairedTrial(pg, { status: "failed", runId: "uploads-failed" })).toEqual({
      sourceBackupRunId: "pg-current", uploadsBackupRunId: null,
    });
    expect(selectScheduledPairedTrial({ status: "failed", runId: "pg-failed" }, { status: "ok", runId: "unrelated" })).toEqual({
      sourceBackupRunId: "pg-failed", uploadsBackupRunId: null,
    });
  });
});
