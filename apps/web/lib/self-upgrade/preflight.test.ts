import { describe, expect, it } from "vitest";
import { resolveReadinessBackupHostPath } from "./preflight";

describe("resolveReadinessBackupHostPath (BI-E2625B79)", () => {
  it("uses an explicit DPF_BACKUPS_HOST_PATH when set", () => {
    expect(resolveReadinessBackupHostPath("/vol/backups", "/opt/dpf")).toBe("/vol/backups");
  });

  it("falls back to <install>/backups when the env var is EMPTY (the documented compose default)", () => {
    // .env ships DPF_BACKUPS_HOST_PATH= empty by design; a plain `?? undefined`
    // leaks "" through and skips the /backups mount -> recovery_parent_unavailable.
    expect(resolveReadinessBackupHostPath("", "/opt/dpf")).toBe("/opt/dpf/backups");
  });

  it("falls back to <install>/backups when the env var is unset", () => {
    expect(resolveReadinessBackupHostPath(undefined, "/opt/dpf")).toBe("/opt/dpf/backups");
  });

  it("treats whitespace-only as unset and strips a trailing slash from the install path", () => {
    expect(resolveReadinessBackupHostPath("   ", "/opt/dpf/")).toBe("/opt/dpf/backups");
  });
});
