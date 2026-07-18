// apps/web/lib/govern/data/lifecycle-classes.test.ts
import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_CLASS_DECLARATIONS,
  autoPurgeableLifecycleClasses,
  getLifecycleClass,
} from "./lifecycle-classes";
import { ALL_LIFECYCLE_CLASSES } from "./taxonomy";

describe("lifecycle class declarations", () => {
  it("declares every lifecycle class exactly once", () => {
    const keys = LIFECYCLE_CLASS_DECLARATIONS.map((d) => d.key).sort();
    expect(keys).toEqual([...ALL_LIFECYCLE_CLASSES].sort());
  });

  it("treats retention minima, deletion maxima, and holds as independent concepts", () => {
    const regulated = getLifecycleClass("regulated-record");
    expect(regulated.hasRetentionMinimum).toBe(true);
    expect(regulated.autoPurgeEligible).toBe(false);

    const telemetry = getLifecycleClass("telemetry-bounded");
    expect(telemetry.hasDeletionMaximum).toBe(true);
    expect(telemetry.autoPurgeEligible).toBe(true);
  });

  it("marks legal-evidence hold-eligible and never auto-purgeable", () => {
    const evidence = getLifecycleClass("legal-evidence");
    expect(evidence.holdEligible).toBe(true);
    expect(evidence.autoPurgeEligible).toBe(false);
    expect(autoPurgeableLifecycleClasses()).not.toContain("legal-evidence");
  });

  it("only lets ephemeral/telemetry classes auto-purge", () => {
    expect([...autoPurgeableLifecycleClasses()].sort()).toEqual(["ephemeral", "telemetry-bounded"]);
  });
});
