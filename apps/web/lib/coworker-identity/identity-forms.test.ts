// apps/web/lib/coworker-identity/identity-forms.test.ts
// The id seam that read as $0/0 on the live install (EP-COWORKER-IDENTITY-360).
import { describe, it, expect } from "vitest";

import { coworkerIdentityForms } from "./identity-forms";

describe("coworkerIdentityForms", () => {
  it("recovers the slug form from a canonical id whose row carries no slug", () => {
    // The bug: metering rows are keyed 'build-specialist' but the page loads
    // 'AGT-WS-BUILD' (canonical, slugId null). Both forms must be queried.
    const forms = coworkerIdentityForms("AGT-WS-BUILD", null);
    expect(forms).toContain("AGT-WS-BUILD");
    expect(forms).toContain("build-specialist");
  });

  it("recovers the canonical form from a slug id", () => {
    const forms = coworkerIdentityForms("coo");
    expect(forms).toContain("coo");
    expect(forms).toContain("AGT-ORCH-000");
  });

  it("includes an explicitly loaded slugId", () => {
    const forms = coworkerIdentityForms("AGT-ORCH-000", "coo");
    expect(forms).toContain("AGT-ORCH-000");
    expect(forms).toContain("coo");
  });

  it("dedupes and never returns empties", () => {
    const forms = coworkerIdentityForms("coo", "coo");
    expect(new Set(forms).size).toBe(forms.length);
    expect(forms.every((f) => f.trim().length > 0)).toBe(true);
  });

  it("returns at least the input for an unmapped agent id", () => {
    const forms = coworkerIdentityForms("AGT-UNMAPPED-XYZ");
    expect(forms).toContain("AGT-UNMAPPED-XYZ");
    expect(forms.length).toBeGreaterThanOrEqual(1);
  });
});
