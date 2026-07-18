import { describe, expect, it } from "vitest";
import { capabilityBackupReceipt, selectCapabilityBackupServices } from "./postgres-daily-backup";

describe("capability-owned backup selection", () => {
  it("keeps postgres scheduled and selects enabled targets from the projection", () => {
    expect(selectCapabilityBackupServices({ backupServices: ["browser-use", "postgres"] })).toEqual(["postgres", "browser-use"]);
  });

  it("returns optional_inactive for a disabled target", () => {
    expect(capabilityBackupReceipt("browser-use", { backupServices: ["postgres"] })).toEqual({
      target: "browser-use",
      status: "optional_inactive",
    });
  });
});
