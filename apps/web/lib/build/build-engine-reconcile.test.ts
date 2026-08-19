// apps/web/lib/build/build-engine-reconcile.test.ts
import { describe, expect, it } from "vitest";
import { shouldReprovision } from "./build-engine-reconcile";

describe("shouldReprovision", () => {
  it("restores an engine we provisioned on demand before (desired + lastProvisionedAt)", () => {
    expect(shouldReprovision({ desired: "present", lastProvisionedAt: new Date() })).toBe(true);
    expect(shouldReprovision({ desired: "present", lastProvisionedAt: "2026-06-09T00:00:00Z" })).toBe(true);
  });

  it("does NOT restore a baked-but-never-provisioned engine (no lastProvisionedAt)", () => {
    expect(shouldReprovision({ desired: "present", lastProvisionedAt: null })).toBe(false);
  });

  it("does NOT restore an engine that is not desired", () => {
    expect(shouldReprovision({ desired: "absent", lastProvisionedAt: new Date() })).toBe(false);
  });

  it("does NOT restore when there is no state row", () => {
    expect(shouldReprovision(null)).toBe(false);
    expect(shouldReprovision(undefined)).toBe(false);
  });
});
