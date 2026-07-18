import { describe, expect, it, vi } from "vitest";
import { capabilityBackupReceipt, runCapabilityOwnedBackupSteps, selectCapabilityBackupServices } from "./postgres-daily-backup";

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
});
