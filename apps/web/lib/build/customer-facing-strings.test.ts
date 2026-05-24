// apps/web/lib/build/customer-facing-strings.test.ts
//
// Phase-1 regression: customer-facing Build Studio strings must not expose
// the word "sandbox" as the noun the user reads. Spec
// docs/superpowers/specs/2026-05-24-portal-topology-consolidation-design.md
// §8.1 — "Build Studio footer/button label should be 'Live preview', not
// 'Open sandbox'". Technical diagnostics may still use "sandbox" (compose
// service names, RuntimeTarget kinds, Prisma models); this test only guards
// the user-facing copy in the BuildStudio canvas footer.
import { describe, it, expect } from "vitest";
import { formatSandboxLabel } from "./sandbox-driver";

describe("Build Studio customer-facing labels — phase 1 regression", () => {
  it("footer button label does not contain the word 'sandbox'", () => {
    const idle = formatSandboxLabel(null);
    const driving = formatSandboxLabel("FB-DEADBEEF");
    expect(idle.toLowerCase()).not.toMatch(/sandbox/);
    expect(driving.toLowerCase()).not.toMatch(/sandbox/);
  });

  it("footer button label uses 'Live preview' as the user-facing noun", () => {
    expect(formatSandboxLabel(null)).toMatch(/live preview/i);
    expect(formatSandboxLabel("FB-DEADBEEF")).toMatch(/live preview/i);
  });

  it("driving build code is still visible to the user", () => {
    expect(formatSandboxLabel("FB-DEADBEEF")).toContain("FB-DEADBEEF");
    expect(formatSandboxLabel(null).toLowerCase()).toContain("idle");
  });
});
